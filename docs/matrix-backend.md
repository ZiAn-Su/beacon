# Matrix 后端(路线图)

面向人类的界面是可插拔的(参见 `src/backends/contract.ts`)。默认是自带的 React UI。一个 **Matrix** 后端能让你免费获得成熟的 Web/桌面/**移动端**客户端(Element),—— 当你想要从手机指挥 Agent,或者跨组织联邦化时,这会非常有用。这正是 [HiClaw](https://github.com/agentscope-ai/HiClaw) 验证过的方案。

我们刻意**不**采用一整套臃肿的多 Agent 技术栈(K8s、对象存储、网关、Manager-Workers) —— 那些要解决的是不同的问题。本后端只是一座轻量的桥。

## 形态

运行一个轻量级的 Matrix homeserver(Conduit / conduwuit / Tuwunel —— Rust,单一二进制),并注册一个 **application service**(appservice)。这个 appservice 就是 `ChatBackend` 本身:

| platform concept            | Matrix mapping                                              |
| --------------------------- | ---------------------------------------------------------- |
| session (一个 Agent 任务)   | 一个 room;Agent 是 room 中的虚拟("ghost")用户              |
| session 状态                | room 名后缀 / 一个 `m.room.topic` 或自定义 state 事件      |
| `notify` 消息                | Agent ghost 发出的一条普通 `m.room.message`                |
| `ask` 消息 + 选项            | 一条 `m.room.message`,选项以按钮 / 文本形式渲染           |
| 人类的回复                   | 人类发出的 `m.room.message` → `store.reply(sessionId,…)`   |
| 对一个 ask 的回答            | 引用了 ask 的回复 → `store.reply(…, askId)`                 |

## 接线方式(伪代码)

```ts
// agent -> human
bus.on('session', s => ensureRoomFor(s));               // create/label a room per session
bus.on('message', m => sendToRoom(roomFor(m.sessionId), m));

// human -> agent
appservice.on('m.room.message', ev => {
  const sessionId = sessionForRoom(ev.room_id);
  const askId = pendingAskFor(sessionId);               // if the room is waiting on an ask
  store.reply(sessionId, ev.body, askId);               // resolves the ask, unblocks the agent
});
```

## 为什么它可以保持"即插即用"

状态机、ask 的阻塞处理以及历史记录都由核心层承担。后端只需要把事件镜像出去(`bus`),并把回复送入(`store.reply`)。MCP 南向接口和各个 Agent 端都保持不变 —— 它们无从知晓背后挂的是哪一个后端。

可使用的库:`matrix-appservice-bridge` 或 `matrix-bot-sdk`。部署方式:`docker compose` 拉起 homeserver + Element Web + 这个 appservice。
