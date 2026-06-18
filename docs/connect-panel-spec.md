# 接入面板规范(Connect an agent)

产品内的自助接入引导:用户在界面点一下,就能拿到把任意 agent 接进 Beacon 所需的命令与配置
(路径已由后端填好),一键复制。两种方式都呈现:① skill(零配置,推荐)② MCP / HTTP。

## 数据源:`GET /api/connect-info`

后端解析好绝对路径后返回(节选):

```json
{
  "platformUrl": "http://127.0.0.1:4319",
  "requiresToken": false,
  "tools": ["register_session","notify_human","ask_human","update_status","check_inbox"],
  "skill": {
    "install": "cp -r .../skill/beacon ~/.claude/skills/beacon",
    "installWindows": "xcopy /E /I \"...\\skill\\beacon\" \"%USERPROFILE%\\.claude\\skills\\beacon\"",
    "usage": ["node .../beacon.mjs register \"...\"", "node .../beacon.mjs notify \"...\"", "..."]
  },
  "claudeMcpAdd": "claude mcp add beacon -e PLATFORM_URL=... -- node \"...\" \"...\"",
  "mcpJson": { "mcpServers": { "beacon": { "command":"node", "args":["...","..."], "env":{...} } } },
  "codexMcpAdd": "codex mcp add beacon --env ... -- node \"...\" \"...\"",
  "httpExample": "curl -X POST .../api/sessions/register -H ... -d '{...}'"
}
```

前端打开面板时 `fetch('/api/connect-info')`,直接渲染其中字符串/JSON,不在前端拼路径。

## 入口

- 联系人列头部一个「+ 接入 Agent」按钮。
- 空状态(`EmptyState`)一个主按钮「接入一个 Agent」,打开同一面板。

## 面板(模态框)

居中模态,遮罩,ESC/点遮罩关闭,沿用现有圆角/阴影/配色 token。三个 Tab:

### Tab ①:Claude Code · skill(默认,推荐)
- 一句话:"零配置:无需 MCP、无需 `claude mcp add`、无需重启。"
- "① 安装(一次性)":代码块显示 `skill.install`,带「复制」;下面一行小字给出 Windows 版 `installWindows`。
- "② 在任意 Claude Code 会话里用":代码块显示 `skill.usage` 各行,带「复制」。
- 末尾灰字列出能力:`register · notify · ask · status · inbox`。

### Tab ②:MCP
- "① 一次性注册":代码块 `claudeMcpAdd` + 「复制」;一行说明"运行一次并重启 Claude Code,`beacon` 会
  出现在 `/mcp` 列表里"。
- "② 或放进项目 .mcp.json":代码块 `JSON.stringify(mcpJson, null, 2)` + 「复制」。
- Codex:代码块 `codexMcpAdd` + 「复制」,并附琥珀色提示"codex + MiniMax-M3 暂不路由 MCP 工具调用"。

### Tab ③:HTTP
- 一句话"不支持 MCP 的运行时可直接调 REST API。"
- 代码块 `httpExample` + 「复制」;一行"完整契约见 docs/connect-agent.md"。

### 若 `requiresToken` 为 true
面板顶部提示:平台启用了 `PLATFORM_TOKEN`,skill/MCP 都需在 env 带上同样的 token。

## 复制按钮

统一小组件:`navigator.clipboard.writeText(...)`,点击后文案短暂变「已复制 ✓」再恢复。代码块等宽字体、
可横向滚动。

## 实时收尾(加分项)

面板底部"正在等待第一个 agent 接入…";收到任意新 `session`(WS)时变绿"✓ 已检测到 «task»"。复用 store
现有 sessions/WS,不新建连接。

## 验收

- `web/` 里 `npm run build` 通过。
- 头部与空状态都能打开面板;三个 Tab 内容来自 `/api/connect-info`;复制可用且有反馈;深浅主题一致。
- 不破坏现有流程与视觉。
