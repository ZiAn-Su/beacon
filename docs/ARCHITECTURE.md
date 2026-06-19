# Beacon 架构设计

> 适用版本:v0.5.4。本文是平台的事实源总览——讲清整体结构、数据流、对外接口、核心机制
> 与关键设计决策。具体某次实现的委托规范见 `docs/` 下其余文件;升级与契约策略见
> [versioning.md](./versioning.md)。

## 1. 这是什么

**Beacon** 是一个面向 Agent 的即时通讯平台。AI agent(Claude Code、Codex、任何支持 MCP 或
能跑命令的运行时)通过一个中立总线与人对话。与聊天机器人的关键区别:agent 自主跑长任务,并
**自行选择**何时联系人,用两种语义——

- **`notify`**:非阻塞的"知会一声",agent 继续工作。
- **`ask`**:阻塞式提问,agent 的任务暂停,直到人回答。

每个 agent 任务是一个 **session**(独立工作路径/上下文),对人显示为一个带实时**状态**
(`registered` → `working` / `waiting` / `idle` / `done`)的联系人。

人这一侧有两个视图:

- **消息视图**:策展过的对话——agent 主动发来的 notify/ask,加上人的回复。
- **终端视图**:嵌入的原生终端,直接驱动该 session 的 agent(等同在本地开 `claude --continue`)。

## 2. 分层与目录

数据流经一个核心层;网关、MCP server、终端、skill CLI 都是其上的薄层。**所有事件从 `store`
触发、经 `bus` 广播,绝不从 `store` 直接推客户端。**

```
src/core        领域 + 单一事实源
  types.ts        Session / Message / Ask + SessionStatus、MsgKind
  bus.ts          进程内 EventEmitter('session' | 'message'),后端在此订阅
  store.ts        better-sqlite3 存储 + 全部 agent 原生语义
  settings.ts     用户可见设置(data/settings.json),无环境变量
src/server      网关
  index.ts        Express 5 REST + 两个 WebSocket(/ws、/pty);生产托管 web/dist
  mcp-http.ts     托管式 Streamable HTTP MCP(/mcp)
  pty.ts          嵌入终端的 PTY WebSocket 服务(node-pty)
  wake.ts         离线 agent 的 headless 唤醒(回退路径)
src/mcp         MCP stdio server —— agent 接入的"南向"之一
  server.ts       5 个工具的 stdio 入口
  tools.ts        工具定义的单一事实源(stdio 与 HTTP 共用)
src/backends    ChatBackend 接缝(contract.ts),人侧界面可插拔
skill/beacon    零配置接入 skill:SKILL.md + 自包含 beacon.mjs(直连 HTTP API)
web             React 18 + Vite + Tailwind v4 UI(人侧界面)
scripts         sim-agent.ts、mcp-e2e.ts 等
```

## 3. 两侧接口

两侧在核心层汇合。

### 南向(agent → 平台)

底层都是同一组 HTTP API(`/api/sessions/*`、`/api/asks/*`),三种接入方式:

1. **MCP stdio**(`src/mcp/server.ts`):暴露 5 个工具——`register_session`、`notify_human`、
   `ask_human`、`update_status`、`check_inbox`。
2. **MCP over HTTP**(`src/server/mcp-http.ts`):托管在 `/mcp`,一条全局命令即可接入,平台升级
   时命令不变(URL 即契约)。工具定义与 stdio 共用 `src/mcp/tools.ts`。
3. **零配置 skill**(`skill/beacon/beacon.mjs`):直接调那组 HTTP API,给 Claude Code 用,无需 MCP。

南向每次调用都会 `store.touchSeen(id)` 刷新 presence(见 §5.3)。

### 北向(人 → 平台)

`web/` 调 `/api/sessions`、`.../messages`、`.../reply`,并订阅两个 WebSocket:

- **`/ws`**:会话与消息事件流(`hello` / `session` / `message`)。
- **`/pty`**:终端字节流(见 §5.2)。

> 注意:`/ws` 与 `/pty` 都用 `noServer` 模式,由单个 `upgrade` 事件按 pathname 路由。两个
> WebSocketServer 都用 `{ server }` 绑同一端口会导致先注册的那个以 400 拒绝另一个的升级请求。

## 4. 数据模型(`src/core/types.ts`)

- **Session**:`id` / `runtime` / `workPath` / `task` / `status` / `title`(人设显示名) /
  `archivedAt` / `lastSeenAt`(presence) / 时间戳。
- **Message**:`direction`(agent|human)、`kind`(notify|ask|answer|chat|status)、`text`、
  `askId`、`meta`、`createdAt`、`deliveredAt`(已送达确认,见 §5.4)。
- **Ask**:`question` / `options` / `status`(pending|answered|cancelled) / `answer` / 时间戳。

存储是 better-sqlite3(WAL),默认 `data/beacon.db`,`BEACON_DB` 可覆盖。**迁移一律 additive**
(`ensureColumn()` 只 `ALTER TABLE ADD COLUMN`,绝不 DROP),让平台在使用中原地升级。

## 5. 五个核心机制

改动前必须理解这五点。

### 5.1 阻塞式 `ask` 用长轮询实现

