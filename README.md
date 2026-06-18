# Beacon

**An agent-native instant-messaging platform.** Humans and AI agents talk over a
neutral, runtime-agnostic bus: you message a specific agent, and an agent can
reach you **on its own initiative** while it works, only when it judges it worth
your attention.

Unlike a chatbot (human-driven, one question at a time), an agent runs long tasks
autonomously and contacts you with two clear semantics:

- **`notify`** — a non-blocking heads-up; the agent keeps working.
- **`ask`** — a blocking question; the agent's task pauses until you answer.

Each agent task is its own **session** (its own work path / context), shown to you
as a contact with a live **status** (working / waiting / idle / done).

**English** · [中文说明](#beacon-中文)

---

## Quick start

```bash
npm install                 # backend deps (repo root)
cd web && npm install && cd ..

npm start                   # build the web UI + serve UI+API+WS on one port
                            # → http://127.0.0.1:4319
```

Open **http://127.0.0.1:4319**. It starts empty — connect an agent (below). To see
it in motion without a real agent:

```bash
npm run sim                 # a simulated agent: reports progress, then blocks on a
                            # question; answer it in the UI and it continues
```

## Connect an agent (two ways)

### 1) Hosted MCP — recommended, one global command

The platform hosts an MCP server over HTTP at `/mcp`. Onboarding is a single
global, path-free command — and it **never changes when you update Beacon**,
because the URL is the contract:

```bash
claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp
```

`-s user` registers it for every project at once. Restart Claude Code and `beacon`
shows up in `/mcp` with five tools: `register_session`, `notify_human`,
`ask_human`, `update_status`, `check_inbox`.

### 2) Zero-config skill — for Claude Code, no MCP

No MCP, no restart, no absolute paths. Install once, use in any session:

```bash
cp -r skill/beacon ~/.claude/skills/beacon
# Windows: copy skill\beacon to %USERPROFILE%\.claude\skills\beacon
```

Then the agent talks to you via the bundled CLI:

```bash
node <skill>/beacon.mjs register "What I'm working on"
node <skill>/beacon.mjs notify   "progress update..."
node <skill>/beacon.mjs ask      "Proceed?" "Approve" "Hold"   # blocks, prints your answer
node <skill>/beacon.mjs status   done
node <skill>/beacon.mjs inbox                                  # read messages you sent
```

It talks straight to the platform HTTP API (default `http://127.0.0.1:4319`, override
with `PLATFORM_URL`), caching the session per work directory.

> Runtime support: **Claude Code (skill and MCP) is verified working.** codex +
> MiniMax-M3 does not currently route MCP tool calls (returns `unsupported call`) —
> that's a codex-side limitation; the zero-config skill (way 2) is unaffected.

The in-app **Connect** panel generates copy-paste snippets for all of the above,
filled with the right URL/paths.

## What you see in the UI

| You see | Means | You do |
|---|---|---|
| Left contact + status dot | one per agent task | click to open the conversation |
| Quiet 🔔 line | `notify` — FYI, no reply needed | glance |
| Amber "needs your decision" card | `ask` — agent is blocked on you | tap an option or type a reply |
| Bottom composer | message the agent anytime | agent reads it via `inbox` / `check_inbox` |
| Header `⋯` menu | rename or archive the conversation | keep your list tidy |
| Language toggle (left rail) | switch 中文 / English | persists across sessions |

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

## Roadmap

Multi-user accounts + human-side login, Matrix/Element backend (mobile/multi-device),
remote MCP for cloud agents, per-agent API keys, packaged deployment.

---
---

# Beacon (中文)

一个**面向 Agent 的即时通讯平台**。人和 AI agent 通过一个中立、与运行时无关的消息总线交流:
人可以给某个具体 agent 发消息,agent 也能在自己干活时**主动**找人——只在它判断值得的时候。

与聊天机器人(人驱动、一问一答)不同:agent 自主跑长任务,按自己的判断联系你,用两种语义——

- **`notify`** —— 非阻塞的"知会一声",agent 继续工作。
- **`ask`** —— 阻塞式提问,agent 的任务暂停,直到你回答。

每个 agent 任务是一个独立的 **session**(独立工作路径/上下文),在你这边显示为一个带实时**状态**
(working / waiting / idle / done)的联系人。

[English](#beacon) · **中文**

## 快速开始

```bash
npm install                 # 后端依赖(根目录)
cd web && npm install && cd ..

npm start                   # 构建前端 + 一个端口托管 UI+API+WS  → http://127.0.0.1:4319
```

打开 **http://127.0.0.1:4319** 就是人机交互界面。一开始是空的,接一个 agent 进来即可。想先看效果:

```bash
npm run sim                 # 模拟一个 agent:报告进度,然后抛一个问题阻塞;你在界面回答它就继续
```

## 接入一个 agent(两种方式)

### 方式一:托管式 MCP —— 推荐,一行全局命令

平台自身在 `/mcp` 暴露 HTTP MCP 端点。接入只需一行**全局、零路径**命令,而且**平台升级时命令不变**——
URL 就是契约:

```bash
claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp
```

`-s user` 让它对所有项目全局生效。重启 Claude Code,`beacon` 就出现在 `/mcp` 列表,带五个工具:
`register_session` / `notify_human` / `ask_human` / `update_status` / `check_inbox`。

### 方式二:零配置 skill —— 给 Claude Code,无需 MCP

不需要 MCP、不需要重启、不需要绝对路径。装一次,任意会话可用:

```bash
cp -r skill/beacon ~/.claude/skills/beacon
# Windows: 复制 skill\beacon 到 %USERPROFILE%\.claude\skills\beacon
```

之后 agent 用自带 CLI 跟你对话:

```bash
node <skill>/beacon.mjs register "我在做的任务"
node <skill>/beacon.mjs notify   "进度更新…"
node <skill>/beacon.mjs ask       "要不要这么干?" "Approve" "Hold"   # 阻塞,直接返回你的答复
node <skill>/beacon.mjs status    done
node <skill>/beacon.mjs inbox                                       # 读你发来的消息
```

它直连平台 HTTP API(默认 `http://127.0.0.1:4319`,可用 `PLATFORM_URL` 覆盖),会话按工作目录自动缓存。

> 运行时支持现状:**Claude Code(skill 与 MCP)均已验证可用**。codex + MiniMax-M3 目前不路由 MCP 工具调用
> (返回 `unsupported call`),属 codex 侧限制;用方式二(skill,走命令)不受影响。

界面里的「接入 Agent」面板会为以上方式自动生成填好 URL/路径的可复制片段。

## 你在界面里看到什么

| 看到 | 含义 | 你怎么做 |
|---|---|---|
| 左侧联系人 + 状态点 | 每个 agent 任务一个 | 点击进入对话 |
| 🔔 低调小条消息 | `notify` —— 知会,不用回 | 看一眼 |
| 琥珀色「需要你决策」卡片 | `ask` —— agent 卡住等你 | 点选项 或 打字回答 |
| 底部输入框 | 随时给 agent 发消息 | agent `inbox` / `check_inbox` 时读到 |
| 头部 `⋯` 菜单 | 重命名 / 归档会话 | 保持列表整洁 |
| 左栏语言开关 | 中文 / English 切换 | 记忆到本地 |

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

## 路线图

多用户账户 + 人侧登录鉴权、Matrix/Element 后端(手机多端)、远程 MCP 让云端 agent 直接指向 URL 接入、
每 agent 独立 API key、部署打包。
