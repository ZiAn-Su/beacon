# Beacon — 前端实现规范

你正在为一个面向 Agent 的即时通讯平台实现**面向人类的 Web UI**。人类与 AI Agent 进行对话;Agent 主动向人类发消息。它的观感必须像一款**商业级产品** —— 参考 Linear、Vercel、Slack 的水准。不要"AI 味"过重:克制的配色、统一的间距尺度、清晰的视觉层次、恰到好处的动效。

所有实现请**只**放在 `web/` 目录之下。不要改动 `web/` 之外的文件。

## 技术栈(请严格按此使用)

- Vite + React 18 + TypeScript
- Tailwind CSS v4,通过 `@tailwindcss/vite` 插件引入(**不要**使用旧的 PostCSS 配置)
- 不使用组件库。组件全部手写。允许使用 `lucide-react` 来提供图标。
- 状态管理:使用原生 React hooks + 一个轻量的 WebSocket hook。**不要**使用 Redux。

请将 `web/` 作为一个独立的 npm 项目(拥有自己的 `package.json`)。写完代码后,在 `web/` 中依次执行 `npm install` 和 `npm run build`,确保构建**成功**并把产物输出到 `web/dist`。不断修复错误,直到构建完全通过为止。

## Vite 配置(关键 —— 开发环境到后端的代理)

后端运行在 `http://127.0.0.1:4319`。请在 `web/vite.config.ts` 中,设置开发服务器代理 API 和 WebSocket,以避免 CORS 并保证 WS 在开发环境可用:

```ts
server: {
  port: 5173,
  proxy: {
    '/api': { target: 'http://127.0.0.1:4319', changeOrigin: true },
    '/ws':  { target: 'ws://127.0.0.1:4319', ws: true },
  },
}
```

构建默认的 `outDir` 为 `dist`(即最终输出到 `web/dist`)—— 请保持不变。

## 后端 API 契约(必须严格对齐 —— 不要自造端点)

类型(以 TypeScript 表达):

```ts
type SessionStatus = 'registered' | 'working' | 'waiting' | 'idle' | 'done';
interface Session {
  id: string;
  runtime: string;     // "claude-code" | "codex" | "sim-agent" | ...
  workPath: string;    // working directory / task root
  task: string;        // human-readable description
  status: SessionStatus;
  createdAt: number;   // epoch ms
  updatedAt: number;
}
type MsgDirection = 'agent' | 'human';
type MsgKind = 'notify' | 'ask' | 'answer' | 'chat' | 'status';
interface Message {
  id: string;
  sessionId: string;
  direction: MsgDirection;
  kind: MsgKind;
  text: string;
  askId: string | null;                       // set for kind 'ask' and 'answer'
  meta: { options?: string[] } | null;        // ask quick-reply options live here
  createdAt: number;
}
```

REST(均为 JSON):

- `GET  /api/sessions` → `{ sessions: Session[] }`
- `GET  /api/sessions/:id/messages` → `{ session: Session, messages: Message[] }`
- `POST /api/sessions/:id/reply` body `{ text: string, askId?: string }` → `{ message: Message }`
  - 传入 `askId` 表示对一个待处理 ask 的正式"回答"(这会解除 Agent 的阻塞)。不传 `askId` 则视为自由聊天。
- `POST /api/asks/:askId/cancel` → `{ ask }`(在不回答的情况下关闭一个待处理的问题)

WebSocket `GET /ws` —— 服务端以换行分隔的 JSON 对象进行推送:

- `{ type: 'hello', sessions: Session[] }`(连接建立时发送)
- `{ type: 'session', session: Session }`(有 session 被创建或状态发生变化)
- `{ type: 'message', message: Message }`(某个 session 中出现了一条新消息)

WebSocket 是**只推不收**的;客户端不会通过它发送任何数据。连接断开时请按退避策略重连。

## 整体布局

三栏布局,占满整个高度,不会出现整页滚动(只有消息列表本身可以滚动):