`ask_human` 创建一个 ask(`store.createAsk`),它记一条 `ask` 消息并把 session 置为 `waiting`。
agent 轮询 `GET /api/asks/:id/wait?timeoutMs=…`,由 `store.waitForAsk` 解析——一个由内存等待者表
(`askWaiters`)持有的 Promise,人回答时被唤醒,或超时返回仍 pending 的 ask 以便低成本再轮询。
带 `askId` 的 `store.reply(sessionId, text, askId)` 才是对 ask 的回答:标记 ask `answered`、把
session 置回 `working`、唤醒等待者。网关里 `server.requestTimeout = 0` 是**故意**的,让长轮询
`/wait` 能挂住不被杀。

### 5.2 终端即 agent(嵌入 PTY)

人侧"终端视图"在浏览器里跑 xterm.js,经 `/pty?sessionId=<id>` 连到后端,后端用 **node-pty**
(Windows 下 ConPTY)为该 session 起一个真实 PTY 进程:`claude --continue` / `codex` /
未知 runtime 则交互式 shell。env 注入 `BEACON_SESSION_ID` 让 agent 归属正确 session。

关键性质:

- **进程持久化、按 sessionId 复用。** spawn `claude --continue` 冷启动慢,所以进程跨重连存活。
  切标签、刷新页面、开第二个浏览器标签都是**附加**到同一活进程,回放输出缓冲(≤200KB)在 ~10ms
  内重建画面。无人连接 30 分钟后才回收。
- **永远在线、静默重连。** 前端 socket 断了自动以 1~3s 退避重连(`term.reset()` 后让缓冲干净
  重绘),不弹"连接失败"。用户无需管理连接状态——像 Claude Code / Codex 的一个标签页。
- **按需启动。** 没有活终端时仍可送消息:`ensurePty()` 当场起一个 agent 终端,输出缓冲到用户
  打开终端时回放。启动期(<3.5s)的消息排队待 TUI 就绪后冲刷。

### 5.3 presence(在线/离线)

session 上的 `lastSeenAt` 每次南向调用时刷新,60s TTL 内算"在线"。交互终端里的 agent 自己不调
Beacon API,所以终端打开期间由 PTY 用 30s 心跳 `touchSeen` 维持其在线——否则会被误判离线并触发
冲突 spawn。UI 也按自己的时钟重算 presence,session 静默后无需事件即可翻成离线。

### 5.4 消息已送达确认(✓)

人发的 `chat` 消息,一旦 agent 调用 `check_inbox`(`store.inbox`)读取,即在该消息上打
`deliveredAt` 并经 bus 推 WS 更新;前端按相同 id **upsert** 消息,气泡显示绿色 ✓。`ask` 的回答
不需要此标记——它通过长轮询直接唤醒 agent。

### 5.5 `/reply` 的投递决策

人发消息时,网关按此顺序决定如何送达 agent(目标:消息一定到真实 agent,无"排队/离线"死路):

```
是 ask 回答?            → store.reply 走长轮询解析,唤醒被阻塞的 agent
否则 有活终端?          → writeToPty:把文字打进终端的 stdin(等同替人输入+回车)
否则 真·自治 agent 在线? → 留在收件箱,等它 check_inbox 轮询
否则                    → ensurePty 当场起交互终端并打进去;无法启动的 runtime 才回退排队
```

> 历史包袱:早期"离线则 spawn 一个 `claude --continue --print` headless 唤醒"的分支
> (`wake.ts`)会与活终端冲突、跑完一轮就退出,看着像 agent"自动关闭"。v0.5.3+ 改为终端优先,
> headless 唤醒仅作为无终端 runtime 的回退保留。

## 6. 可插拔人侧界面(`ChatBackend`)

状态机、ask 阻塞、历史都归核心层。后端只需两条线:订阅 `bus` 把 agent→human 事件镜像出去,以及
调 `store.reply(...)` 送入 human→agent。自带 React UI 是默认后端;Matrix/Element 桥接是有文档的
drop-in(见 [matrix-backend.md](./matrix-backend.md))——保持接缝完整,别把传输细节泄漏进
core/MCP。

## 7. 约定 / 易踩的坑

- 全程 **ESM**(`"type": "module"`),`moduleResolution: Bundler`,相对导入省略扩展名;用 `tsx`
  运行,**不加后端编译步骤**。
- **Express 5** 路由参数是 `string | string[]`,网关用本地 `param(req, key)` 收敛,别直接用
  `req.params.x`。
- **zod v4** 配 **MCP SDK 1.29**,工具 `inputSchema` 用原始 zod shape,保持该写法。
- 设置走 `src/core/settings.ts`(`data/settings.json`)+ `/api/settings`,**不暴露环境变量**给
  用户。
- **编码:文件一律 UTF-8 无 BOM。** 中文文档用 Write 工具直接写,不要让会用 PowerShell
  `Set-Content` 重写整文件的工具碰它(会破坏中文/破折号)。`web/src/lib/i18n.tsx` 是唯一获准在
  代码里含 CJK 的文件(编码检查已豁免)。

## 8. 验证手段

目前没有测试套件,闭环靠:`npm run typecheck`(根)、`web/` 里 `npm run build`、`npm run e2e`
(真实 MCP 端到端,需先 `npm run platform`)、`npm run sim`(不接真 agent 跑 notify/ask/status
闭环),加 curl / WS 式探针。委托产物必须自行复验(typecheck、build、UTF-8 乱码扫描、e2e)。
