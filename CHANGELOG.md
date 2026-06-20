# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。`MAJOR.MINOR.PATCH`：
向后兼容的新功能进 MINOR,修复进 PATCH,破坏「契约」(MCP/HTTP API、skill 命令、数据库结构)的改动才进 MAJOR。

## [0.6.0] - 2026-06-20

### 新增 —— 智能体身份、智能体间通信、授权(全部向后兼容、增量迁移)

按 `docs/identity-design.md` 顶层设计落地,旧 agent 接入零感知。

#### 身份与监护

- 新增 `owner` 表:启动即确保唯一监护人(token 默认取 `PLATFORM_TOKEN`)。
- 每个 session(= 联系人)获得稳定身份字段:`bindKey`(续接凭证)、`origin`、`guardianId`、`trustTier`,
  均经 `ensureColumn` 增量迁移(旧库原地升级、读时默认兜底)。
- `register` 支持可选 `bindKey`(命中即续接同一联系人)、`name`、`origin`,响应新增 `agentId`。

#### 智能体间通信(agent ↔ agent)

- 新增 peer 语义,全程经平台中转、人侧可见:`notify_agent`(非阻塞)、`ask_agent`(阻塞,复用既有
  ask 长轮询)、`answer_agent`、`list_agents`。MCP 两路(stdio + 托管 HTTP)与零配置 skill CLI
  (`agents` / `notify-agent` / `ask-agent` / `answer-agent`)均已支持。
- 端点:`POST /api/sessions/:id/{peer-notify,peer-ask,peer-reply}`、`GET /api/agents`。
- 前端:peer 消息以独立气泡渲染(`发往/来自 <agent>` + 问题角标),收发双方对话都实时更新。

#### 授权

- 每个 agent 的**信任档位**(`restricted | standard | trusted | autonomous`)+ **逐对 Grant**
  (allow/deny):`resolvePeerPermission` 最具体者胜(全局闸 > 逐对 Grant > 发起方档位)。
- 端点:`GET/POST /api/grants`、`DELETE /api/grants/:id`;`PATCH /api/sessions/:id` 支持 `trustTier`;
  `settings.agentComm` 全局总闸。
- 前端:Settings 全局通信开关 + 每个 agent 的信任档位选择器。

### 验证

- `npm run e2e` / `npm run e2e:http` 全回归通过(human↔agent 与 5 个原 MCP 工具零破坏)。
- agent↔agent 全链路(后端 + MCP 两路 + skill CLI)与授权矩阵端到端实测;前端经浏览器实机 QA。

## [0.5.5] - 2026-06-19

### 修复(QA 发现的 14 个 issues 全量修复)

#### P0 — 立即修

- **ISS-005**: `POST /api/sessions/:id/status` 收到非法 status 值(如 `"banana"`)不再静默返回 200;
  改为在 route 层校验 `SESSION_STATUSES` 枚举,越界返回 400 + 错误说明。
- **ISS-010**: `/reply` 当 `hasLivePty=true` 但 `writeToPty` 返回 false 时(非 agent runtime 如
  `cmd-test`)不再虚报 `agent:'online'`;改为读返回值,false → `agent:'queued'`。

#### P1 — 尽快修

- **ISS-003**: `POST /api/sessions/register` 接受空 body → 400(`runtime is required` /
  `task is required`)。
- **ISS-004**: `POST /api/sessions/:id/ask` 空 question → 400,不再把 session 卡进无内容
  的 waiting 状态。
- **ISS-006**: `POST /api/sessions/:id/reply` 提供的 `askId` 找不到或已 answered/cancelled → 404,
  不再静默降级为 free chat(导致真 ask 永远 pending、agent 永远等)。
- **ISS-011**: `/pty` WS 鉴权现在同时接受 `?token=` query param 和 `Authorization: Bearer …`
  header,与 REST south API 保持一致。

#### P2 — 常规 backlog

- **ISS-007**: `PUT /api/settings` 校验 `autoStart`(`ask|auto|off`)和 `startPermission`
  枚举白名单,越界返回 400。
- **ISS-009**: 非法 JSON 请求体不再返回暴露服务器绝对路径的 HTML 堆栈页;Express 5 后挂
  `entity.parse.failed` 错误中间件,统一返回 `{"error":"invalid json"}`。
- **ISS-012**: `/pty` WS 的 token 校验从 `wss.on('connection')` 提前到 `server.on('upgrade')`
  阶段,越权连接在 HTTP 层就被 `socket.write('HTTP/1.1 401…')` 拒掉,不再有瞬时 open 后 1008 的
  问题。

#### P3 — 可选

- **ISS-008**: `PATCH /api/sessions/:id {}` 空 body 不再无声 200;返回 400
  `"no patchable fields"`。
- **ISS-013**: 去掉 `<html class="dark">` 硬编码;改为在 `<head>` 首位插入最小内联脚本
  (`localStorage + prefers-color-scheme`)在首屏 paint 前设好 theme,浅色偏好用户不再有 FOUC。

#### 已在此前版本修复(记录存档)

- **ISS-001**(P2): 组件中硬编码中文已在 v0.5.3 迁入 i18n。
- **ISS-002/014**(P1/P3): 进程版本不一致 = 未重启旧进程,无代码 bug。

## [0.5.4] - 2026-06-19

### 变更(把终端做成"永远在线",去掉断连/排队等摩擦状态)

