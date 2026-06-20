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

  "contacts.group.waiting": "Waiting",
  "contacts.group.active": "Active",
  "contacts.group.done": "Done",
  "contacts.group.archived": "Archived",
  "contacts.waitingBadge": "{n} waiting",
  "contacts.connect": "Connect",
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

  "composer.answer": "Type your answer — Enter to send",
  "composer.reply": "Reply to the agent — Enter to send",
  "composer.message": "Message the agent — Enter to send",
  "composer.toSend": "to send",
  "composer.newline": "for newline",
  "composer.send": "Send",
  "composer.answering": "Answering",

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
  "settings.agentCommOpenDesc": "Agents may message each other, subject to each agent’s trust tier.",
  "settings.agentCommOff": "Blocked",
  "settings.agentCommOffDesc": "Master switch off — no agent-to-agent messaging at all.",

  "nav.chats": "Chats",
  "nav.contacts": "Contacts",

  "contactsView.search": "Search agents",
  "contactsView.manage": "Manage directory",
  "contactsView.agents": "Agents · {n}",
  "contactsView.empty": "No agents yet.",
  "contactsView.showArchived": "Archived ({n})",
  "contactsView.hideArchived": "Hide archived",
  "contactsView.pickTitle": "Select a contact",
  "contactsView.pickDesc": "Pick an agent on the left to see its profile, trust, and who it may message.",

  "profile.workdir": "Workdir",
  "profile.pathNotSet": "— not set",
  "profile.origin": "Origin",
  "profile.originHuman": "Created by a human",
  "profile.originAgent": "Self-registered agent",
  "profile.sessionId": "Session ID",
  "profile.trust": "Trust",
  "profile.trustHint": "Default rule for messaging other agents.",
  "profile.contacts": "Its contacts",
  "profile.noContacts": "No agents in scope yet.",
  "profile.contactsHint": "Agents in its working directory, plus any wired by a rule.",
  "profile.peerAllow": "Can message",
  "profile.peerDeny": "Blocked",
  "profile.peerPending": "Awaiting you",
  "profile.peerOpen": "Can request",
  "profile.message": "Message",

  "dir.title": "Directory",
  "dir.close": "Close",
  "dir.done": "Done",
  "dir.loading": "Loading agents…",
  "dir.empty": "No agents yet. Connect one to get started.",
  "dir.roster": "All agents",
  "dir.showArchived": "Show archived ({n})",
  "dir.hideArchived": "Hide archived",
  "dir.trustHint": "Trust tier — whether this agent may message other agents.",
  "dir.authHeading": "Agent-to-agent authorization",
  "dir.authDesc":
    "Trust tier is the default. Add a per-pair rule to explicitly allow or block one agent messaging another, overriding the tier.",
  "dir.fromAgent": "Choose agent…",
  "dir.toAgent": "Choose agent…",
  "dir.allow": "Allow",
  "dir.deny": "Block",
  "dir.removeGrant": "Remove rule",
  "dir.footer": "Single-user: every contact here is one agent.",
  "dir.openAria": "Open the directory",

  "info.trust": "Trust tier",
  "info.trustHint": "Whether this agent may message other agents.",
  "trust.restricted": "Restricted",
  "trust.restrictedDesc": "Cannot message other agents.",
  "trust.standard": "Standard",
  "trust.standardDesc": "May message other agents (default).",
  "trust.trusted": "Trusted",
  "trust.trustedDesc": "May message other agents.",
  "trust.autonomous": "Autonomous",
  "trust.autonomousDesc": "Full freedom to message other agents.",

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

  "contacts.group.waiting": "等待中",
  "contacts.group.active": "活跃",
  "contacts.group.done": "已完成",
  "contacts.group.archived": "已归档",
  "contacts.waitingBadge": "{n} 个等待",
  "contacts.connect": "接入",
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

  "composer.answer": "输入你的回答 —— 回车发送",
  "composer.reply": "回复 Agent —— 回车发送",
  "composer.message": "给 Agent 发消息 —— 回车发送",
  "composer.toSend": "发送",
  "composer.newline": "换行",
  "composer.send": "发送",
  "composer.answering": "回答中",

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
  "settings.agentCommOpenDesc": "智能体之间可互发消息,受每个智能体的信任档位约束。",
  "settings.agentCommOff": "全部禁止",
  "settings.agentCommOffDesc": "总开关关闭 —— 完全禁止智能体间通信。",

  "nav.chats": "消息",
  "nav.contacts": "通讯录",

  "contactsView.search": "搜索智能体",
  "contactsView.manage": "通讯录管理",
  "contactsView.agents": "智能体 · {n}",
  "contactsView.empty": "还没有智能体。",
  "contactsView.showArchived": "已归档（{n}）",
  "contactsView.hideArchived": "隐藏已归档",
  "contactsView.pickTitle": "选择一个联系人",
  "contactsView.pickDesc": "在左侧选一个智能体，查看它的资料、信任档位，以及它能联系谁。",

  "profile.workdir": "工作路径",
  "profile.pathNotSet": "— 未设置",
  "profile.origin": "来源",
  "profile.originHuman": "由人创建",
  "profile.originAgent": "自行注册的智能体",
  "profile.sessionId": "会话 ID",
  "profile.trust": "信任档位",
  "profile.trustHint": "给其他智能体发消息的默认规则。",
  "profile.contacts": "它的联系人",
  "profile.noContacts": "可见范围内暂无智能体。",
  "profile.contactsHint": "同工作目录下的智能体，加上被规则打通的。",
  "profile.peerAllow": "可通信",
  "profile.peerDeny": "已拒绝",
  "profile.peerPending": "待你审批",
  "profile.peerOpen": "可申请",
  "profile.message": "发消息",

  "dir.title": "通讯录",
  "dir.close": "关闭",
  "dir.done": "完成",
  "dir.loading": "正在加载智能体…",
  "dir.empty": "还没有智能体。先接入一个开始吧。",
  "dir.roster": "全部智能体",
  "dir.showArchived": "显示已归档（{n}）",
  "dir.hideArchived": "隐藏已归档",
  "dir.trustHint": "信任档位 —— 决定该智能体能否给其他智能体发消息。",
  "dir.authHeading": "智能体互通授权",
  "dir.authDesc":
    "信任档位是默认规则。为某一对智能体单独添加「允许 / 禁止」规则，可覆盖其档位。",
  "dir.fromAgent": "选择智能体…",
  "dir.toAgent": "选择智能体…",
  "dir.allow": "允许",
  "dir.deny": "禁止",
  "dir.removeGrant": "删除规则",
  "dir.footer": "单用户：这里每个联系人就是一个智能体。",
  "dir.openAria": "打开通讯录",

  "info.trust": "信任档位",
  "info.trustHint": "决定这个智能体能否给其他智能体发消息。",
  "trust.restricted": "受限",
  "trust.restrictedDesc": "不能给其他智能体发消息。",
  "trust.standard": "标准",
  "trust.standardDesc": "可以给其他智能体发消息(默认)。",
  "trust.trusted": "信任",
  "trust.trustedDesc": "可以给其他智能体发消息。",
  "trust.autonomous": "自治",
  "trust.autonomousDesc": "完全自由地给其他智能体发消息。",

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
