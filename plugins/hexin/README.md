# Public Quotes (CN/HK/US) (hexin)

[中文](./README_CN.md)

Realtime quote snapshots for A-share, HK and US symbols, served locally from public endpoints with no account required. This plugin ships an MCP server only — no commands, skills, agents or hooks.

## Usage

1. Install and enable **Public Quotes (CN/HK/US)** in the plugin manager.
2. Confirm the MCP tools below are loaded in the session, then ask in natural language, e.g.:

> Use public quotes to fetch the latest price and change for Kweichow Moutai and Tencent, and state the quote time and source.

The agent should pick services from what the current session discovers and pass arguments per tool schema. Namespace: `plugin:hexin:quotes`. There are no slash commands.

## MCP tools

| Tool | Returns |
| --- | --- |
| `realtime_quote` | price, prev close, open, change, change %, high/low, volume, turnover, turnover rate |

## Data source and limits

- Data comes from the public endpoint `qt.gtimg.cn`. It is **not official iFinD data**: field semantics, latency and rate limits are decided by the endpoint owner.
- The upstream version of this plugin pointed at the Z.ai gateway with `auth.type = zcode_official`, so every call was rejected with JSON-RPC 1006 without a Z.ai account. This version talks to the public endpoint locally — **no account, no plan**.
- Prices are not adjusted. Every result carries `source` and `fetchedAt`; missing data is reported as an error rather than filled in.
- This implementation ships in version 0.2.0; the display name now matches the actual source.

## Runtime requirement

The server is a dependency-free Node ESM script (`mcp/server.mjs`) that uses only global `fetch`, so the package carries no `node_modules`; `node` must be on PATH (the same prerequisite as the `mimosa` plugin). Configuration lives in [`.mcp.json`](./.mcp.json), which ZCode discovers at the plugin root.

