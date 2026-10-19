#!/usr/bin/env node
// zhangclaw-market-data：指数、K 线与市场榜单的本地 stdio MCP 服务。
//
// 为什么是本地 stdio：同名上游服务指向 Z.ai 网关并要求 zcode_official jwt_token，
// 无账号时每个调用都被服务端 JSON-RPC 1006 拒绝。本产品不依赖上游账号，改为本地直连公开接口。
// 零依赖（只用全局 fetch）：插件包不带 node_modules，也不要求用户装包。
// 数据源非官方授权：结果带 source/fetchedAt，失败如实返回错误。

import readline from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "zhangclaw-market-data";
const SERVER_VERSION = "0.2.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_BYTES = 60 * 1024;

const MARKET_FS = {
  sh_main: "m:1+t:2",
  sz_main: "m:0+t:6",
  chiNext: "m:0+t:80",
  star: "m:1+t:23",
};

const TOOLS = [
  {
    name: "index_snapshot",
    description:
      "指数或个股最新快照（现价、昨收、开高低、涨跌、涨跌幅）。codes 逗号分隔：个股用裸 6 位（600519），" +
      "指数必须带前缀（sh000300 沪深300、sh000001 上证指数、sz399006 创业板指）——裸码与深市股票会撞码。" +
      "数据来自公开接口 push2.eastmoney.com，非官方授权源。",
    inputSchema: {
      type: "object",
      properties: { codes: { type: "string", description: "代码，逗号分隔，最多 30 个" } },
      required: ["codes"],
    },
  },
  {
    name: "daily_kline",
    description:
      "日 K 线序列（默认前复权）。code 例：600519；days 1-250 个交易日。列顺序 date,open,close,high,low,volume,amount。" +
      "数据来自公开接口 push2his.eastmoney.com。",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "6 位代码或 sh/sz 前缀代码" },
        days: { type: "number", description: "回溯交易日数，默认 30" },
        adjust: { type: "string", enum: ["front", "none"], description: "front=前复权（默认），none=不复权" },
      },
      required: ["code"],
    },
  },
  {
    name: "market_ranking",
    description:
      "按涨跌幅降序的市场榜单。market 取 sh_main|sz_main|chiNext|star（沪深主板/创业板/科创板）；limit 1-100。" +
      "数据来自公开接口 push2.eastmoney.com。",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", enum: Object.keys(MARKET_FS) },
        limit: { type: "number", description: "默认 20，最大 100" },
      },
    },
  },
];

async function callTool(name, args) {
  if (name === "index_snapshot") {
    const codes = String(args.codes ?? "")
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
    if (codes.length === 0) return fail("codes 为空。示例：000300,000001,399006");
    const rows = [];
    for (const code of codes) {
      try {
        const payload = await fetchJson(
          "https://push2.eastmoney.com/api/qt/stock/get" +
            // fltt=2 让价格按小数返回；不带时是放大 100 倍的整数（实测 f43 132497 vs 1324.97）。
            `?secid=${secid(code)}&fltt=2&invt=2&fields=f43,f44,f45,f46,f57,f58,f60,f169,f170`,
        );
        const data = payload?.data;
        rows.push(
          data
            ? {
                input: code,
                code: data.f57 ?? code,
                name: data.f58 ?? null,
                price: number(data.f43),
                prevClose: number(data.f60),
                open: number(data.f46),
                high: number(data.f44),
                low: number(data.f45),
                change: number(data.f169),
                changePercent: number(data.f170),
                source: "push2.eastmoney.com",
              }
            : { input: code, error: "接口未返回该代码（检查 6 位代码与市场前缀）" },
        );
      } catch (error) {
        rows.push({ input: code, error: messageOf(error) });
      }
    }
    return ok({ fetchedAt: new Date().toISOString(), rows });
  }

  if (name === "daily_kline") {
    const code = String(args.code ?? "").trim();
    if (code.length === 0) return fail("code 为空。示例：600519");
    const days = clamp(Number(args.days ?? 30), 1, 250, 30);
    const fqt = args.adjust === "none" ? 0 : 1;
    const url =
      "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
      `?secid=${secid(code)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57` +
      `&klt=101&fqt=${fqt}&end=20500101&lmt=${days}`;
    const payload = await fetchJson(url);
    const data = payload?.data;
    if (!data) return fail("接口未返回该代码的 K 线数据");
    return ok({
      fetchedAt: new Date().toISOString(),
      code: data.code ?? code,
      name: data.name ?? null,
      adjust: fqt === 1 ? "前复权" : "不复权",
      source: "push2his.eastmoney.com",
      columns: ["date", "open", "close", "high", "low", "volume", "amount"],
      rows: (data.klines ?? []).map((line) => String(line).split(",")),
    });
  }

  if (name === "market_ranking") {
    const market = String(args.market ?? "sh_main").trim();
    const fsValue = MARKET_FS[market];
    if (!fsValue) return fail(`market 只支持 ${Object.keys(MARKET_FS).join(" | ")}`);
    const limit = clamp(Number(args.limit ?? 20), 1, 100, 20);
    const url =
      "https://push2.eastmoney.com/api/qt/clist/get" +
      `?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fsValue)}` +
      "&fields=f2,f3,f12,f14,f6";
    const payload = await fetchJson(url);
    const diff = payload?.data?.diff;
    if (!Array.isArray(diff)) return fail("榜单接口未返回 diff 列表，可能已限流或字段变更");
    return ok({
      fetchedAt: new Date().toISOString(),
      market,
      total: payload?.data?.total ?? null,
      source: "push2.eastmoney.com",
      rows: diff.map((item) => ({
        code: item.f12 ?? null,
        name: item.f14 ?? null,
        price: number(item.f2),
        changePercent: number(item.f3),
        amount: number(item.f6),
      })),
    });
  }

  return fail(`未知工具: ${name}`);
}

// 东财 secid：1=沪市、0=深市。指数与股票会撞码（000300 既是沪深300 也可能被当成深市股票），
// 所以指数必须带前缀：sh000300=沪深300、1.000001=上证指数、sz399006=创业板指；
// 裸 6 位数字按股票推断（6 开头=沪，0/3 开头=深）。
function secid(code) {
  const clean = code.trim().toLowerCase();
  const prefixed = /^(sh|sz)(\d{6})$/.exec(clean);
  if (prefixed) return `${prefixed[1] === "sh" ? "1" : "0"}.${prefixed[2]}`;
  const digits = clean.replace(/^(bj\.?)/, "");
  if (!/^\d{6}$/.test(digits)) return `1.${digits}`;
  if (digits.startsWith("3") || digits.startsWith("0") || digits.startsWith("2")) return `0.${digits}`;
  return `1.${digits}`;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.round(num), min), max);
}

function number(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (ZhangClaw local data plugin)",
      Referer: "https://finance.eastmoney.com/",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`东方财富返回 HTTP ${response.status}`);
  return JSON.parse(await response.text());
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