```
┌────┬───────────────────────┬──────────────────────────────────────┐
│ R  │  Contacts (sessions)  │  Conversation                        │
│ a  │                       │  ┌ header: identity + status + path ┐ │
│ i  │  [waiting ones first] │  │ message thread (scrolls)         │ │
│ l  │  contact cards        │  │                                  │ │
│    │                       │  └ composer                         ┘ │
└────┴───────────────────────┴──────────────────────────────────────┘
```

- **侧边导航栏**(约 56px):顶部放置产品 logo/标志;底部放置一个深色/浅色主题切换按钮。
- **联系人列表列**(约 320px):头部(显示"Agents"以及当前在线数量),下方是 session 卡片组成的可滚动列表。
- **对话列**(弹性伸缩):头部、可滚动的消息流,以及固定在底部的输入区。

响应式:在 ~768px 以下,一次只显示一列(联系人 → 点击 → 进入对话并显示返回按钮)。

## 联系人列 —— session 卡片

每个 session 对应一个联系人。排序规则:`waiting` 状态的优先排在最前(它们需要人类介入),其余按 `updatedAt` 降序排列。

卡片内容:
- **头像**:一个圆角方形渐变块,根据 session id 确定性生成(对同一 Agent 保持稳定),叠加 runtime 首字母或图标。整体配色应区分明显、风格克制。
- **标题**:`task` 字段(超出时单行截断)。若为空则回退显示 `runtime`。
- **副标题**:`runtime` 标签 + `workPath` 的 basename(例如 `Beacon`),采用低饱和的灰色。
- **状态徽章**(右上角):彩色圆点 + 文本标签。`working` 状态的圆点做柔和的呼吸式脉冲。`waiting` 卡片在左侧加一条琥珀色装饰条并叠加一层微妙的强调色,使其一眼读出"需要你关注"。
- **时间戳**:根据 `updatedAt` 显示相对时间("2m"、"1h"、"now"),采用低饱和的灰色。
- 选中的卡片要有清晰的高亮态;所有卡片都需要提供悬停反馈。

空状态(无 session):居中、友好的展示 —— "No agents connected yet" + 一行小提示 "Connect an agent via MCP and it will appear here.",并配上一枚不显眼的插画/图标。

## 对话列

**头部**:头像 + 任务标题;第二行显示 runtime 标签、完整的 `workPath`(等宽字体、低饱和)以及状态徽章。当状态为 `waiting` 时,头部额外显示一个柔和的"Waiting for your reply"提示胶囊。

**消息流**(页面上唯一可滚动的区域):按时间顺序渲染消息,按发送方向分组,组与组之间留出舒适的间距。新消息到达时自动滚动到底部(但如果用户已经向上滚动离开底部,不要强行拉回 —— 实现要简单:仅当用户本来就已经位于底部时,新消息到来后才滚动到底部)。

按消息类型(kind)分别渲染:
- **chat / answer(人类,direction='human')**:右对齐气泡,使用品牌强调色背景。
- **chat(Agent)**:左对齐气泡,使用中性表面色。
- **notify(Agent)**:左对齐,但视觉上为*次要*层级 —— 颜色略灰、附一枚小"FYI"或铃铛图示,明显比真正的提问要轻。它是"环境性"的更新。
- **ask(Agent)**:一张醒目的**问题卡片**(不是普通气泡):具备明显抬升的表面与琥珀色强调色,标题写"Needs your decision",下方展示问题正文,以及 —— 如果存在 `meta.options` —— 一排可点的选项按钮。点击某个选项会以 `{ text: option, askId }` 调用 reply 接口。
  - 只要该 ask 尚未被回答(即没有同一 `askId`、方向为 'human' 的后续消息),卡片就保持激活/高亮态。
  - 一旦被回答,卡片转为"已解决"状态,内联显示所选答案(例如带勾的"You answered: Proceed")。对应的人类回答气泡也可以在消息流中正常出现。
  - 在待处理的 ask 上提供一个小的"Dismiss"(取消)操作 → `POST /api/asks/:askId/cancel`。
