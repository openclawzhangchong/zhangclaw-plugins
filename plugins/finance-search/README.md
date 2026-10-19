# Financial News Search (finance-search)

[中文](./README_CN.md)

Chinese financial news search served locally from the public Eastmoney search endpoint: title, summary, time, media and source link, no account required.

## Usage

1. Install and enable **Financial News Search** in the plugin manager.
2. Confirm the MCP tools below are loaded in the session, then ask in natural language, e.g.:

> Search recent news for Moutai share buybacks and list titles, times and links.

The agent should pick services from what the current session discovers and pass arguments per tool schema. Namespace: `plugin:finance-search:finance-news`. There are no slash commands.

## MCP tools

| Tool | Returns |
| --- | --- |
| `search_news` | title, summary (240 chars), publish time, media name, original article link |

## Data source and limits

- Data comes from the public search endpoint `so.eastmoney.com`; it is not an authorized feed and may rate-limit or change shape.
- The endpoint wraps responses in jsonp; the client unwraps `(...)` and reports an honest error instead of returning empty results.
- The upstream version required a Z.ai account; this one requires neither an account nor a plan.
- This implementation ships in version 0.2.0; the display name now matches the actual source.

## Runtime requirement

The server is a dependency-free Node ESM script (`mcp/server.mjs`) that uses only global `fetch`, so the package carries no `node_modules`; `node` must be on PATH (the same prerequisite as the `mimosa` plugin). Configuration lives in [`.mcp.json`](./.mcp.json), which ZCode discovers at the plugin root.

