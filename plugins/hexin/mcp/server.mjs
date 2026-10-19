#!/usr/bin/env node
// zhangclaw-quotes：免鉴权公开行情的本地 stdio MCP 服务。
//
// 为什么是本地 stdio 而不是远端 HTTP：同名上游服务指向 Z.ai 网关并要求 `auth.type = zcode_official`
// 的 jwt_token，没有 Z.ai 账号时每个工具调用都会被服务端以 JSON-RPC 1006 拒绝（不是客户端门禁，
// 客户端没有开关能绕过）。本产品不依赖上游账号，因此改为本地直连公开接口。
//
// 刻意零依赖（只用全局 fetch 与 TextDecoder）：插件包不携带 node_modules，也不要求用户装包；
// `node` 在 PATH 上是本仓库既有 stdio 插件（mimosa）已经依赖的前置条件。
//
// 数据源是非官方公开接口：字段口径、限流与可用性由对方决定，所以每个结果都带 source 与 fetchedAt，
// 失败时如实返回错误，不编造数据。

import readline from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "zhangclaw-quotes";
const SERVER_VERSION = "0.2.0";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_BYTES = 60 * 1024;
const MAX_SYMBOLS = 50;

const TOOLS = [
  {
    name: "realtime_quote",
    description:
      "查询 A股/港股/美股实时行情快照（现价、涨跌、涨跌幅、量额）。symbols 逗号分隔：贵州茅台→600519 或 sh600519，" +
      "平安银行→sz000001，腾讯→hk00700，苹果→usAAPL。数据来自公开接口 qt.gtimg.cn（GBK 文本已解析），" +
      "非官方授权数据源，可能有延迟或限流。",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "string", description: `标的代码，逗号分隔，最多 ${MAX_SYMBOLS} 个` },
      },
      required: ["symbols"],
    },
  },
];

async function callTool(name, args) {
  if (name !== "realtime_quote") return fail(`未知工具: ${name}`);
  const symbols = String(args.symbols ?? "")
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return fail("symbols 为空。示例：600519 或 sh600519,hk00700,usAAPL");
  }
  const rows = [];
  for (const symbol of symbols) {
    const code = toTencentCode(symbol);
    if (!code) {
      rows.push({ input: symbol, error: "无法识别的代码格式（支持 6 位数字、sh/sz/bj+6 位、hk+代码、us+代码）" });
      continue;
    }
    try {
      const text = await fetchText(`https://qt.gtimg.cn/q=${code}`, { gbk: true, label: "腾讯行情" });
      const parsed = parseTencent(text);
      rows.push(
        parsed
          ? { input: symbol, code, source: "qt.gtimg.cn", ...parsed }
          : { input: symbol, code, error: "接口未返回该标的（代码不存在或市场前缀不对）" },
      );
    } catch (error) {
      rows.push({ input: symbol, code, error: messageOf(error) });
    }
  }
  return ok({
    fetchedAt: new Date().toISOString(),
    note: "价格单位与上游一致，未做复权；volumeLots=成交量(手)，turnoverWan=成交额(万元)",
    rows,
  });
}

// 腾讯代码前缀大小写不敏感，但美股代码本身大小写敏感（usAAPL 有数据、usaapl 无数据），
// 所以只规范化前缀，保留 ticker 原样。
function toTencentCode(symbol) {
  const market = symbol.slice(0, 2).toLowerCase();
  const rest = symbol.slice(2);
  if ((market === "sh" || market === "sz" || market === "bj") && /^\d{6}$/.test(rest)) {
    return `${market}${rest}`;
  }
  if (market === "hk" && /^[a-z0-9.]{1,10}$/i.test(rest)) return `hk${rest}`;
  if (market === "us" && /^[a-z.]{1,10}$/i.test(rest)) return `us${rest.toUpperCase()}`;
  if (/^\d{6}$/.test(symbol)) return symbol.startsWith("6") ? `sh${symbol}` : `sz${symbol}`;
  if (/^[a-z][a-z.]{0,9}$/i.test(symbol)) return `us${symbol.toUpperCase()}`;
  return null;
}

// 腾讯行情是 ~ 分隔的位置式文本。字段含义取自公开约定：
// 1=名称 2=代码 3=现价 4=昨收 5=今开 30=时间戳 31=涨跌 32=涨跌幅% 33=最高 34=最低
// 36=成交量(手) 37=成交额(万) 43=换手率。
function parseTencent(text) {
  const match = /"([^"]*)"/.exec(text);
  if (!match) return null;
  const field = match[1].split("~");
  if (field.length < 40) return null;
  const num = (index) => {
    const raw = field[index];
    if (raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    name: field[1] || null,
    code: field[2] || null,
    price: num(3),
    prevClose: num(4),
    open: num(5),
    change: num(31),
    changePercent: num(32),
    high: num(33),
    low: num(34),
    volumeLots: num(36),
    turnoverWan: num(37),
    turnoverRate: num(43),
    quotedAt: field[30] || null,
  };
}

async function fetchText(url, options = {}) {
  // label/gbk 是本模块私有选项，不能混进 fetch 的 init。
  const { gbk, label, headers, ...init } = options;
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": "Mozilla/5.0 (ZhangClaw local data plugin)", ...(headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label ?? "上游"}返回 HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder(gbk ? "gbk" : "utf-8").decode(bytes);
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
