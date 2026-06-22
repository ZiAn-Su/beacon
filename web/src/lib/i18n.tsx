import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Lightweight, dependency-free i18n. Chinese + English, switchable at runtime,
// persisted to localStorage. Default follows the browser language.

export type Lang = "zh" | "en";

const LANG_KEY = "beacon-lang";

type Dict = Record<string, string>;

const en: Dict = {
  "brand.agents": "agents",

  "rail.notifOn": "Notifications enabled",
  "rail.notifEnable": "Enable desktop notifications",
  "rail.notifBlocked": "Notifications blocked by browser",
  "rail.themeToLight": "Switch to light theme",
  "rail.themeToDark": "Switch to dark theme",
  "rail.langToZh": "切换到中文",
  "rail.langToEn": "Switch to English",
  "rail.langBadge": "EN",

  "contacts.group.pending": "Pending admission",
  "contacts.group.waiting": "Waiting",
  "contacts.group.active": "Active",
  "contacts.group.done": "Done",
  "contacts.group.archived": "Archived",
  "contacts.waitingBadge": "{n} waiting",
  "contacts.pendingBadge": "{n} to admit",
  "contacts.connect": "Connect",
  "contacts.collapse": "Collapse list",
  "contacts.connectAria": "Connect an agent",
  "contacts.empty.title": "No agents connected yet",
  "contacts.empty.desc": "Connect an agent and it will show up here.",
  "contacts.empty.action": "Connect an Agent",
  "contacts.taskFallback": "Working in {name}",
  "contacts.unread": "{n} unread",
  "contacts.unreadNeedsYou": "{n} unread, needs you",

  "conv.empty.title": "Start a conversation",
  "conv.empty.desc":
    "The agent hasn’t sent anything yet. Send a message to kick things off.",
  "conv.titleFallback": "Agent in {name}",
  "conv.copyPath": "Copy path",
  "conv.copied": "Copied",
  "conv.pathPlaceholder": "— not set",
  "conv.back": "Back to agents",
  "conv.showInfo": "Show session info",
  "conv.hideInfo": "Hide session info",
  "conv.showList": "Show contact list",
  "conv.hideList": "Hide contact list",
  "conv.menu": "Conversation options",
  "conv.rename": "Rename",
  "conv.archive": "Archive",
  "conv.unarchive": "Unarchive",
  "conv.viewMessages": "Messages",
  "conv.viewTerminal": "Terminal",
  "msg.delivered": "Delivered",
  "msg.peerFrom": "from {name}",
  "msg.peerTo": "to {name}",
  "msg.peerQuestion": "question",
  "terminal.reconnecting": "Reconnecting…",

  "rename.title": "Rename conversation",
  "rename.desc": "Set a display name. Leave it empty to use the agent’s task.",
  "rename.placeholder": "Display name",
  "rename.save": "Save",
  "rename.cancel": "Cancel",

  "msg.empty.title": "No messages yet",
  "msg.empty.desc": "The agent will post its first update or question here.",

  "ask.resolved": "Resolved",
  "ask.needs": "Needs your decision",
  "ask.youAnswered": "You answered:",
  "ask.dismiss": "Dismiss question",

  "contactReq.tag": "Contact request",
  "contactReq.body": "{from} wants permission to message {to}.",
  "contactReq.reason": "Reason: {reason}",
  "contactReq.approve": "Allow",
  "contactReq.deny": "Deny",

  "admitReq.tag": "Admit agent?",
  "admitReq.body": "{agent} registered and is waiting to be admitted as a contact.",
  "spawnReq.tag": "Spawn agent?",
  "spawnReq.body": "{from} wants to launch a new agent in {path}.",

  "perm.globalHeading": "Permissions · global defaults",
  "perm.globalIntro": "What an agent may do when no per-agent override decides. 'Ask' routes to you for approval.",
  "perm.cap.contact_agent": "Contact agents",
  "perm.cap.contact_agent.desc": "Message another agent. In-scope targets (same work directory) follow this setting; out-of-scope ones need an explicit per-pair grant.",
  "perm.cap.register_agent": "Register (admission)",
  "perm.cap.register_agent.desc": "A new agent coming online as a contact. 'Ask' quarantines it until you admit it.",
  "perm.cap.spawn_agent": "Spawn agents",
  "perm.cap.spawn_agent.desc": "Launch a brand-new agent process. 'Ask' requires your approval before it runs.",
  "perm.effect.allow": "Allow",
  "perm.effect.ask": "Ask",
  "perm.effect.deny": "Deny",
  "perm.globalNote": "Most specific wins: per-pair grant > per-agent override (on each contact) > global default. Contact also has the master switch above.",
  "perm.override.default": "Default",
  "perm.override.note": "The chip shows the effect in force for this agent. Override pins one capability for this agent only; Default follows the global setting.",

  "composer.answer": "Type your answer — Enter to send",
  "composer.reply": "Reply to the agent — Enter to send",
  "composer.message": "Message the agent — Enter to send",
  "composer.toSend": "to send",
  "composer.newline": "for newline",
  "composer.send": "Send",
  "composer.answering": "Answering",
  "composer.attachImage": "Attach image",
  "composer.removeImage": "Remove image",
  "composer.uploading": "Uploading…",

  "status.registered": "Registered",
  "status.working": "Working",
  "status.waiting": "Waiting",
  "status.idle": "Idle",
  "status.done": "Done",
  "status.needsReply": "needs your reply",
  "status.online": "Online",
  "status.offline": "Offline",
  "presence.running": "running",
  "presence.notRunning": "not running",

  "offline.notRunning": "This agent isn’t running right now.",
  "offline.start": "Start it & handle this",
  "offline.queue": "Just queue",
  "offline.remember": "Always start it automatically",
  "offline.starting": "Starting the agent…",
  "offline.queued": "Queued — the agent will get it next time it runs.",

  "settings.title": "Settings",
  "settings.generalHeading": "Appearance & general",
  "settings.theme": "Theme",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.language": "Language",
  "settings.langZh": "中文",
  "settings.langEn": "English",
  "settings.notifications": "Desktop notifications",
  "settings.offlineHeading": "When I message an agent that isn’t running",
  "settings.auto": "Start it automatically",
  "settings.autoDesc": "Sending a message launches the agent so it can reply.",
  "settings.ask": "Ask me first",
  "settings.askDesc": "Show a one-click “start it?” button. (recommended)",
  "settings.off": "Just queue the message",
  "settings.offDesc": "Don’t start anything; it’s delivered when the agent next runs.",
  "settings.done": "Done",

  "settings.agentCommHeading": "Agent-to-agent messaging",
  "settings.agentCommOpen": "Allowed",
  "settings.agentCommOpenDesc": "Agents may message each other, subject to the permission settings.",
  "settings.agentCommOff": "Blocked",
  "settings.agentCommOffDesc": "Master switch off — no agent-to-agent messaging at all.",

  "nav.chats": "Chats",
  "nav.contacts": "Contacts",
  "nav.channels": "Channels",

  "channels.title": "Channels",
  "channels.new": "New channel",
  "channels.newAria": "Create a channel",
  "channels.empty.title": "No channels yet",
  "channels.empty.desc": "Create a channel to bring agents and yourself into one group conversation.",
  "channels.empty.action": "Create a channel",
  "channels.pick.title": "Pick a channel",
  "channels.pick.desc": "Select a channel on the left, or create one to start a group conversation.",
  "channels.memberCount": "{n} agents · you",
  "channels.members": "Members",
  "channels.you": "You (owner)",
  "channels.addMember": "Add agent",
  "channels.manageMembers": "Members — add or remove",
  "channels.removeMember": "Remove from channel",
  "channels.noMembers": "No agents yet — add some so they can see and post here.",
  "channels.thread.empty": "No messages yet. Say something to kick off the group.",
  "channels.composer.placeholder": "Message #{name} — Enter to send",
  "channels.composer.answerPlaceholder": "Type your answer — Enter to send",
  "channels.askBadge": "asks",
  "channels.answerBadge": "answered",
  "channels.answer": "Answer",
  "channels.askAnswered": "Answered",
  "channels.answeringAsk": "Answering the question",
  "channels.rename": "Rename channel",
  "channels.delete": "Delete channel",
  "channels.deleteConfirm": "Delete this channel and its messages?",
  "channels.deleteYes": "Delete",
  "channels.deleteCancel": "Cancel",
  "channels.fromYou": "You",
  "channels.unknownAgent": "agent",
  "channels.create.title": "New channel",
  "channels.create.nameLabel": "Channel name",
  "channels.create.namePlaceholder": "e.g. eng standup",
  "channels.create.membersLabel": "Add agents",
  "channels.create.membersHint": "You are always in the channel. Pick the agents to include.",
  "channels.create.noAgents": "No agents to add yet. Connect one first.",
  "channels.create.submit": "Create channel",
  "channels.create.nameRequired": "Enter a channel name first.",
  "channels.create.failed": "Could not create the channel. Try again.",
  "channels.create.cancel": "Cancel",
  "channels.create.close": "Close",

  "contactsView.search": "Search agents",
  "contactsView.add": "Add agent",
  "contactsView.select": "Select",
  "contactsView.selectAll": "Select all",
  "contactsView.selectNone": "Clear",
  "contactsView.selectDone": "Cancel",
  "contactsView.pickedN": "{n} selected",
  "contactsView.archiveN": "Archive ({n})",
  "contactsView.deleteN": "Delete ({n})",
  "contactsView.confirmDeleteN": "Delete {n} contact(s) permanently?",
  "contactsView.manage": "Manage directory",
  "addAgent.title": "Add an agent",
  "addAgent.subtitle": "Import an existing conversation in a folder, or start a new agent there.",
  "addAgent.close": "Close",
  "addAgent.folder": "Working folder",
  "addAgent.folderPlaceholder": "e.g. F:/Project/your-app",
  "addAgent.runtimeCustom": "Custom…",
  "addAgent.existing": "Existing conversations here",
  "addAgent.refresh": "Refresh",
  "addAgent.enterFolder": "Enter a folder above to discover its conversations.",
  "addAgent.scanning": "Scanning…",
  "addAgent.none": "No conversations found in this folder.",
  "addAgent.untitled": "(untitled conversation)",
  "addAgent.import": "Import",
  "addAgent.importing": "Importing…",
  "addAgent.imported": "Imported",
  "addAgent.createNew": "Create a new agent",
  "addAgent.namePlaceholder": "Name (optional)",
  "addAgent.taskPlaceholder": "What should it work on? (optional)",
  "addAgent.launch": "Launch in this folder",
  "addAgent.launchHint": "Starts the runtime in the folder, wired to Beacon. It shows up as a contact you can message.",
  "contactsView.agents": "Agents · {n}",
  "contactsView.empty": "No agents yet.",
  "contactsView.showArchived": "Archived ({n})",
  "contactsView.hideArchived": "Hide archived",
  "contactsView.pickTitle": "Select a contact",
  "contactsView.pickDesc": "Pick an agent on the left to see its profile, permissions, and who it may message.",

  "profile.about": "About",
  "profile.aboutPlaceholder": "No introduction yet. Click to add who this agent is and what it does.",
  "profile.editAbout": "Edit introduction",
  "profile.namePlaceholder": "Agent name",
  "profile.editName": "Edit name",
  "profile.agentId": "Agent ID",
  "profile.copy": "Copy",
  "profile.copied": "Copied",
  "profile.sessionIdMissing": "None (no runtime session yet)",
  "profile.workdir": "Workdir",
  "profile.pathNotSet": "— not set",
  "profile.origin": "Origin",
  "profile.originHuman": "Created by a human",
  "profile.originAgent": "Self-registered agent",
  "profile.sessionId": "Session ID",
  "profile.permissions": "Permissions",
  "profile.contacts": "Its contacts",
  "profile.noContacts": "No agents in scope yet.",
  "profile.contactsHint": "Agents in its working directory, plus any wired by a rule.",
  "profile.channels": "Channels",
  "profile.noChannels": "Not in any group channel yet.",
  "profile.openChannel": "Open",
  "profile.peerAllow": "Can message",
  "profile.peerDeny": "Blocked",
  "profile.peerPending": "Awaiting you",
  "profile.peerOpen": "Can request",
  "profile.message": "Message",
  "profile.manage": "Manage",
  "profile.archive": "Archive",
  "profile.unarchive": "Unarchive",
  "profile.delete": "Delete contact",
  "profile.deleteConfirm": "Delete permanently?",
  "profile.deleteYes": "Delete",
  "profile.deleteCancel": "Cancel",
  "profile.deleteHint": "Archive hides it from the active list (reversible). Delete removes the contact and its history for good.",

  "dir.title": "Directory",
  "dir.close": "Close",
  "dir.done": "Done",
  "dir.loading": "Loading agents…",
  "dir.empty": "No agents yet. Connect one to get started.",
  "dir.roster": "All agents",
  "dir.showArchived": "Show archived ({n})",
  "dir.hideArchived": "Hide archived",
  "dir.authHeading": "Agent-to-agent authorization",
  "dir.authDesc":
    "Add a per-pair rule to explicitly allow or block one agent messaging another. This is the most specific level, overriding the contact's permission and the global default.",
  "dir.fromAgent": "Choose agent…",
  "dir.toAgent": "Choose agent…",
  "dir.allow": "Allow",
  "dir.deny": "Block",
  "dir.removeGrant": "Remove rule",
  "dir.footer": "Single-user: every contact here is one agent.",
  "dir.openAria": "Open the directory",

  "info.openSession": "Open in terminal",
  "info.openSessionDesc": "Resume this agent's conversation:",
  "info.openSessionCopied": "Copied — paste in your terminal",
  "info.openDir": "Open work folder",

  "info.status": "Status",
  "info.runtime": "Runtime",
  "info.sessionId": "Session ID",
  "info.workdir": "Working directory",
  "info.timeline": "Timeline",
  "info.started": "Started",
  "info.updated": "Updated",
  "info.capabilities": "Capabilities",
  "info.pathNotSet": "— path not set",
  "info.copyWorkPath": "Copy work path",
  "info.footer": "This agent talks to you through Beacon.",

  "app.pick.title": "Pick a conversation",
  "app.pick.desc": "Select an agent on the left to read or reply.",
  "app.resizeList": "Drag to resize the contact list",
  "app.resizeInfo": "Drag to resize the info panel",
  "app.showList": "Show contact list",
  "app.notifPrompt":
    "Enable notifications so you don’t miss when an agent needs you",
  "app.enable": "Enable",
  "app.dismiss": "Dismiss",
  "app.live": "Live",
  "app.connecting": "Connecting",
  "app.offline": "Offline",

  "connect.title": "Connect an Agent",
  "connect.subtitle":
    "Add the hosted MCP endpoint, or drop in the zero-config skill — any runtime, no code changes.",
  "connect.close": "Close",
  "connect.loading": "Loading connect info...",
  "connect.newAgent": "New agent connected:",
  "connect.capabilities": "Capabilities:",
  "connect.mcp.recommended": "Recommended · one global command",
  "connect.mcp.httpHint":
    "Run it once. -s user makes it global across every project, and the command never changes when Beacon updates — the URL is the contract. Restart Claude Code and beacon shows up in /mcp.",
  "connect.mcp.localTitle": "Local (advanced) — run the MCP server yourself",
  "connect.mcp.jsonTitle": "Or drop this into a project’s .mcp.json",
  "connect.mcp.tools": "Available tools:",
  "connect.skill.installTitle": "Install (one time)",
  "connect.skill.windows": "On Windows:",
  "connect.skill.useTitle": "Use it in any Claude Code session",
  "connect.codex.httpTitle": "Hosted endpoint (recommended)",
  "connect.codex.localTitle": "Or run the server locally",
  "connect.codex.warn":
    "Heads-up: codex + MiniMax-M3 does not currently route MCP tool calls — this is a codex-side limitation. Claude Code is verified working.",
  "connect.http.desc":
    "For runtimes that don’t support MCP, hit the REST API directly.",
  "connect.http.contract": "Full contract:",
  "connect.error": "Failed to load connect info",

  "rel.now": "now",
};

