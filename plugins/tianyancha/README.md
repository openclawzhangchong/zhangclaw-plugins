# Listed-company Announcements (tianyancha)

[中文](./README_CN.md)

MCP search over SSE/SZSE/BSE listed-company announcements via cninfo, the designated disclosure platform, with no account required.

## Usage

1. Install and enable **Listed-company Announcements** in the plugin manager.
2. Confirm the MCP tools below are loaded in the session, then ask in natural language, e.g.:

> List the recent periodic-report announcements for 600519 with titles and PDF links.

The agent should pick services from what the current session discovers and pass arguments per tool schema. Namespace: `plugin:tianyancha:announcements`. There are no slash commands.

## MCP tools

| Tool | Returns |
| --- | --- |
| `search_announcements` | announcement title, company, code, publish date, PDF link |

## Data source and limits

- This is **announcement search only** — no business-registration, equity-penetration or litigation data. The display name therefore drops the 「天眼查」 brand (the slug stays for existing installs).
- Per-company filtering must go through `hisAnnouncement/query` with a resolved orgId; `fulltextSearch` silently ignores the `stock` parameter and returns unrelated companies, which the implementation avoids.
- The upstream version required a Z.ai account; this one requires neither an account nor a plan.
- This implementation ships in version 0.2.0; the display name now matches the actual source.

## Runtime requirement

The server is a dependency-free Node ESM script (`mcp/server.mjs`) that uses only global `fetch`, so the package carries no `node_modules`; `node` must be on PATH (the same prerequisite as the `mimosa` plugin). Configuration lives in [`.mcp.json`](./.mcp.json), which ZCode discovers at the plugin root.

