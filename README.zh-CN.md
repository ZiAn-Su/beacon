# Beacon

[English](README.md) | **中文**

### 你的智能体会主动找你。

别再盯着你的 agent 干活了。**Beacon** 是一个开源、面向 Agent 的通信总线:你的 AI agent
自主跑长任务,在它**需要你拍板**或想同步进展的那一刻,**主动**联系你——不是又一个要你去戳的
聊天框,而是一条由 **agent 发起对话**的中立总线,只在它判断值得时才打扰你。

`MIT 开源` · `为 MCP + agent 而生` · `自托管`

> **▶ 40 秒 demo**(动图待录)—— agent 自主干活,你的屏幕亮起一条 `notify`,它抛出一个
> `ask` 并**阻塞**,你点一下答复,它继续。想现在就看、又不想配真 agent?`npm run sim`。

---

## 为什么 Beacon 不是聊天机器人

方向是反的。

|          | 聊天机器人              | **Beacon**                                |
|----------|------------------------|-------------------------------------------|
| 谁发起   | **你**发问、你等它答    | **agent**主动来找你,只在值得时            |
| 活在哪   | 活在聊天窗口里          | 自主在后台跑;消息只是那个触点             |
| 每个线程 | 一个你不停去戳的 bot    | 一个**任务** = 一个带实时状态的联系人      |
| 你的注意力 | 你得去查看它          | 它来 ping 你——`notify` 知会,`ask` 阻塞   |

你管理的不是一段对话,而是一批正在干活的 agent——而它们会来找你。

## 两种语义

借鉴优秀队友的协作方式:

- **`notify`** —— 非阻塞的"知会一声"。agent 继续工作,你的屏幕只是亮起一条 FYI。
- **`ask`** —— **阻塞式**提问。agent 的任务**暂停**,直到你回答,再带着你的决定继续。

```
agent 干活 ──notify──▶  你瞄一眼,agent 照常继续
agent 干活 ──ask────▶  ⏸ 阻塞 ──▶ 你回答 ──▶ ▶ agent 继续
```

每个 agent 任务是一个 **session**:一条独立的工作路径,在你这侧显示为一个带实时状态的
联系人——`working` / `waiting` / `idle` / `done`。

## 快速开始 —— 5 分钟看到效果,零 agent 配置

```bash
npm install                 # 后端依赖(根目录)
npm start                   # 自动装好并构建前端,再用一个端口托管 UI+API+WS
                            # → http://127.0.0.1:4319
```

`npm start` 会替你完成前端的安装与构建——不需要单独 `cd web` 那一步。

打开 **http://127.0.0.1:4319**,一开始是空的。想**不配真 agent**就看到完整的 notify/ask
闭环:让服务跑着,另开一个终端——

```bash
npm run sim                 # 模拟一个 agent:报告进度,然后抛一个问题阻塞;你在界面回答它就继续
```

这是体会 Beacon 最快的方式。准备好之后,照下面接一个真 agent 进来。

## 接入一个 agent

完整接入步骤、命令与工具清单见 **[`docs/connect-agent.md`](docs/connect-agent.md)**(单一
事实源)。两种主要方式:

- **托管式 MCP(推荐)** —— 一条全局命令,平台升级命令不变(URL 即契约)。
- **零配置 skill(给 Claude Code,无需 MCP)** —— 装一次,任意会话可用。

```bash
claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp   # 托管 MCP
cp -r skill/beacon ~/.claude/skills/beacon                                  # 零配置 skill
```

通过 MCP,agent 拿到 **19 个工具**:核心 5 个(`register_session`、`notify_human`、
`ask_human`、`update_status`、`check_inbox`),agent 目录与互联 7 个(`list_agents`、
`notify_agent`、`ask_agent`、`answer_agent`、`request_contact`、`spawn_agent`、
`update_profile`),群聊 4 个(`list_channels`、`post_channel`、`ask_channel`、
`answer_channel`),以及按需拉取上下文的 3 个(`read_channel`、`get_agent`、`whoami`)。

> 运行时支持:**Claude Code** 完整可用(skill + MCP)——也可通过 **`ccs`** 跑别的模型
> (如 MiniMax-M3,写作 `ccs:mm`;ccs 本质是把 Claude Code 路由到其它供应商)。**Codex**
> 作为可拉起的终端运行时支持。详见 [`docs/connect-agent.md`](docs/connect-agent.md)。

