# 增量规范:通知与未读

为已存在的 `web/` React 应用添加通知/未读层。不要重构现有代码,只做扩展。核心目标:当 Agent 主动向人类发消息(尤其是 **ask**)时,即便人类正在查看其他对话或其他标签页,也必须能注意到。请保持现有审美风格与设计 token 不变。修改完成后,在 `web/` 中运行 `npm run build` 直至通过。

## 背景(现有代码 —— 编辑前请先阅读)

- `web/src/lib/store.tsx` —— `StoreProvider` / `useStore`:持有 `sessions`、每个 session 的消息、当前选中的 session id,以及 `send` / `cancelAsk`。WS 事件汇总在这里。
- `web/src/lib/useSocket.ts` —— 带重连的 WebSocket;会发出 `session` / `message` / `hello` 事件。
- `web/src/components/ContactCard.tsx`、`ContactList.tsx`、`ConversationHeader.tsx`、`App.tsx`。
- 消息结构:`{ id, sessionId, direction:'agent'|'human', kind:'notify'|'ask'|'answer'|'chat'|'status', text, askId, meta, createdAt }`。

## 1. 未读跟踪(在 store 中实现)

- 维护 `unreadBySession: Record<string, number>`,并记录最近一条未读是否包含一个待处理的 ask。
- 当一条 **agent→human** 消息到达时(`direction === 'agent'`,kind 为 `notify | ask | chat`)且该 session 不是当前选中的(或者标签页被隐藏 —— 见下文),为对应 session 的未读数 +1。绝不要把人类(`human`)或 `status` 消息计入未读。
- 当某个 session 被选中时,或者标签页重新获得焦点且它就是当前选中的 session 时,将其未读数重置为 0。
- 通过 store 对外暴露 `unreadBySession`、`totalUnread`,以及按 session 的 `hasPendingAsk`(派生:一个 `ask` 消息的 `askId` 在之后没有对应的人类 `answer`)。

## 2. 联系人卡片上的徽章

- 在 `ContactCard` 上,当 `unread > 0` 时,在右侧显示一个未读计数胶囊。使用品牌强调色;如果该 session `hasPendingAsk` 为真,则改用琥珀色,并配上一个小的圆点/`?` 标记,以保持"需要你关注"这一信号的视觉主导地位。
- 保留现有的"Needs you" / 状态样式;未读徽章作为对它的补充。

## 3. 文档标题

- 当 `totalUnread > 0` 时,在 `document.title` 之前加上 `(${totalUnread})`。如果任意 session 存在待处理的 ask,在标签页被隐藏期间,还要让标题在 `● Beacon` 与带计数的标题之间**闪烁**切换(频率约 1 秒一次);当标签页重新获得焦点且没有未读时,恢复为干净的标题。
- 建议把这一逻辑集中在一个小的 `useDocumentTitle` hook 中,或者在 `App.tsx` 的 effect 中实现。

## 4. 桌面通知(Web Notifications API)

- 提供一个克制而友好的授权入口:在侧边导航栏或头部放一个铃铛按钮,点击触发 `Notification.requestPermission()`。如果当前权限是 `default`,只显示一次简短、不打扰的提示("Enable notifications so you don't miss when an agent needs you")。不要反复骚扰用户,并把"已忽略"的状态记录到 localStorage 中。
- 当一条 **agent→human** 消息到达,并且(标签页被隐藏 或 该消息所属的 session 不是当前选中的)且权限为 `granted` 时,触发一条 `new Notification(...)`:
  - title:该 session 的 `task`(若为空则使用 `runtime`)。
  - body:若是 `ask` → `❓ ` + 问题正文;若是 `notify` → 正文;若是 `chat` → 正文。
  - tag:session id(这样同一 session 的多条通知会折叠而不是堆叠)。
  - icon:应用的 favicon(`/favicon.svg`)。
  - on `click`:`window.focus()`,在 store 中选中该 session,然后 `notification.close()`。
- 防抖:对同一 session,两次通知之间至少间隔约 3 秒。
- 所有相关代码都要用 `'Notification' in window` 保护,确保在不支持的环境中构建/运行也安全。

## 5. 可选的轻量提示音(仅在实现简单时启用)

- 如果在标签页被隐藏期间收到一个待处理的 `ask`,可选地通过 WebAudio API 播放一段极短、柔和的提示音(无需额外音频文件)。请保持音量克制,且与通知使用同一套触发门控。如果会增加构建复杂度,请直接跳过 —— 通知 + 标题闪烁 + 徽章是核心优先级。

## 验收标准

- `npm run build` 通过。
- 打开第二个 session 并在第一个 session 上收到一条 Agent 消息时,第一个 session 上应出现未读徽章,并且文档标题应同步更新;在已授权且标签页被隐藏时,应出现桌面通知,点击该通知会把应用切回前台并定位到对应 session。
- 现有的 chat / ask / answer 流程和视觉设计不得出现回归。
