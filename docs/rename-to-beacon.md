# 改名任务：InteractPlatform → Beacon

把产品对外名称从 **InteractPlatform** 改为 **Beacon**。严格按下面的"改"与"不改"执行，改完跑 `npm run typecheck`（根）和 `web/` 里 `npm run build`，修复一切因改名导致的报错，并报告。

## 要改

- **产品显示名**：所有 `InteractPlatform` → `Beacon`（UI 品牌文字、文档标题与正文、代码注释里的产品名）。
- **根 `package.json`**：`"name": "interact-platform"` → `"beacon"`；`"description"` 里的产品名同步。
- **`web/package.json`**：`"name": "interact-platform-web"` → `"beacon-web"`。
- **MCP server 标识**（`src/mcp/server.ts`）：`new McpServer({ name: 'interact-platform', ... })` 的 name → `'beacon'`；启动日志 `[mcp] interact-platform MCP server ready` → `[mcp] beacon MCP server ready`。
- **MCP 注册名 `interact` → `beacon`**（这是 server 在配置里的键名），出现在：
  - `src/server/index.ts` 的 `/api/connect-info`：`claudeMcpAdd` / `codexMcpAdd` 里的 `claude mcp add interact` / `codex mcp add interact` → `... beacon`；`mcpJson.mcpServers.interact` → `mcpServers.beacon`。
  - `docs/connect-agent.md`、`docs/connect-panel-spec.md`、`README.md` 里的 `.mcp.json` 示例与命令中的 `interact` 键 → `beacon`。
  - `.qa/mcp-claude.json` 里的 `mcpServers.interact` → `mcpServers.beacon`。
- **数据库默认路径与环境变量**：`src/core/store.ts` 的 `data/interact.db` → `data/beacon.db`；环境变量 `INTERACT_DB` → `BEACON_DB`。同步更新 `README.md`、`CLAUDE.md` 里的相应说明。
- **前端标题与品牌**：`web/index.html` 的 `<title>`、以及 `web/src` 里任何 `InteractPlatform` 文案 → `Beacon`。

## 不要改（保持原样）

- 所有 API 路由（`/api/sessions/*`、`/api/asks/*`、`/api/connect-info` 等）。
- MCP 工具名：`register_session`、`notify_human`、`ask_human`、`update_status`、`check_inbox`。
- 环境变量 `PLATFORM_URL`、`PLATFORM_TOKEN`、`PORT`、`AGENT_RUNTIME`、`AGENT_WORK_PATH`、`AGENT_TASK`。
- 代码里的类型名、函数名、变量名、文件名、目录结构。
- `skill/` 目录（如果存在）——不要碰。

## 收尾

- 根目录 `npm run typecheck` 通过。
- `web/` 里 `npm run build` 通过。
- 列出改动的文件清单。