## 你会得到什么

**每个任务都是一个联系人。** 每个 agent 任务一个 session,各带一个在线点(在线 = agent
进程确实在跑)和一个状态。

**每个对话两个视图:**

- **消息** —— 策展过的对话:agent 主动发来的 `notify`/`ask`,加上你的回复。你发的消息一旦被
  agent 读到,会显示绿色 ✓。
- **终端** —— 一个完整嵌入式终端,直接驱动 agent(`claude --continue` / `codex` / 交互式
  shell)。颜色、键盘快捷键、所有 tool call,和你在本地操作完全一致。它**持久化**:切标签或
  刷新页面,几十毫秒内重新附加到同一个活进程(输出有缓冲)。空闲 30 分钟后自动回收。

**owner 主导的权限。** Claude Code 式的 `allow` / `ask` / `deny`,按能力(联系、注册、拉起)
管控:可设全局默认、单 agent 覆盖、或按对规则。新 agent 先隔离、等你准入——**没有你点头就不
行动**。

**agent ↔ agent 通信。** agent 之间也能 `notify` / `ask`、发起联系申请,且**全程经平台中转**,
每一次交流你都看得见、能介入。

**群组频道。** 人与多个 agent 在同一个房间协作——成员管理、消息扇出到每个 agent 的终端、两级
已送达/已读回执、`@` 定向(被点名者收到 `(addressed to YOU)`),以及拉取工具(`read_channel`
/ `get_agent` / `whoami`)让 agent 发言前先了解语境。**每个频道都有人(监护人)在场**——不存
在纯智能体的聊天。

**多模型运行时。** Claude Code、Codex,或通过 `ccs` 把 Claude Code 路由到别的模型;都能在界面
里拉起、恢复、对话。

## 工作原理

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
- **人侧界面可插拔**(`src/backends/contract.ts`):默认自带 React UI;Matrix/Element 后端是
  有文档的 drop-in(`docs/matrix-backend.md`)。

完整设计已开放:[`docs/architecture.md`](docs/architecture.md) 与
[`docs/identity-design.md`](docs/identity-design.md)。

### 为在用中原地升级而设计

平台被设计为在使用中也能升级:

- **契约稳定**(MCP URL、REST API、skill 命令)升级不变,已接入的 agent 无需重配。
- **数据跨升级保留**:`data/beacon.db` 不随代码升级改动;表结构只增不改
  (`ALTER TABLE ADD COLUMN`),旧库原地迁移、零丢失。
- **版本可见**:`GET /api/health` 与接入面板返回 `version`。
- **升级**:`npm run update`,然后 `npm run platform` 重启。

可选 `PLATFORM_TOKEN` 给 agent 入口加鉴权(人侧本地 UI 不变);SQLite 默认 `data/beacon.db`,
可用 `BEACON_DB` 覆盖。

## 常用命令

```bash
npm run platform     # 启动网关(REST + WS + /mcp)  http://127.0.0.1:4319
npm start            # 构建前端 + 启动(一个端口托管一切)
npm run sim          # 不接真 agent,演示 notify/ask/status 闭环
npm run e2e          # stdio MCP 端到端回归(需先 npm run platform)
npm run e2e:http     # 托管 HTTP MCP 端到端冒烟
npm run verify       # typecheck + 编码扫描 + 测试 + 前端构建
npm run update       # git pull && npm install && npm run build:web
cd web && npm run dev  # 前端开发服务器 :5173(代理 /api + /ws 到 :4319)
```

## 路线图

**现已上线:**

- 核心 `notify` / `ask` / `status` 语义,带每任务 presence。
- 消息 + 嵌入式终端双视图。
- owner 主导的权限(`allow` / `ask` / `deny`,首次联系即隔离)。
- agent ↔ agent 通信,全程经平台中转。
- 群组频道(成员、扇出、已送达/已读回执、`@` 定向、拉取工具)。
- 多模型运行时(Claude Code、Codex、`ccs`)。
- 契约稳定、迁移 additive 的原地升级。

**接下来:**

- **多人与监护** —— 多个人、各自拥有自己的 agent;人侧登录鉴权。
- **触达** —— Matrix/Element 后端(手机多端)、远程 MCP 让云端 agent 直接指向 URL 接入、每
  agent 独立 API key、部署打包。

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

## 许可证

[MIT](LICENSE)。自由使用。
