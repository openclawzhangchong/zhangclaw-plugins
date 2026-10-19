# Market Data (Index · K-line · Ranking) (wind)

[中文](./README_CN.md)

Index snapshots, daily k-lines and market ranking served locally from public endpoints, no account required.

## Usage

1. Install and enable **Market Data (Index · K-line · Ranking)** in the plugin manager.
2. Confirm the MCP tools below are loaded in the session, then ask in natural language, e.g.:

> Snapshot CSI 300 (sh000300) and Kweichow Moutai, then return the last 20 daily k-lines for Moutai.

The agent should pick services from what the current session discovers and pass arguments per tool schema. Namespace: `plugin:wind:market-data`. There are no slash commands.

## MCP tools

| Tool | Returns |
| --- | --- |
| `index_snapshot` | index/stock price, prev close, high/low, change, change % |
| `daily_kline` | daily OHLCV series (forward-adjusted by default, 1-250 sessions) |
| `market_ranking` | top movers by change % for SSE/SZSE/ChiNext/STAR |

## Data source and limits

- Data comes from the public endpoints `push2.eastmoney.com` / `push2his.eastmoney.com`. It is **not official Wind data**.
- Index and stock codes collide: a bare 6-digit code is treated as a stock, so indices need a prefix (`sh000300`, `sz399006`).
- The upstream version required a Z.ai account; this one requires neither an account nor a plan.
- This implementation ships in version 0.2.0; the display name now matches the actual source.

## Runtime requirement

The server is a dependency-free Node ESM script (`mcp/server.mjs`) that uses only global `fetch`, so the package carries no `node_modules`; `node` must be on PATH (the same prerequisite as the `mimosa` plugin). Configuration lives in [`.mcp.json`](./.mcp.json), which ZCode discovers at the plugin root.

