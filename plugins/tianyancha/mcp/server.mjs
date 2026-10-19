#!/usr/bin/env node
// zhangclaw-announcements：上市公司公告检索的本地 stdio MCP 服务（巨潮资讯）。
//
// 诚实边界：巨潮是沪深北交易所指定信息披露平台，能查「上市公司公告」，
// 不含工商登记、股权穿透、司法风险等数据。上游同名插件叫「天眼查」并指向 Z.ai 网关，
// 本产品不冒充该数据源，插件显示名已改为「上市公司公告检索」。
//
// 零依赖（只用全局 fetch）；结果带 source/fetchedAt，失败如实返回错误。

import readline from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "zhangclaw-announcements";
const SERVER_VERSION = "0.2.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_BYTES = 60 * 1024;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (ZhangClaw local data plugin)",
  Referer: "http://www.cninfo.com.cn/new/index",
  Accept: "application/json",
};

const TOOLS = [
  {
    name: "search_announcements",
    description:
      "检索沪深北上市公司公告（巨潮资讯 cninfo，交易所指定披露平台）。keyword 例：年报、回购、股权激励；" +
      "stock 传 6 位代码可只看一家；返回标题、公司、日期与 PDF 直链。注意：不含工商登记与股权穿透数据。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "公告标题关键词（与 stock 至少给一个）" },
        stock: { type: "string", description: "6 位证券代码，可选" },
        pageSize: { type: "number", description: "1-50，默认 10" },
        page: { type: "number", description: "页码，默认 1" },
      },
    },
  },
];

async function callTool(name, args) {
  if (name !== "search_announcements") return fail(`未知工具: ${name}`);
  const keyword = String(args.keyword ?? "").trim();
  const stock = String(args.stock ?? "").trim().replace(/[^\d]/g, "");
  if (keyword.length === 0 && stock.length === 0) {
    return fail("keyword 与 stock 至少给一个。示例：{keyword:\"年报\", stock:\"600519\"}");
  }
  const pageSize = clamp(Number(args.pageSize ?? 10), 1, 50, 10);
  const page = clamp(Number(args.page ?? 1), 1, 200, 1);

  let rows;
  let total;
  if (stock.length === 6) {
    // 按公司过滤只能走 hisAnnouncement/query，且它要 "代码,orgId"；
    // 实测 fulltextSearch 会静默忽略 stock 参数，返回无关公司的公告，所以不能图省事用它。
    const orgId = await resolveOrgId(stock);
    if (!orgId) return fail(`巨潮未收录代码 ${stock}（或接口变更），可改用 keyword 检索`);
    const payload = await postForm("http://www.cninfo.com.cn/new/hisAnnouncement/query", {
      pageNum: String(page),
      pageSize: String(pageSize),
      column: stock.startsWith("6") ? "sse" : "szse",
      tabName: "fulltext",
      plate: "",
      stock: `${stock},${orgId}`,
      searchkey: keyword,
      secid: "",
      category: "",
      trade: "",
      seDate: "",
      sortName: "time",
      sortType: "desc",
      isHLtitle: "true",
    });
    rows = payload?.announcements ?? [];
    total = number(payload?.totalAnnouncement ?? payload?.total);
  } else {
    const params = new URLSearchParams({
      searchkey: keyword,
      sdate: "",
      edate: "",
      isfulltext: "false",
      sortName: "pubdate",
      sortType: "desc",
      pageNum: String(page),
      pageSize: String(pageSize),
    });
    const payload = await getJson(`http://www.cninfo.com.cn/new/fulltextSearch/full?${params}`);
    rows = payload?.announcements ?? [];
    total = number(payload?.totalAnnouncement);
  }

  return ok({
    fetchedAt: new Date().toISOString(),
    source: "cninfo.com.cn（交易所指定信息披露平台）",
    keyword: keyword || null,
    stock: stock || null,
    totalAnnouncement: total,
    page,
    pageSize,
    rows: rows.map((item) => ({
      title: stripTags(item.announcementTitle ?? ""),
      code: item.secCode ?? null,
      company: item.secName ?? null,
      publishedAt: dateOf(item.announcementTime ?? item.noticeTime),
      pdfUrl: item.adjunctUrl ? `http://static.cninfo.com.cn/${item.adjunctUrl}` : null,
    })),
    note:
      rows.length === 0
        ? "无匹配公告：可换更短的关键词，或只传 6 位股票代码再看全部公告"
        : undefined,
  });
}

// topSearch/query 把代码解析成 orgId（例：600519 → gssh0600519）。
async function resolveOrgId(code) {
  const payload = await postForm("http://www.cninfo.com.cn/new/information/topSearch/query", {
    keyWord: code,
  });
  const list = Array.isArray(payload) ? payload : [];
  const hit = list.find((item) => String(item.code ?? "") === code) ?? list[0];
  return hit?.orgId ? String(hit.orgId) : null;
}

async function getJson(url) {
  const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`巨潮资讯返回 HTTP ${response.status}`);
  return JSON.parse(await response.text());
}

async function postForm(url, form) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...REQUEST_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`巨潮资讯返回 HTTP ${response.status}`);
  return JSON.parse(await response.text());
}
function stripTags(value) {
  return String(value).split("<em>").join("").split("</em>").join("");
}

function dateOf(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Date(num).toISOString().slice(0, 10);
}

function number(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.round(num), min), max);
}

function ok(payload) {
  const text = JSON.stringify(payload, null, 2);
  const clipped =
    Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES
      ? `${text.slice(0, MAX_TEXT_BYTES)}\n/* truncated */`
      : text;
  return { content: [{ type: "text", text: clipped }], isError: false };
}

function fail(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = readline.createInterface({ input: process.stdin });

lines.on("line", async (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined && String(method ?? "").startsWith("notifications/")) return;

  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      return;
    }
    if (method === "ping") {
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const toolName = params?.name;
      if (!TOOLS.some((tool) => tool.name === toolName)) {
        send({ jsonrpc: "2.0", id, result: fail(`未知工具: ${String(toolName)}`) });
        return;
      }
      let args = params?.arguments ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      send({ jsonrpc: "2.0", id, result: await callTool(toolName, args) });
      return;
    }
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${String(method)}` },
      });
    }
  } catch (error) {
    if (id !== undefined) send({ jsonrpc: "2.0", id, result: fail(messageOf(error)) });
  }
});

lines.on("close", () => process.exit(0));
