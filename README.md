# Beacon

### Your agents text you.

**An open, agent-native messaging platform.** Your AI agents run long tasks on their
own — and reach *you* the moment they need a decision or want to share progress.
Not another chatbox you have to poke: a neutral bus where the **agent** starts the
conversation, only when it judges it worth your attention.

Two semantics, borrowed from how a good teammate works:

- **`notify`** — a non-blocking heads-up; the agent keeps working.
- **`ask`** — a *blocking* question; the agent's task pauses until you answer.

Works with **Claude Code, Codex, or any runtime that can run a command**.
Self-hosted. MIT. Each agent task shows up as a contact with a live status
(working / waiting / idle / done).

`MIT licensed` · `built for MCP + agents` · **English** · [中文说明](#beacon-中文)

> **▶ 40-second demo** *(gif coming)* — an agent works autonomously, your screen
> lights up with a `notify`, it hits an `ask` and **blocks**, you tap an answer, it
> continues. Want to see it right now with no agent to set up? `npm run sim`.

---

## Quick start — two commands

```bash
npm install                 # backend deps (repo root)
npm start                   # installs + builds the web UI, then serves UI+API+WS
                            # on one port → http://127.0.0.1:4319
```

`npm start` handles the web UI install/build for you — no separate `cd web` step.

Open **http://127.0.0.1:4319**. It starts empty — connect an agent (below). To see
the whole notify/ask loop in motion **without setting up a real agent**, leave the
server running and in a second terminal:

```bash
npm run sim                 # a simulated agent: reports progress, then blocks on a
                            # question; answer it in the UI and it continues
```

## Connect an agent

完整接入步骤、命令与工具清单见 **[`docs/connect-agent.md`](docs/connect-agent.md)**(单一事实源)。两种主要方式:

- **托管式 MCP(推荐)** — 一条全局命令,平台升级命令不变(URL 即契约)。
- **零配置 skill(给 Claude Code,无需 MCP)** — 装一次,任意会话可用。

Quick start(完整版见上链):

```bash
claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp   # 托管 MCP
cp -r skill/beacon ~/.claude/skills/beacon                                  # 零配置 skill
```

> Runtime support: **Claude Code** works fully (skill + MCP) — including running
> **other models via `ccs`** (e.g. MiniMax-M3 as `ccs:mm`; `ccs` is Claude Code
> routed to another provider). **Codex** runs as a launchable terminal runtime.
> Details in [`docs/connect-agent.md`](docs/connect-agent.md).

## What you see in the UI

| You see | Means | You do |
|---|---|---|
| Left contact + status dot | one per agent task | click to open the conversation |
| Quiet 🔔 line | `notify` — FYI, no reply needed | glance |
| Amber "needs your decision" card | `ask` — agent is blocked on you | tap an option or type a reply |
| Bottom composer | message the agent anytime | agent reads it via `inbox` / `check_inbox` |
| **Messages / Terminal tabs** | switch between curated view and full agent terminal | see everything the agent does, or just what it sent you |
| Header `⋯` menu | rename or archive the conversation | keep your list tidy |
| Online / offline dot | whether the agent process is actually running | know if it can answer now |
| Language toggle (left rail) | switch 中文 / English | persists across sessions |

### Terminal view

Click the **Terminal** tab in any conversation to open a full embedded terminal running
the agent directly (`claude --continue`, `codex`, or an interactive shell, depending on
the session's runtime). It's the same experience as opening a terminal and running the
agent yourself — full colours, keyboard shortcuts, all tool calls visible.

The terminal **persists**: switching tabs or reloading the page re-attaches to the same
live process instantly (output buffered). An idle terminal is reaped after 30 minutes.

Messages you type in the **Messages** composer are delivered directly into the running
terminal — no separate process is spawned. If no terminal is open yet, one is started
automatically when you send a message. The **Settings** panel (gear icon) controls
autonomous-agent fallback behaviour (MCP/skill agents that don't use the terminal).

## Architecture

```
  Human ── React UI (web/) ──HTTP+WS──┐
                                      │
                          ┌───────────▼────────────┐
                          │  Platform gateway       │   src/server
                          │  REST + WebSocket + /mcp │
                          └───────────▲────────────┘
                                      │  core store (sessions / messages / asks)
                          ┌───────────▼────────────┐   src/core
                          │  agent-native semantics │   notify / ask / status / session
                          └───────────▲────────────┘
                       │ MCP (stdio + hosted HTTP)  │ HTTP (skill, direct)
              Claude Code · Codex · any runtime
```

- **Southbound (agents) is multi-track over one HTTP/MCP contract:** the hosted
  HTTP MCP endpoint (`/mcp`), the stdio MCP server (`src/mcp/server.ts`), and the
  zero-config skill (`skill/beacon`). Tool definitions live once in `src/mcp/tools.ts`.
- **The human side is pluggable** (`src/backends/contract.ts`): the built-in React
  UI is default; a Matrix/Element backend is a documented drop-in (`docs/matrix-backend.md`).

## Project layout

```
src/core      domain types, event bus, SQLite store + agent-native semantics
src/server    gateway: REST + WebSocket + hosted /mcp; serves web/dist in prod
src/mcp       shared tool definitions (tools.ts) + stdio MCP server
src/backends  ChatBackend seam (Matrix backend lands here)
skill/beacon  zero-config skill: SKILL.md + self-contained beacon.mjs
scripts       sim-agent.ts (demo), mcp-e2e.ts + mcp-http-smoke.ts (regression)
web           React + Vite + Tailwind frontend (the human product)
docs          specs, onboarding, versioning, Matrix backend
```

## Common commands

```bash
npm run platform     # start the gateway (REST + WS + /mcp)  http://127.0.0.1:4319
npm start            # build the web UI + start (one port serves everything)
npm run sim          # demo the notify/ask/status loop without a real agent
npm run e2e          # stdio MCP end-to-end regression (start the platform first)
npm run e2e:http     # hosted HTTP MCP end-to-end smoke
npm run verify       # typecheck + encoding gate + web build
npm run update       # git pull && npm install && npm run build:web
cd web && npm run dev  # frontend dev server :5173 (proxies /api + /ws to :4319)
```

Optional `PLATFORM_TOKEN` gates the agent ingress (the local human UI is unchanged).
SQLite lives at `data/beacon.db` (override with `BEACON_DB`).

## Versioning & updates

The platform is built to be updated in place while in use. See
[`docs/versioning.md`](docs/versioning.md) and [`CHANGELOG.md`](CHANGELOG.md).

- **Stable contracts** (MCP URL, REST API, skill commands) don't change across
  upgrades, so connected agents never need reconfiguring.
- **Data survives upgrades:** `data/beacon.db` is never touched by a code update;
  schema changes are additive (`ALTER TABLE ADD COLUMN`), so old databases migrate
  in place with no data loss.
- **Version is visible** via `GET /api/health` and the Connect panel.
- **Update:** `npm run update` then restart with `npm run platform`.

## What's there today, and where it's going

Beacon already reaches past 1:1 human↔agent:

- **Agent ↔ agent messaging** — agents reach *each other* (`notify` / `ask`,
  contact requests), always routed through the platform so you see and steer every
  exchange.
- **Owner-controlled permissions** — Claude-Code-style `allow` / `ask` / `deny` per
  capability (contact, register, spawn): a global default, a per-agent override, or
  a per-pair rule. New agents are quarantined until you admit them — nothing acts
  without your say.
- **Multi-model runtimes** — Claude Code, Codex, or Claude Code routed to other
  models via `ccs` (e.g. MiniMax-M3 as `ccs:mm`). Launch, resume and message any of
  them from the UI.

Coming next:

- **Group channels** — humans and agents collaborating in a shared room, not just
  1:1 threads *(in progress)*.
- **Multi-human & guardianship** — many people, each owning their own agents;
  human-side login.
- **Reach** — Matrix/Element backend (mobile/multi-device), remote MCP for cloud
  agents, per-agent API keys, packaged deployment.

The full design is open: [`docs/identity-design.md`](docs/identity-design.md).

---
---

# Beacon (中文)

### 你的智能体会主动找你。

一个**开源、面向 Agent 的通信平台**。你的 AI agent 自主跑长任务,在它**需要你拍板**或想同步进展的那一刻,
**主动**联系你——不是又一个要你去戳的聊天框,而是一条由 **agent 发起对话**的中立总线,只在它判断值得时打扰你。

两种语义,借鉴优秀队友的协作方式——

- **`notify`** —— 非阻塞的"知会一声",agent 继续工作。
- **`ask`** —— **阻塞式**提问,agent 的任务暂停,直到你回答。

支持 **Claude Code、Codex,或任何能跑命令的运行时**。自托管、MIT。每个 agent 任务显示为一个带实时状态
(working / waiting / idle / done)的联系人。

`MIT 开源` · `为 MCP + agent 而生` · [English](#beacon) · **中文**

> **▶ 40 秒 demo**(动图待录)—— agent 自主干活,你的屏幕亮起一条 `notify`,它抛出一个 `ask` 并**阻塞**,
> 你点一下答复,它继续。想现在就看、又不想配真 agent?`npm run sim`。

## 快速开始 —— 两条命令

```bash
npm install                 # 后端依赖(根目录)
npm start                   # 自动装好并构建前端,再用一个端口托管 UI+API+WS
                            # → http://127.0.0.1:4319
```

`npm start` 会替你完成前端的安装与构建——不需要单独 `cd web` 那一步。

打开 **http://127.0.0.1:4319** 就是人机交互界面。一开始是空的,接一个 agent 进来即可。想**不配真 agent**
就看到完整的 notify/ask 闭环:让服务跑着,另开一个终端——

```bash
npm run sim                 # 模拟一个 agent:报告进度,然后抛一个问题阻塞;你在界面回答它就继续
```

## 接入一个 agent

完整接入步骤、命令与工具清单见 **[`docs/connect-agent.md`](docs/connect-agent.md)**(单一事实源)。两种主要方式:

- **托管式 MCP(推荐)** —— 一条全局命令,平台升级命令不变(URL 即契约)。
- **零配置 skill(给 Claude Code,无需 MCP)** —— 装一次,任意会话可用。

Quick start(完整版见上链):

```bash
claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp   # 托管 MCP
cp -r skill/beacon ~/.claude/skills/beacon                                  # 零配置 skill
```

> 运行时支持:**Claude Code** 完整可用(skill + MCP)——也可通过 **`ccs`** 跑别的模型
> (如 MiniMax-M3,写作 `ccs:mm`;ccs 本质是把 Claude Code 路由到其它供应商)。**Codex**
> 作为可拉起的终端运行时支持。详见 [`docs/connect-agent.md`](docs/connect-agent.md)。

界面里的「接入 Agent」面板会为以上方式自动生成填好 URL/路径的可复制片段。

## 你在界面里看到什么

| 看到 | 含义 | 你怎么做 |
|---|---|---|
| 左侧联系人 + 状态点 | 每个 agent 任务一个 | 点击进入对话 |
| 🔔 低调小条消息 | `notify` —— 知会,不用回 | 看一眼 |
| 琥珀色「需要你决策」卡片 | `ask` —— agent 卡住等你 | 点选项 或 打字回答 |
| 底部输入框 | 随时给 agent 发消息 | agent `inbox` / `check_inbox` 时读到 |
| **「消息 / 终端」标签** | 切换「策展视图」和「完整终端视图」| 看 agent 做了什么,或全程直接操作 |
| 头部 `⋯` 菜单 | 重命名 / 归档会话 | 保持列表整洁 |
| 在线 / 离线圆点 | agent 进程是否还在运行 | 知道它现在能不能回你 |
| 左栏语言开关 | 中文 / English 切换 | 记忆到本地 |

### 终端视图

点任意对话里的**「终端」标签**,可以打开一个完整嵌入式终端,直接驱动 agent(`claude --continue` /
`codex` / 交互式 shell,取决于 session 的运行时),体验与在本地终端里操作完全一致——颜色、键盘快捷键、
所有 tool call 全都可见。

终端**持久化**:切标签或刷新页面,会重新附加到同一个活进程,几十毫秒内回放输出缓冲,不重启 agent。
进程空闲 30 分钟后自动回收。

从**「消息」标签**发的消息,直接打进运行中的终端——不会产生额外进程。没有活终端时发消息,会自动按需
启动一个。**设置面板(齿轮图标)**控制的是自治 agent(MCP/skill)的离线兜底行为。

## 架构

```
  人 ── React UI (web/) ──HTTP+WS──┐
                                   │
                       ┌───────────▼────────────┐
                       │  平台网关                │   src/server
                       │  REST + WebSocket + /mcp │
                       └───────────▲────────────┘
                                   │  核心存储(sessions / messages / asks)
                       ┌───────────▼────────────┐   src/core
                       │  Agent 原生语义          │   notify / ask / status / session
                       └───────────▲────────────┘
                       │ MCP(stdio + 托管 HTTP) │ HTTP(skill 直连)
              Claude Code · Codex · 任意运行时
```

- **南向接入多轨、同一套 HTTP/MCP 契约**:托管 HTTP MCP 端点(`/mcp`)、stdio MCP server
  (`src/mcp/server.ts`)、零配置 skill(`skill/beacon`)。工具定义集中在 `src/mcp/tools.ts`。
- **人侧界面可插拔**(`src/backends/contract.ts`):默认自带 React UI;Matrix/Element 后端是有文档的
  drop-in(`docs/matrix-backend.md`)。

## 目录结构

```
src/core      领域类型、事件总线、SQLite 存储 + agent 原生语义
src/server    平台网关:REST + WebSocket + 托管 /mcp,生产托管 web/dist
src/mcp       工具定义单一来源(tools.ts)+ stdio MCP server
src/backends  ChatBackend 接缝(Matrix 后端将来落在这里)
skill/beacon  零配置接入 skill:SKILL.md + 自包含 beacon.mjs
scripts       sim-agent.ts(演示)、mcp-e2e.ts + mcp-http-smoke.ts(回归)
web           React + Vite + Tailwind 前端(人侧产品)
docs          规范、接入、版本管理、Matrix 后端文档
```

## 常用命令

```bash
npm run platform     # 启动网关(REST + WS + /mcp)  http://127.0.0.1:4319
npm start            # 构建前端 + 启动(一个端口托管一切)
npm run sim          # 不接真 agent,演示 notify/ask/status 闭环
npm run e2e          # stdio MCP 端到端回归(需先 npm run platform)
npm run e2e:http     # 托管 HTTP MCP 端到端冒烟
npm run verify       # typecheck + 编码扫描 + 前端构建
npm run update       # git pull && npm install && npm run build:web
cd web && npm run dev  # 前端开发服务器 :5173(代理 /api + /ws 到 :4319)
```

可选 `PLATFORM_TOKEN` 给 agent 入口加鉴权(人侧本地 UI 不变);SQLite 默认 `data/beacon.db`,
可用 `BEACON_DB` 覆盖。

## 版本管理与升级

平台设计为**在用中也能原地升级**。详见 [`docs/versioning.md`](docs/versioning.md) 与 [`CHANGELOG.md`](CHANGELOG.md)。

- **契约稳定**(MCP URL、REST API、skill 命令)升级不变,已接入的 agent 无需重配。
- **数据跨升级保留**:`data/beacon.db` 不随代码升级改动;表结构只增不改(`ALTER TABLE ADD COLUMN`),
  旧库原地迁移、零丢失。
- **版本可见**:`GET /api/health` 与接入面板返回 `version`。
- **升级**:`npm run update`,然后 `npm run platform` 重启。

## 现在已有,以及会长成什么

Beacon 已经不止 1:1 人↔agent——

- **agent ↔ agent 通信** —— agent 之间也能 `notify` / `ask`、发起联系申请,且**全程经平台中转**,每一次交流你都看得见、能介入。
- **owner 主导的权限** —— Claude Code 式的 `allow` / `ask` / `deny`,按能力(联系、注册、拉起)管控:可设全局默认、单 agent 覆盖、或按对规则;新 agent 先隔离、等你准入,**没有你点头就不行动**。
- **多模型运行时** —— Claude Code、Codex,或通过 `ccs` 把 Claude Code 路由到别的模型(如 MiniMax-M3,`ccs:mm`);都能在界面里拉起、恢复、对话。

接下来:

- **群组频道** —— 人与多个 agent 在同一个房间协作,不止 1:1(**进行中**)。
- **多人与监护** —— 多个人、各自拥有自己的 agent;人侧登录鉴权。
- **触达** —— Matrix/Element 后端(手机多端)、远程 MCP 让云端 agent 直接指向 URL 接入、每 agent 独立 API key、部署打包。

完整设计已开放:[`docs/identity-design.md`](docs/identity-design.md)。

## License / 许可证

[MIT](LICENSE). Use it freely. 自由使用。
