# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。`MAJOR.MINOR.PATCH`：
向后兼容的新功能进 MINOR,修复进 PATCH,破坏「契约」(MCP/HTTP API、skill 命令、数据库结构)的改动才进 MAJOR。

## [0.4.0] - 2026-06-19

### 变更(产品化:把"启动离线智能体"做成界面操作,不再用环境变量)

- **给没在运行的智能体发消息时,界面直接出现「启动并处理」一键按钮。** 点一下就把它启动起来读消息、
  回你;可勾「以后自动启动」记住选择。普通用户全程在界面里完成,**不接触任何环境变量或"唤醒"黑话**。
- **新增设置面板(左栏齿轮)**,纯中文/英文选项:「先问我(默认)」/「自动启动它」/「只把消息排队」。
  设置存到 `data/settings.json`,经 `GET/PUT /api/settings` 读写。
- 新增 `POST /api/sessions/:id/start` 一键启动端点;`POST /reply` 现在按设置返回
  `agent: online | starting | offline | queued`,驱动界面。
- 启动逻辑仍是 `claude --continue --print --permission-mode <mode>`(复用对话上下文,stdin 传消息、防注入);
  权限默认 `bypassPermissions`(让它能真正干活),由设置控制,不再靠 `BEACON_WAKE` 环境变量。
  `BEACON_WAKE_CMD` 作为高级覆盖仍保留。

## [0.3.1] - 2026-06-19

### 变更 / 修复

- **自动唤醒改为可配置权限,默认关闭(安全可发布)。** 0.3.0 的唤醒只跑
  `claude --continue --print`,headless 下没有工具权限,被唤醒的 agent 读不了收件箱、回不了消息,
  悄悄退出 —— 看着像"发了没反应"。现在权限做成可配置:
  - `BEACON_WAKE` 选择被唤醒 agent 的权限模式,**默认 `off`(不自动唤醒)**。
  - 启用并选模式:`full`(= Claude 的 `bypassPermissions`,完全自主接着干活)、
    `acceptEdits`、`default`、`plan`、`bypassPermissions`,直接映射到 `claude --permission-mode`。
  - `--continue` 复用该对话**之前的上下文/任务**;权限模式由本设置决定(headless 启动无法自动继承)。
  - `BEACON_WAKE_CMD` 仍可整体覆盖唤醒命令。
  - **安全提示:** 设成 `full` 后,一条入站消息会自动启动一个**全自主**的 Claude 在该目录真实动手
    (消耗额度)。这是显式 opt-in;公开默认是关闭的。
- 唤醒进程的 stdout/stderr 现在被捕获并记录(退出码 + 输出片段),不再静默失败,便于排查。

## [0.3.0] - 2026-06-18

### 新增

- **在线/离线状态(presence)。** session 新增 `lastSeenAt`,agent 每次与 Beacon 交互即刷新;
  界面用实心点(在线/运行中)与空心灰圈(离线/未运行)区分,头部与右侧面板都显示。让你**一眼看出
  agent 进程是否还在跑**——而不是只看它最后自报的 working/waiting 状态。
- **离线自动唤醒(auto-wake)。** 给一个**离线**的 agent 发消息时,平台在它的工作目录里把它**重新拉起来**
  (Claude Code: `claude --continue --print`),把你的消息经 **stdin** 喂给它(不进命令行 → 防注入),
  复活的 agent 读收件箱、据此继续。**全自动、零配置**:每种运行时的唤醒方式写在 `src/server/wake.ts`
  代码里一次,人和 agent 都不用配。带 90s 冷却防风暴;给离线 agent 发消息时界面提示「正在唤醒…」。
- 环境变量:`BEACON_WAKE=0` 关闭自动唤醒;`BEACON_WAKE_CMD` 覆盖唤醒命令(自定义 resume 包装器)。

### 兼容性

- 增量迁移:`sessions` 新增 `lastSeenAt` 列,经 `ALTER TABLE` 原地补齐,旧库升级无损。

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