- **status**:如果存在,渲染为居中、克制的系统提示行(可选)。

时间戳使用 `createdAt` 字段,仅在悬停或行内以轻量方式显示,不要给每一行都打时间戳。

**输入区**(固定在底部):
- `textarea` 自动随内容增高。Enter 发送;Shift+Enter 换行。另设一个发送按钮。
- 如果当前 session 有一个**待处理的 ask**,输入区需要把它凸显出来:在输入框上方出现一条细长提示条 "Answering: <question>",并把该 ask 的选项再以芯片形式重复展示一次,以便一键作答;此时键入的文本会和该 `askId` 一起发送。否则文本就以自由聊天的形式发送(不带 askId)。
- 输入为空时禁用发送按钮。不要求乐观更新(WS 推回来的存储消息即可作为回显)。

## 视觉设计系统(请使用以下 token)

将以下值定义为 CSS 变量 / Tailwind theme。深色为主主题,同时支持浅色。

深色主题:
- 背景底色 `#0B0E14`,抬起面 `#141925`,卡片 `#161B27`,边框 `#222A39`
- 文本主色 `#E6EAF2`,次色 `#9AA4B8`,弱化 `#5B6678`
- 品牌/强调色(用于人类侧与主要操作):靛蓝→紫 `#6366F1`→`#8B5CF6`(允许渐变)
- 状态色:working `#34D399`(祖母绿,带脉冲)、waiting `#F59E0B`(琥珀色)、
  idle `#94A3B8`(石板灰)、done `#64748B`(暗灰)、registered `#7C8AA5`
- 危险色 `#EF4444`

浅色主题:对调要合理(背景 `#F7F8FA`,表面使用白色,边框 `#E5E8EF`,文字 `#0B0E14` / `#5B6678`)。

- 字体:Inter(通过 `@fontsource/inter` 加载,或直接使用 CDN `<link>`),并配上系统字体作为回退。路径/id 使用等宽字体。
- 圆角:卡片/气泡 `12–16px`,芯片 `9999px`。间距以 4px 为基本尺度。
- 阴影:柔和、低扩散,绝不能刺眼。优先使用淡边框,而非厚重的阴影。
- 动效:悬停、新消息进入(淡入+上移 6px)、状态变化等使用 120–180ms 的缓动函数。请尊重 `prefers-reduced-motion` 设置。`working` 状态的脉冲应是缓慢、轻柔的透明度/缩放呼吸。
- 风格克制、有品味。留白充足。层次清晰。除头像和主强调色外,不要使用霓虹色、不要堆砌元素、不要滥用渐变。

## 建议的文件结构

```
web/
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx  index.css
    types.ts
    lib/api.ts        // typed fetch wrappers for the REST contract
    lib/useSocket.ts  // WS hook with reconnect; returns latest events / dispatch
    lib/store.ts      // sessions+messages state, reducers over WS+REST (hook or context)
    lib/format.ts     // relative time, avatar gradient from id, path basename
    components/
      Rail.tsx
      ContactList.tsx  ContactCard.tsx
      Conversation.tsx  ConversationHeader.tsx
      MessageList.tsx  MessageItem.tsx  AskCard.tsx
      Composer.tsx
      EmptyState.tsx  StatusBadge.tsx  Avatar.tsx
```

## 验收标准

- `web/` 中执行 `npm run build` 必须成功,并把产物输出到 `web/dist`。
- 在后端运行起来之后,应用应能列出 session、打开对话、清楚地区分渲染 notify / ask / answer;通过点选选项或键入文字并附带 askId 的方式回答 ask 应能正常工作;当新的 session/消息到来时,UI 应能通过 WS 实时更新。
- 观感必须达到真正打磨过的水准 —— 一款你愿意上线发布的产品。