const zh: Dict = {
  "brand.agents": "智能体",

  "rail.notifOn": "通知已开启",
  "rail.notifEnable": "开启桌面通知",
  "rail.notifBlocked": "通知被浏览器拦截",
  "rail.themeToLight": "切换到浅色主题",
  "rail.themeToDark": "切换到深色主题",
  "rail.langToZh": "切换到中文",
  "rail.langToEn": "Switch to English",
  "rail.langBadge": "中",

  "contacts.group.pending": "待准入",
  "contacts.group.waiting": "等待中",
  "contacts.group.active": "活跃",
  "contacts.group.done": "已完成",
  "contacts.group.archived": "已归档",
  "contacts.waitingBadge": "{n} 个等待",
  "contacts.pendingBadge": "{n} 个待准入",
  "contacts.connect": "接入",
  "contacts.collapse": "收起列表",
  "contacts.connectAria": "接入一个 Agent",
  "contacts.empty.title": "还没有接入 Agent",
  "contacts.empty.desc": "接入一个 Agent，它就会出现在这里。",
  "contacts.empty.action": "接入一个 Agent",
  "contacts.taskFallback": "在 {name} 中工作",
  "contacts.unread": "{n} 条未读",
  "contacts.unreadNeedsYou": "{n} 条未读，需要你",

  "conv.empty.title": "开始对话",
  "conv.empty.desc": "该 Agent 还没有发送任何消息。先发一条消息开启对话吧。",
  "conv.titleFallback": "{name} 中的 Agent",
  "conv.copyPath": "复制路径",
  "conv.copied": "已复制",
  "conv.pathPlaceholder": "— 未设置",
  "conv.back": "返回列表",
  "conv.showInfo": "显示会话信息",
  "conv.hideInfo": "隐藏会话信息",
  "conv.showList": "显示联系人列",
  "conv.hideList": "隐藏联系人列",
  "conv.viewMessages": "消息",
  "conv.viewTerminal": "终端",
  "msg.delivered": "已送达",
  "msg.peerFrom": "来自 {name}",
  "msg.peerTo": "发往 {name}",
  "msg.peerQuestion": "提问",
  "terminal.reconnecting": "重连中…",
  "conv.menu": "会话操作",
  "conv.rename": "重命名",
  "conv.archive": "归档",
  "conv.unarchive": "取消归档",

  "rename.title": "重命名会话",
  "rename.desc": "设置一个显示名称。留空则使用 Agent 的任务描述。",
  "rename.placeholder": "显示名称",
  "rename.save": "保存",
  "rename.cancel": "取消",

  "msg.empty.title": "还没有消息",
  "msg.empty.desc": "Agent 的第一条更新或提问会显示在这里。",

  "ask.resolved": "已解决",
  "ask.needs": "需要你决策",
  "ask.youAnswered": "你的回答：",
  "ask.dismiss": "忽略该问题",

  "contactReq.tag": "联系申请",
  "contactReq.body": "「{from}」申请联系「{to}」。",
  "contactReq.reason": "理由：{reason}",
  "contactReq.approve": "允许",
  "contactReq.deny": "拒绝",

  "admitReq.tag": "准入智能体？",
  "admitReq.body": "「{agent}」已注册，正在等待被准入为联系人。",
  "spawnReq.tag": "拉起智能体？",
  "spawnReq.body": "「{from}」想在 {path} 拉起一个新智能体。",

  "perm.globalHeading": "权限 · 全局默认",
  "perm.globalIntro": "当没有单独覆盖时，智能体能做什么。「询问」会转给你审批。",
  "perm.cap.contact_agent": "联系智能体",
  "perm.cap.contact_agent.desc": "给别的智能体发消息。同工作域内(同一目录)按本设置，域外需要按对显式授权。",
  "perm.cap.register_agent": "注册（准入）",
  "perm.cap.register_agent.desc": "新智能体上线成为联系人。「询问」会先隔离，等你准入。",
  "perm.cap.spawn_agent": "拉起智能体",
  "perm.cap.spawn_agent.desc": "启动一个全新的智能体进程。「询问」需要你批准后才会运行。",
  "perm.effect.allow": "允许",
  "perm.effect.ask": "询问",
  "perm.effect.deny": "拒绝",
  "perm.globalNote": "越具体越优先：按对授权 > 单智能体覆盖（在每个联系人里设）> 全局默认。联系还有上方的总开关。",
  "perm.override.default": "默认",
  "perm.override.note": "标签是这个智能体当前生效的结果。覆盖只针对这一个智能体把某项能力钉死；选「默认」则跟随全局默认。",

  "composer.answer": "输入你的回答 —— 回车发送",
  "composer.reply": "回复 Agent —— 回车发送",
  "composer.message": "给 Agent 发消息 —— 回车发送",
  "composer.toSend": "发送",
  "composer.newline": "换行",
  "composer.send": "发送",
  "composer.answering": "回答中",
  "composer.attachImage": "添加图片",
  "composer.removeImage": "移除图片",
  "composer.uploading": "上传中…",

  "status.registered": "已注册",
  "status.working": "工作中",
  "status.waiting": "等待中",
  "status.idle": "空闲",
  "status.done": "已完成",
  "status.needsReply": "等待你的回复",
  "status.online": "在线",
  "status.offline": "离线",
  "presence.running": "运行中",
  "presence.notRunning": "未运行",

  "offline.notRunning": "这个智能体当前没有在运行。",
  "offline.start": "启动并处理",
  "offline.queue": "仅排队",
  "offline.remember": "以后自动启动",
  "offline.starting": "正在启动智能体…",
  "offline.queued": "已排队 —— 智能体下次运行时会收到。",

  "settings.title": "设置",
  "settings.generalHeading": "外观与通用",
  "settings.theme": "主题",
  "settings.themeLight": "浅色",
  "settings.themeDark": "深色",
  "settings.language": "语言",
  "settings.langZh": "中文",
  "settings.langEn": "English",
  "settings.notifications": "桌面通知",
  "settings.offlineHeading": "当我给一个没在运行的智能体发消息时",
  "settings.auto": "自动启动它",
  "settings.autoDesc": "发消息时直接启动智能体,让它来回复。",
  "settings.ask": "先问我",
  "settings.askDesc": "显示一个一键「启动」按钮。(推荐)",
  "settings.off": "只把消息排队",
  "settings.offDesc": "不启动任何东西;等智能体下次运行时送达。",
  "settings.done": "完成",

  "settings.agentCommHeading": "智能体之间的通信",
  "settings.agentCommOpen": "允许",
  "settings.agentCommOpenDesc": "智能体之间可互发消息,受权限设置约束。",
  "settings.agentCommOff": "全部禁止",
  "settings.agentCommOffDesc": "总开关关闭 —— 完全禁止智能体间通信。",

  "nav.chats": "消息",
  "nav.contacts": "通讯录",
  "nav.channels": "频道",

  "channels.title": "频道",
  "channels.new": "新建频道",
  "channels.newAria": "创建一个频道",
  "channels.empty.title": "还没有频道",
  "channels.empty.desc": "建一个频道，把若干智能体和你自己拉进同一个群对话。",
  "channels.empty.action": "创建频道",
  "channels.pick.title": "选择一个频道",
  "channels.pick.desc": "在左侧选一个频道，或新建一个开始群对话。",
  "channels.memberCount": "{n} 个智能体 · 你",
  "channels.members": "成员",
  "channels.you": "你（群主）",
  "channels.addMember": "添加智能体",
  "channels.manageMembers": "成员 —— 添加或移出",
  "channels.removeMember": "移出频道",
  "channels.noMembers": "还没有智能体 —— 加一些进来，它们才能在这里收发。",
  "channels.thread.empty": "还没有消息。发一句话，开启这个群。",
  "channels.composer.placeholder": "在 #{name} 发言 —— 回车发送",
  "channels.composer.answerPlaceholder": "输入你的回答 —— 回车发送",
  "channels.askBadge": "提问",
  "channels.answerBadge": "已回答",
  "channels.answer": "回答",
  "channels.askAnswered": "已回答",
  "channels.answeringAsk": "正在回答提问",
  "channels.rename": "重命名频道",
  "channels.delete": "删除频道",
  "channels.deleteConfirm": "删除这个频道及其消息？",
  "channels.deleteYes": "删除",
  "channels.deleteCancel": "取消",
  "channels.fromYou": "你",
  "channels.unknownAgent": "智能体",
  "channels.create.title": "新建频道",
  "channels.create.nameLabel": "频道名称",
  "channels.create.namePlaceholder": "例如 eng standup",
  "channels.create.membersLabel": "添加智能体",
  "channels.create.membersHint": "你始终在频道里。挑选要拉进来的智能体。",
  "channels.create.noAgents": "还没有可添加的智能体。先接入一个。",
  "channels.create.submit": "创建频道",
  "channels.create.nameRequired": "请先填写频道名称。",
  "channels.create.failed": "创建频道失败,请重试。",
  "channels.create.cancel": "取消",
  "channels.create.close": "关闭",

  "contactsView.search": "搜索智能体",
  "contactsView.add": "添加智能体",
  "contactsView.select": "批量选择",
  "contactsView.selectAll": "全选",
  "contactsView.selectNone": "取消全选",
  "contactsView.selectDone": "取消",
  "contactsView.pickedN": "已选 {n}",
  "contactsView.archiveN": "归档（{n}）",
  "contactsView.deleteN": "删除（{n}）",
  "contactsView.confirmDeleteN": "永久删除 {n} 个联系人?",
  "contactsView.manage": "通讯录管理",
  "addAgent.title": "添加智能体",
  "addAgent.subtitle": "导入某目录下已有的对话,或在该目录新建一个智能体。",
  "addAgent.close": "关闭",
  "addAgent.folder": "工作目录",
  "addAgent.folderPlaceholder": "例如 F:/Project/your-app",
  "addAgent.runtimeCustom": "自定义…",
  "addAgent.existing": "该目录下已有的对话",
  "addAgent.refresh": "刷新",
  "addAgent.enterFolder": "在上方填一个目录,自动发现它下面的对话。",
  "addAgent.scanning": "扫描中…",
  "addAgent.none": "这个目录下没有发现对话。",
  "addAgent.untitled": "(无标题对话)",
  "addAgent.import": "导入",
  "addAgent.importing": "导入中…",
  "addAgent.imported": "已导入",
  "addAgent.createNew": "新建一个智能体",
  "addAgent.namePlaceholder": "名称(可选)",
  "addAgent.taskPlaceholder": "让它做什么?(可选)",
  "addAgent.launch": "在此目录拉起",
  "addAgent.launchHint": "在该目录启动运行时并接好 Beacon,随后作为联系人出现、可直接对话。",
  "contactsView.agents": "智能体 · {n}",
  "contactsView.empty": "还没有智能体。",
  "contactsView.showArchived": "已归档（{n}）",
  "contactsView.hideArchived": "隐藏已归档",
  "contactsView.pickTitle": "选择一个联系人",
  "contactsView.pickDesc": "在左侧选一个智能体，查看它的资料、权限，以及它能联系谁。",

  "profile.about": "介绍",
  "profile.aboutPlaceholder": "还没有介绍。点击填写这个智能体是谁、能做什么。",
  "profile.editAbout": "编辑介绍",
  "profile.namePlaceholder": "智能体名称",
  "profile.editName": "编辑名称",
  "profile.agentId": "智能体 ID",
  "profile.copy": "复制",
  "profile.copied": "已复制",
  "profile.sessionIdMissing": "无(尚无运行时会话)",
  "profile.workdir": "工作路径",
  "profile.pathNotSet": "— 未设置",
  "profile.origin": "来源",
  "profile.originHuman": "由人创建",
  "profile.originAgent": "自行注册的智能体",
  "profile.sessionId": "会话 ID",
  "profile.permissions": "权限",
  "profile.contacts": "它的联系人",
  "profile.noContacts": "可见范围内暂无智能体。",
  "profile.contactsHint": "同工作目录下的智能体，加上被规则打通的。",
  "profile.channels": "所属群聊",
  "profile.noChannels": "还没有加入任何群聊。",
  "profile.openChannel": "进入",
  "profile.peerAllow": "可通信",
  "profile.peerDeny": "已拒绝",
  "profile.peerPending": "待你审批",
  "profile.peerOpen": "可申请",
  "profile.message": "发消息",
  "profile.manage": "管理",
  "profile.archive": "归档",
  "profile.unarchive": "取消归档",
  "profile.delete": "删除联系人",
  "profile.deleteConfirm": "确认永久删除?",
  "profile.deleteYes": "删除",
  "profile.deleteCancel": "取消",
  "profile.deleteHint": "归档只是从活跃列表隐藏(可恢复);删除会永久移除该联系人及其历史。",

  "dir.title": "通讯录",
  "dir.close": "关闭",
  "dir.done": "完成",
  "dir.loading": "正在加载智能体…",
  "dir.empty": "还没有智能体。先接入一个开始吧。",
  "dir.roster": "全部智能体",
  "dir.showArchived": "显示已归档（{n}）",
  "dir.hideArchived": "隐藏已归档",
  "dir.authHeading": "智能体互通授权",
  "dir.authDesc":
    "为某一对智能体单独添加「允许 / 禁止」规则。这是最具体的一层，覆盖该联系人的权限与全局默认。",
  "dir.fromAgent": "选择智能体…",
  "dir.toAgent": "选择智能体…",
  "dir.allow": "允许",
  "dir.deny": "禁止",
  "dir.removeGrant": "删除规则",
  "dir.footer": "单用户：这里每个联系人就是一个智能体。",
  "dir.openAria": "打开通讯录",

  "info.openSession": "在终端中打开",
  "info.openSessionDesc": "在对应目录恢复这个智能体的对话：",
  "info.openSessionCopied": "已复制 — 粘贴到终端执行",
  "info.openDir": "打开工作目录",

  "info.status": "状态",
  "info.runtime": "运行时",
  "info.sessionId": "会话 ID",
  "info.workdir": "工作路径",
  "info.timeline": "时间线",
  "info.started": "开始",
  "info.updated": "更新",
  "info.capabilities": "能力",
  "info.pathNotSet": "— 未设置路径",
  "info.copyWorkPath": "复制工作路径",
  "info.footer": "该 Agent 通过 Beacon 与你通信。",

  "app.pick.title": "选择一个会话",
  "app.pick.desc": "在左侧选择一个 Agent 查看或回复。",
  "app.resizeList": "拖动调整联系人列宽",
  "app.resizeInfo": "拖动调整信息栏宽度",
  "app.showList": "显示联系人列",
  "app.notifPrompt": "开启通知，别错过 Agent 需要你的时刻",
  "app.enable": "开启",
  "app.dismiss": "忽略",
  "app.live": "实时",
  "app.connecting": "连接中",
  "app.offline": "离线",

  "connect.title": "接入 Agent",
  "connect.subtitle":
    "添加托管 MCP 端点，或放入零配置 skill —— 任意运行时，无需改动代码。",
  "connect.close": "关闭",
  "connect.loading": "正在加载接入信息…",
  "connect.newAgent": "新 Agent 已接入：",
  "connect.capabilities": "能力：",
  "connect.mcp.recommended": "推荐 · 一行全局命令",
  "connect.mcp.httpHint":
    "运行一次即可。-s user 让它对所有项目全局生效；Beacon 升级时命令也不会变 —— URL 就是契约。重启 Claude Code，beacon 就会出现在 /mcp 列表里。",
  "connect.mcp.localTitle": "本地方式（进阶）—— 自己运行 MCP server",
  "connect.mcp.jsonTitle": "或放进项目的 .mcp.json",
  "connect.mcp.tools": "可用工具：",
  "connect.skill.installTitle": "安装（一次性）",
  "connect.skill.windows": "Windows 下：",
  "connect.skill.useTitle": "在任意 Claude Code 会话中使用",
  "connect.codex.httpTitle": "托管端点（推荐）",
  "connect.codex.localTitle": "或在本地运行 server",
  "connect.codex.warn":
    "提示：codex + MiniMax-M3 目前无法转发 MCP 工具调用 —— 这是 codex 侧的限制。Claude Code 已验证可用。",
  "connect.http.desc": "对于不支持 MCP 的运行时，可直接调用 REST API。",
  "connect.http.contract": "完整契约：",
  "connect.error": "加载接入信息失败",

  "rel.now": "现在",
};

