#!/usr/bin/env node
// zhangclaw-finance-news：财经资讯搜索的本地 stdio MCP 服务（东方财富公开搜索）。
//
// 为什么是本地 stdio：同名上游服务指向 Z.ai 网关并要求 zcode_official jwt_token，
// 无账号时每个调用都被服务端 JSON-RPC 1006 拒绝。本产品不依赖上游账号，改为本地直连公开接口。
// 零依赖（只用全局 fetch）；结果带 source/fetchedAt，失败如实返回错误。

import readline from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "zhangclaw-finance-news";
const SERVER_VERSION = "0.2.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_BYTES = 60 * 1024;
const SUMMARY_CHARS = 240;

const TOOLS = [
  {
    name: "search_news",
    description:
      "财经资讯搜索（东方财富公开搜索）。keyword 例：茅台 回购、LPR、新能源。" +
      "返回标题、摘要、发布时间、媒体与原文链接。数据源为公开搜索接口，非官方授权，可能限流。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "搜索关键词" },
        pageSize: { type: "number", description: "1-50，默认 10" },
        page: { type: "number", description: "页码，默认 1" },
      },
      required: ["keyword"],
    },
  },
];

async function callTool(name, args) {
  if (name !== "search_news") return fail(`未知工具: ${name}`);
  const keyword = String(args.keyword ?? "").trim();
  if (keyword.length === 0) return fail("keyword 为空");
  const pageSize = clamp(Number(args.pageSize ?? 10), 1, 50, 10);
  const page = clamp(Number(args.page ?? 1), 1, 200, 1);

  const param = JSON.stringify({
    uid: "",
    keyword,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientVersion: "curr",
    clientType: "web",
    param: { cmsArticleWebOld: { searchScope: "default", sort: "default", pageIndex: page, pageSize } },
  });
  const response = await fetch(
    `https://search-api-web.eastmoney.com/search/jsonp?cb=zx&param=${encodeURIComponent(param)}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (ZhangClaw local data plugin)",
        Referer: "https://so.eastmoney.com/",
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`东方财富资讯返回 HTTP ${response.status}`);
  const text = await response.text();
  // jsonp 包裹：zx({...})
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close <= open) return fail("上游返回不是 jsonp，接口口径可能已变更");
  const payload = JSON.parse(text.slice(open + 1, close));
  const rows = (payload?.result?.cmsArticleWebOld ?? []).map((item) => ({
    title: stripTags(item.title ?? ""),
    summary: stripTags(item.content ?? "").slice(0, SUMMARY_CHARS),
    publishedAt: item.date ?? null,
    mediaName: item.mediaName ?? null,
    url: item.url ? String(item.url).replace(/^\/\//, "https://") : null,
  }));
  return ok({
    fetchedAt: new Date().toISOString(),
    source: "so.eastmoney.com",
    keyword,
    totalHits: number(payload?.hitsTotal),
    page,
    pageSize,
    rows,
    note: rows.length === 0 ? "无匹配资讯：可换更短或更常见的关键词重试" : undefined,
  });
}

function stripTags(value) {
  return String(value).split("<em>").join("").split("</em>").join("");
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
