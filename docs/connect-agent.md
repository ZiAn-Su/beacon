# 接入一个 Agent

Beacon 提供两种接入方式,底层是同一组 HTTP API。先启动平台:

```bash
npm run platform   # http://127.0.0.1:4319
```

## 方式一:`/beacon` skill(零配置,推荐给 Claude Code)

不需要 MCP、不需要 `claude mcp add`、不需要绝对路径、不需要重启。把技能装到用户级一次:

```bash
cp -r skill/beacon ~/.claude/skills/beacon
# Windows:  xcopy /E /I skill\beacon %USERPROFILE%\.claude\skills\beacon
```

之后在任何 Claude Code 会话里,agent 用自带 CLI 跟人对话(`<skill>` 即该技能目录):

```bash
node <skill>/beacon.mjs register "我在做的任务"
node <skill>/beacon.mjs notify   "进度更新…"
node <skill>/beacon.mjs ask       "要不要这么干?" "Approve" "Hold"   # 阻塞,直接返回人的答复
node <skill>/beacon.mjs status    done
node <skill>/beacon.mjs inbox                                       # 读人发来的消息
```

会话按工作目录自动缓存,所以 `register` 之后的命令都落在同一对话。

## 方式二:MCP server(给任意 MCP 运行时)

适合非 Claude 的 agent,或想要结构化工具调用的场景。

### Claude Code

一次性注册(之后出现在 `/mcp` 列表里):

```bash
claude mcp add beacon -e PLATFORM_URL=http://127.0.0.1:4319 -e AGENT_RUNTIME=claude-code \
  -- node F:/Project/InteractPlatform/node_modules/tsx/dist/cli.mjs F:/Project/InteractPlatform/src/mcp/server.ts
```

或放进项目的 `.mcp.json`:

```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": [
        "F:/Project/InteractPlatform/node_modules/tsx/dist/cli.mjs",
        "F:/Project/InteractPlatform/src/mcp/server.ts"
      ],
      "env": {
        "PLATFORM_URL": "http://127.0.0.1:4319",
        "AGENT_RUNTIME": "claude-code",
        "AGENT_WORK_PATH": "F:/Project/your-project",
        "AGENT_TASK": "在做的任务"
      }
    }
  }
}
```

> 界面里的「接入 Agent」面板会自动生成填好绝对路径的上述命令与配置,一键复制。

### Codex

```bash
codex mcp add beacon --env PLATFORM_URL=http://127.0.0.1:4319 --env AGENT_RUNTIME=codex \
  -- node F:/Project/InteractPlatform/node_modules/tsx/dist/cli.mjs F:/Project/InteractPlatform/src/mcp/server.ts
```

> 注意:codex + MiniMax-M3 目前不路由 MCP 工具调用(返回 `unsupported call`),属 codex/minimax 侧限制,
> 非本平台问题。Claude Code 经 MCP 已验证可用。

## 环境变量

| 变量              | 默认                        | 含义                                       |
| ----------------- | --------------------------- | ------------------------------------------ |
| `PLATFORM_URL`    | `http://127.0.0.1:4319`     | 平台网关监听地址                           |
| `AGENT_RUNTIME`   | `claude-code`               | 作为联系人显示的运行时标识                 |
| `AGENT_WORK_PATH` | 进程 cwd                    | 工作目录;作为 session 身份的一部分         |
| `AGENT_TASK`      | `""`                        | 未先 register 时的默认任务名               |
| `PLATFORM_TOKEN`  | (空)                        | 若平台启用鉴权,agent 需带同样的 token      |

## 五个能力

| 能力               | 阻塞? | 用途                                                        |
| ------------------ | ----- | ----------------------------------------------------------- |
| `register_session` | 否    | 注册为一个独立联系人(一个任务 = 一个 session)              |
| `notify_human`     | 否    | 发"仅供参考"/进度,然后继续工作                              |
| `ask_human`        | **是**| 提问并等待答案(返回人的回复)                                |
| `update_status`    | 否    | 设置 `working` / `waiting` / `idle` / `done`                |
| `check_inbox`      | 否    | 拉取人在你工作期间发来的消息(保持可被引导)                  |

> skill 方式对应的命令是 `register` / `notify` / `ask` / `status` / `inbox`。

## 放进 Agent 系统提示的指导语

> 你可以通过 Beacon 与人交流。**不要**事无巨细复述。用 `notify` 报告有意义的进展;仅当真正需要决策
> 才能继续(不可逆操作、需求有歧义、缺关键选项)时用 `ask`——它会阻塞直到对方回答。随工作阶段调
> `update_status`;在步骤之间 `check_inbox`,以便人随时把你引导到正确方向。