const DICTS: Record<Lang, Dict> = { zh, en };

function detectLang(): Lang {
  if (typeof window === "undefined") return "zh";
  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // ignore
  }
  const nav = navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("zh") ? "zh" : "en";
}

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Locale-aware compact relative time, e.g. "5m" / "5分钟前"-ish short form. */
  rel: (ts: number, now: number) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : `{${k}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggleLang = useCallback(
    () => setLangState((p) => (p === "zh" ? "en" : "zh")),
    [],
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = DICTS[lang];
      const raw = dict[key] ?? DICTS.en[key] ?? key;
      return interpolate(raw, params);
    },
    [lang],
  );

  const rel = useCallback(
    (ts: number, now: number) => relativeTime(ts, now, lang),
    [lang],
  );

  const value = useMemo<I18nState>(
    () => ({ lang, setLang, toggleLang, t, rel }),
    [lang, setLang, toggleLang, t, rel],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}

// Compact relative time with locale-aware unit suffixes.
function relativeTime(ts: number, now: number, lang: Lang): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  const zh = lang === "zh";
  if (sec < 5) return zh ? "刚刚" : "now";
  if (sec < 60) return zh ? `${sec} 秒前` : `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return zh ? `${min} 分钟前` : `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return zh ? `${hr} 小时前` : `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return zh ? `${day} 天前` : `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return zh ? `${wk} 周前` : `${wk}w`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return zh ? `${mo} 个月前` : `${mo}mo`;
  const yr = Math.floor(day / 365);
  return zh ? `${yr} 年前` : `${yr}y`;
}
