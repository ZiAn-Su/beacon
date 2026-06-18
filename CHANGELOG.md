# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。`MAJOR.MINOR.PATCH`：
向后兼容的新功能进 MINOR,修复进 PATCH,破坏「契约」(MCP/HTTP API、skill 命令、数据库结构)的改动才进 MAJOR。

## [0.2.0] - 2026-06-18

### 新增

- **托管式 MCP 接入(HTTP transport)。** 平台自身在 `/mcp` 暴露 Streamable HTTP MCP 端点。
  接入从「绑定本地路径的 stdio 命令」简化为一行**全局、无路径**命令:
  `claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp`。
  `-s user` 让它对所有项目全局生效;**平台升级时该命令不变**——URL 就是契约。
  五个工具的定义抽到 `src/mcp/tools.ts` 单一来源,stdio 与 HTTP 两条路共用,永不漂移。
- **会话管理:重命名与归档。** 新增 `PATCH /api/sessions/:id`(`title`、`archived`);
  对话头部「⋯」菜单可重命名/归档,左栏底部「已归档」分组可展开与恢复。
- **中英文切换。** 全新 i18n(`web/src/lib/i18n.tsx`),左侧栏一键切换,跟随浏览器语言、
  记忆到 localStorage。所有界面文案双语化。
- **版本可见。** `/api/health` 与接入面板返回 `version`,便于判断在用实例是否最新。
- **更新脚本。** `npm run update` = `git pull && npm install && npm run build:web`;
  `npm run e2e:http` 为 HTTP MCP 端到端冒烟。

### 变更

- 接入面板(Connect)改为 **MCP 标签页优先**,首屏即那行全局 HTTP 命令;stdio 方式降级为
  「本地(进阶)」备选。

### 兼容性

- **数据库为增量迁移**:`sessions` 新增 `title`、`archivedAt` 两列,经 `ALTER TABLE` 原地补齐,
  旧 `data/beacon.db` 升级后数据完整保留。
- stdio MCP、REST API、skill CLI 命令保持不变,既有接入无需重配。

## [0.1.0]

- 首个可用版本:notify/ask/status/session 语义、SQLite 存储、REST + WebSocket 网关、
  stdio MCP server、零配置 skill、React 前端(Codex 风格)、Docker 部署。