像 Claude Code / Codex 一样:打开就能用,想跟哪个对话就跟哪个,不该出现"断连""排队""未运行"。

- **终端静默自动重连。** 去掉红色"连接失败 / 重连"大框和手动重连按钮。socket 断了自动以
  1~3s 退避重连,只在右上角显示一个不打扰的"重连中…"小标;重连时 `term.reset()` 让服务端缓冲
  回放干净重绘,不再叠字。鉴权/会话不存在(1008)才不重试。
- **发消息永不"排队"。** 没有活终端时,`/reply` 当场起一个交互式 agent 终端并把消息打进去
  (claude-code/codex);输出缓冲到你打开终端时回放。只有无法启动的 runtime 才回退排队。
  - `pty.ts` 新增 `ensurePty()`(按需 spawn)、启动期(<3.5s)消息排队待 TUI 就绪后冲刷、
    无人观看的进程也会被 30 分钟空闲回收。
  - `/reply` 决策简化为:ask 回答走长轮询 → 有活终端写进去 → 真·自治 agent 在线则投递收件箱
    → 否则当场起终端写进去。移除了 `starting/offline` 唤醒分支。

## [0.5.3] - 2026-06-19

### 修复(人机交互核心,重要)

- **发消息后终端无反应 + 智能体"自动关闭"。** 根因:Beacon 消息通道与嵌入终端是两条互不相通的链路。
  你发的消息进了 store,但终端里的交互 claude 不轮询 inbox 看不到;同时终端 claude 不调用 Beacon,
  presence 判它"离线",`/reply` 又 spawn 了一个 headless `claude --continue --print` 去同一目录恢复
  同一对话——两个 claude 冲突,headless 那个跑完一轮就退出,看起来就是"自动关闭"。
- **现在:终端就是智能体。** 当某 session 有活的终端 PTY 时,你发的聊天消息直接写入它的 stdin
  (等同于替你在 claude 里输入并回车),消息真正进入终端、智能体据此行动;**绝不再 spawn 冲突进程**。
  - `src/server/pty.ts` 新增 `hasLivePty()` / `writeToPty()`;`/reply` 优先走终端注入。
  - 终端打开期间维持 session presence "在线"(30s 心跳 `touchSeen`),交互 claude 自身不调 Beacon
    也不会被误判离线。ask 的回答仍走原长轮询通道,不注入终端。

## [0.5.2] - 2026-06-19

### 变更 / 修复

- **嵌入终端不再每次打开都慢。** 原来每次打开「终端」标签都重新 `spawn('claude --continue')`,
  claude 冷启动要数秒;切回「消息」又会 kill 进程,再切回来重启一遍。现在 PTY 进程按 sessionId
  **持久化**:第一次打开才 spawn,之后切标签、刷新页面、开第二个浏览器标签都是「附加」到已存在的
  进程,并回放最近输出缓冲(≤200KB),~10ms 内重建画面。无人连接 30 分钟后才回收进程。
  - 实测:首连 spawn 后 6s 内输出 50KB;重连 8ms 连上、9ms 回放完成,不再重启 claude。

## [0.5.1] - 2026-06-19

### 修复

- **终端 WebSocket 连接失败(400)。** `/ws` 和 `/pty` 两个 WebSocketServer 都用 `{ server }` 选项
  挂在同一 HTTP server 上时,`/ws` 的实例会先拦截 `/pty` 的升级请求并以 400 拒绝,导致终端永远连不上。
  改为两者都用 `noServer: true`,由单个 `upgrade` 事件按 pathname 手动路由。

## [0.5.0] - 2026-06-19

### 新增

- **嵌入式终端(Embedded Terminal)**。对话界面头部新增「消息 | 终端」切换标签。点「终端」直接在
  Beacon 界面里打开 xterm.js 终端,运行 `claude --continue`(claude-code)、`codex`(codex)
  或交互式 shell(其他 runtime),体验与在本地终端里操作完全一致。
  - 后端:新增 `/pty` WebSocket 端点(`src/server/pty.ts`),基于 `node-pty`(ConPTY on Windows)
    给每个连接分配独立 PTY 进程;自动注入 `BEACON_SESSION_ID` 环境变量让 agent 归属正确 session。
  - 前端:新增 `TerminalPanel.tsx`(xterm.js + FitAddon),GitHub 暗色主题,
    ResizeObserver 自动发 resize 消息,连接断开后显示提示。
  - Vite 开发代理新增 `/pty` 路径;生产下 PTY WS 与 REST 共享同一端口。

### 变更

- **移除"正在启动智能体"banner 及离线提示栏。** 不再弹出启动提示:
  有了嵌入终端,用户直接点「终端」标签启动 agent,不需要额外的"启动"按钮流程。

## [0.4.3] - 2026-06-19

### 新增

- **消息已送达确认(✓)**。人发出的 chat 消息,一旦 agent 调用 `check_inbox` 读取,
  气泡右下角即刻出现绿色 `✓` 图标,悬停可看送达时间。
  - 后端:messages 表新增 `deliveredAt INTEGER` 字段(additive migration,不破坏已有数据);
    `inbox()` 返回时 SQL 批量打标记并通过 bus 推 WS 事件。
  - 前端:WS `message` 事件改为 upsert(相同 id → in-place 更新),使 deliveredAt 能实时反映。
  - `answer` 类消息(ask 的回答)不需要此标记,因为它通过长轮询直接唤醒 agent。

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
