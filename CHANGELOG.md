# 更新日志

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。`MAJOR.MINOR.PATCH`：
向后兼容的新功能进 MINOR,修复进 PATCH,破坏「契约」(MCP/HTTP API、skill 命令、数据库结构)的改动才进 MAJOR。

## [0.6.12] - 2026-06-21

### 改进 —— 左列折叠不留空条；聊天信息栏与通讯录资料页合并为同一面板

继续按反馈打磨:

- **折叠左列不再留丑陋空白条**:折叠后联系人列**整列消失**,显示/隐藏开关挪到**对话头**左侧
  (与右侧信息栏开关对称);未选中会话时强制显示列,避免死角。
- **信息对称**:聊天右侧的「联系人信息」与通讯录里的资料页此前字段不一致,现**合并为同一个组件**
  (`ContactProfile` 两处共用)。把原 `SessionInfo` 独有的**时间线 / 能力 / 在终端中打开**并入资料页,
  删除 `SessionInfo.tsx`。两处展示完全一致(聊天面板里不重复「发消息」按钮——你已经在对话里)。
- 实测(浏览器):折叠后无残留空条、可从对话头还原;聊天信息栏含介绍/Agent ID/会话 ID/工作路径/来源/
  信任档位/它的联系人/时间线/能力/终端恢复/管理,与资料页一致。typecheck + encoding + web build 全过。

## [0.6.11] - 2026-06-21

### 改进 —— 聊天界面布局整理(可拖动列宽 / 折叠左列 / 信息栏默认关 / 收纳设置)

按反馈整理聊天视图:

- **右侧信息栏默认关闭**(此前默认打开占地方),需要时点对话头的面板按钮展开。
- **列宽可拖动**:联系人列与信息栏之间各有一根拖拽分隔条,宽度记忆(双击复位);**左列可折叠**为细条、
  一键展开。
- **精简图标**:删掉左上角没用的「活跃数」计数徽章和多余的「智能体」标签;左侧竖排 Rail 只留导航 + 设置。
- **零散功能收进设置**:主题(浅/深)、语言(中/英)、桌面通知从 Rail 移入「设置 → 外观与通用」。
- 实测(浏览器):信息栏默认不显示、分隔条存在、折叠/展开可用、设置内含外观/语言/通知;typecheck +
  encoding + web build 全过。

## [0.6.10] - 2026-06-21

### 新增 —— 批量管理联系人(批量归档 / 删除,删除二次确认)

- 通讯录页新增「批量选择」模式:勾选多个联系人,底部动作条一次**归档**或**删除**;支持全选/取消全选,
  顶部实时显示已选数。删除走二次确认条(「永久删除 N 个联系人?」→ 删除 / 取消)。
- 后端 `POST /api/sessions/batch` body `{ ids, action: archive|unarchive|delete }`,复用既有的级联删除
  与归档,返回 affected 数。
- 顺带在产品里讲清**归档语义**:归档 = 从活跃列表隐藏、且不进智能体发现范围,**可逆、不自动删除、数据保留**;
  删除才是永久级联清除。资料页删除提示也已说明这点。
- 实测:批量归档/取消归档/删除计数正确、级联生效、其它联系人不受影响;非法 action 与空 ids 均 400。

## [0.6.9] - 2026-06-21

### 新增 —— 删除联系人(归档之外的永久删除)

之前只能"归档"(隐藏),没有真正的删除,通讯录管理也只能配授权规则。补上:

- 后端 `DELETE /api/sessions/:id` + `store.deleteSession`:事务级联删除该联系人的消息(含它发出的 peer
  消息)、asks、双向授权 grant、联系申请;先杀掉它的活动终端(`killPty`),并清掉待认领的 launch 槽。
  新增 `sessionRemoved` 总线事件 → WS `session-removed`,各端实时把它从列表/选中态里摘掉。
- 前端:资料页新增「管理」分区 —— 归档/取消归档(可逆)与删除联系人(危险色,二次确认)。
  「通讯录管理」弹窗每行也加了删除(行内确认)。
- 实测:删除会级联清掉消息与 grant、返回 404,其它联系人不受影响,删除不存在的返回 404。

## [0.6.8] - 2026-06-21

### 修复 —— 拉起/导入的智能体可靠附到联系人,不再开重复(全传输)

补上 0.6.7 标注的缺口:之前只有 skill / stdio MCP(读注入的 `BEACON_SESSION_ID`)能附到预建卡,
托管 HTTP MCP 的 agent 会另开一个重复联系人。把"认领"逻辑统一收口到 `registerOrClaim`,两条 register
路径(REST 与托管 MCP)都走它,按序认领:

1. **bindKey** 续接(原有);
2. **原生会话 id** 命中:同一段运行时对话已是联系人(如导入后被 resume)→ 附到它;
3. **待认领的拉起会话**:`launch` 时 `markPendingLaunch(workPath)`,该目录下第一个 register 附上去
   (TTL 10 分钟);
4. 都不命中才新建。

外加:stdio MCP 的 `register_session` 在平台注入了 `BEACON_SESSION_ID` 时直接附到该会话(顺带修了 wake
场景下显式 register 会重复建卡的潜伏 bug)。实测:launch 后同目录 register 附到同一 id;导入 nat-1 后
上报 nat-1 的 register 附到导入卡;无命中则新建;bindKey 续接不受影响;全程不产生重复联系人。

## [0.6.7] - 2026-06-21

### 新增 —— 在 UI 里添加智能体(发现已有 / 新建拉起)

不必再去终端敲连接命令。通讯录页新增「添加智能体」入口,一个弹窗两条路:

- **发现已有**:填(或自动带入选中联系人的)工作目录,平台扫该目录下运行时的磁盘会话
  (`GET /api/discover`,复用 `agent-sessions.ts`),实时列出每段对话(标题取首条人类提问、原生 id、
  时间),一键**导入**为联系人(`POST /api/sessions/import`,按原生 id 幂等;导入后能 `claude --resume`
  精确续接)。列表每 4 秒轮询,新对话自动出现。
- **新建拉起**:填名称/任务,`POST /api/sessions/launch` 在该目录起一个全新 agent(pty 注入
  `BEACON_SESSION_ID`,`markFreshLaunch` 确保是干净的 `claude` 而非 `--continue`),随即作为联系人出现、可对话。
- 前端 `AddAgentModal`:工作目录 + 运行时选择,发现列表(导入/已导入态),新建区(名称/任务/拉起)。
- 实测:发现端点在本仓库目录列出 6 段对话;导入幂等且回填 `importedAs`;launch 建 origin=human 会话;
  浏览器里弹窗自动带入目录并渲染出 6 行可导入对话。typecheck + encoding + web build 全过。

## [0.6.6] - 2026-06-20

### 改进 —— 会话 ID 由平台客观解析(不靠智能体上报)

会话 id 是客观事实,不该由 agent 自报。平台改为**自己从磁盘获取**:

- 新增 `src/server/agent-sessions.ts`:按 workPath 解析 Claude Code 的会话目录
  (`~/.claude/projects/<编码后的 workPath>/*.jsonl`),取最近修改的那段 transcript 即为该 agent 的
  真实 `nativeSessionId`(文件名即 id)。register 时由平台落库;agent 经 `CLAUDE_CODE_SESSION_ID`
  自报的值降级为**兜底**(仅当平台看不到 agent 磁盘,如远端 agent)。
- 精确恢复推广到 wake 与终端面板:有原生 id 时用 `claude --resume <id>`,否则 `--continue`。
- 资料页会话 ID 行的占位由「智能体未上报」改为中性的「无(尚无运行时会话)」—— 没有底层运行时会话的
  联系人(如人工占位)本就没有,而非「未上报」。
- 实测:在本仓库目录注册、**不**带任何 id,平台解析出当前活跃 transcript 的 id;无 transcript 的目录退回兜底值。

## [0.6.5] - 2026-06-20

### 改进 —— 名片可随时改、资料页分区收拾干净、session id 常驻

- **智能体可随时改自己的名字 / 介绍**:新增 `update_profile` MCP 工具 +
  `POST /api/sessions/:id/profile`(agent 鉴权)+ skill 的 `name` / `about` 命令。带 bindKey 重新
  register(续接)时,若带了新名字 / 介绍也会刷新这张卡。人侧资料页的名字、介绍的编辑入口改为常驻可见。
- **资料页下半部重排**:身份元信息(Agent ID / 会话 ID / 工作路径 / 来源)收成紧凑键值区;
  **信任档位**改为分段选择器 + 当前档位的释义一行;**它的联系人**独立成带标题的分区。层级清楚,不再糊在一起。
- **会话 ID 常驻**:不再「有才显示」—— 始终列出会话 ID 一行,智能体未上报时显示「智能体未上报」,
  以便用户拿这个 id 经其他方式(如 `claude --resume <id>`)找到它。

## [0.6.4] - 2026-06-20

### 新增 —— 智能体自我介绍(名字 + 介绍 + 公开 ID)

资料页此前信息太少:别的智能体没法据此判断「要不要联系它」。补上一个智能体的**身份名片**。

- Session 新增 `description`(自我介绍:角色 / 擅长 / 在做什么),`ensureColumn` 增量迁移、读时默认 null。
  `name`(显示名,复用 `title`)与 `description` 由 agent 在 register 时自报,人也能改。
- **南向贯通**:`register_session` MCP 工具新增可选 `name` / `about`;stdio server 与零配置 skill 支持
  `AGENT_NAME` / `AGENT_ABOUT` 环境变量兜底。`list_agents` / `agents` 的发现输出带上名字 + 介绍 +
  当前任务,这样 agent 在花一次 ask 之前就能读到对方是谁。
- **北向编辑**:`PATCH /api/sessions/:id` 接受 `description`;资料页名字、介绍均可就地编辑(人创建的
  智能体也能补全),并把 **Agent ID**(=session.id,peer 寻址的公开地址)亮出来、一键复制。
- 资料页:名字 + 当前任务副标题 + 「介绍」段落 + Agent ID / 会话 ID,信息足以让对端判断是否发起联系。

## [0.6.3] - 2026-06-20

### 新增 —— 捕获运行时原生 session id(精确恢复 + 资料展示)

- 实测确认 Claude Code 经 `CLAUDE_CODE_SESSION_ID` 把自己的会话 id 注入子进程。MCP server 与零配置
  skill 在 register 时读取并上报(`AGENT_SESSION_ID` 可显式覆盖,`CODEX_SESSION_ID` 兜底 codex)。
- Session 新增 `nativeSessionId`(`ensureColumn` 增量迁移,读时默认 null);`register` 接受该可选字段。
- 「在终端中打开」由模糊的 `claude --continue` 升级为精确的 `claude --resume <id>`(有 id 时);
  codex 用 `codex resume <id>`。资料页 / 会话信息页展示 `会话 ID`。
- 定位:原生 session id 是**属性**(精确恢复 + 展示),不是身份主键 —— 主键仍是 Beacon 自铸 id。

## [0.6.2] - 2026-06-20

### 新增 —— 可见范围 + 智能体主动申请联系(授权双向化)

把「智能体间通信授权」从「只有人手工配」升级为「有默认范围、agent 能申请、人审批」。

- **默认可见范围 = 同一工作目录**:`isVisibleScope`(同目录或嵌套)。agent 查地址簿
  (`list_agents` / `GET /api/agents?visibleTo=`)只看得到可见范围内的同伴,不再枚举全部名册。
- **三态裁决**:`resolvePeerPermission` → `allow / deny / approval`。逐对 Grant > 档位
  (autonomous 放行 / restricted 拒绝)> 可见性闸门 > (trusted 放行 / **standard 要审批**)。
  范围外只有显式 allow Grant 能触达。
- **智能体主动申请**:`contact_requests` 表 + `request_contact` MCP 工具 +
  `POST /api/sessions/:id/request-contact`。agent 对可见但未授权的对象发起申请 → 以一条
  **联系申请** ask 弹给监护人(`允许 / 拒绝`)→ 批准即固化为 allow Grant,申请方解除阻塞。
  `notify_agent` / `ask_agent` 命中未授权会提示去 `request_contact`。
- **前端**:联系申请在对话里渲染为本地化审批卡(申请人 → 目标 + 理由 + 允许/拒绝)。
- **资料页「它的联系人」**:每个联系人的资料页列出它的通讯录 —— 可见范围内的同伴 + 被规则打通的,
  逐个带状态(可通信 / 已拒绝 / 待你审批 / 可申请)与就地操作(允许 / 禁止 / 移除)。
- 修复:进程内 MCP(托管 HTTP)此前**绕过**了 peer 授权检查,现已与 REST 路由一致。

## [0.6.1] - 2026-06-20

### 新增 —— 微信式「通讯录」整页视图(人侧)

0.6.0 的智能体间通信与授权是后端能力,人这一侧只有零散入口。本版把它做成可见、可操作的整页结构,参考微信:

- **左栏视图切换**:`消息`(聊天)/`通讯录`(名册)两个顶层视图,Rail 顶部图标切换,未读以圆点提示。
- **通讯录整页**:左侧名册(搜索、`通讯录管理`、按活跃/已归档分组),点一个智能体,右侧显示**资料页** ——
  头像、运行时、状态、`工作路径`、`来源`(自行注册 / 由人创建)、`信任档位`选择器、`互通授权`
  (逐对 allow/deny,就地增删),底部 `发消息` 跳回聊天。
- 资料页的授权读写复用 `/api/grants`;`通讯录管理` 仍可打开授权总览弹窗。
- `Session` 前端类型补 `origin` 字段。

## [0.6.0] - 2026-06-20

### 新增 —— 智能体身份、智能体间通信、授权(全部向后兼容、增量迁移)

按 `docs/identity-design.md` 顶层设计落地,旧 agent 接入零感知。

#### 身份与监护

- 新增 `owner` 表:启动即确保唯一监护人(token 默认取 `PLATFORM_TOKEN`)。
- 每个 session(= 联系人)获得稳定身份字段:`bindKey`(续接凭证)、`origin`、`guardianId`、`trustTier`,
  均经 `ensureColumn` 增量迁移(旧库原地升级、读时默认兜底)。
- `register` 支持可选 `bindKey`(命中即续接同一联系人)、`name`、`origin`,响应新增 `agentId`。

#### 智能体间通信(agent ↔ agent)

- 新增 peer 语义,全程经平台中转、人侧可见:`notify_agent`(非阻塞)、`ask_agent`(阻塞,复用既有
  ask 长轮询)、`answer_agent`、`list_agents`。MCP 两路(stdio + 托管 HTTP)与零配置 skill CLI
  (`agents` / `notify-agent` / `ask-agent` / `answer-agent`)均已支持。
- 端点:`POST /api/sessions/:id/{peer-notify,peer-ask,peer-reply}`、`GET /api/agents`。
- 前端:peer 消息以独立气泡渲染(`发往/来自 <agent>` + 问题角标),收发双方对话都实时更新。

#### 授权

- 每个 agent 的**信任档位**(`restricted | standard | trusted | autonomous`)+ **逐对 Grant**
  (allow/deny):`resolvePeerPermission` 最具体者胜(全局闸 > 逐对 Grant > 发起方档位)。
- 端点:`GET/POST /api/grants`、`DELETE /api/grants/:id`;`PATCH /api/sessions/:id` 支持 `trustTier`;
  `settings.agentComm` 全局总闸。
- 前端:Settings 全局通信开关 + 每个 agent 的信任档位选择器。

### 验证

- `npm run e2e` / `npm run e2e:http` 全回归通过(human↔agent 与 5 个原 MCP 工具零破坏)。
- agent↔agent 全链路(后端 + MCP 两路 + skill CLI)与授权矩阵端到端实测;前端经浏览器实机 QA。

## [0.5.5] - 2026-06-19

### 修复(QA 发现的 14 个 issues 全量修复)

#### P0 — 立即修

- **ISS-005**: `POST /api/sessions/:id/status` 收到非法 status 值(如 `"banana"`)不再静默返回 200;
  改为在 route 层校验 `SESSION_STATUSES` 枚举,越界返回 400 + 错误说明。
- **ISS-010**: `/reply` 当 `hasLivePty=true` 但 `writeToPty` 返回 false 时(非 agent runtime 如
  `cmd-test`)不再虚报 `agent:'online'`;改为读返回值,false → `agent:'queued'`。

#### P1 — 尽快修

- **ISS-003**: `POST /api/sessions/register` 接受空 body → 400(`runtime is required` /
  `task is required`)。
- **ISS-004**: `POST /api/sessions/:id/ask` 空 question → 400,不再把 session 卡进无内容
  的 waiting 状态。
- **ISS-006**: `POST /api/sessions/:id/reply` 提供的 `askId` 找不到或已 answered/cancelled → 404,
  不再静默降级为 free chat(导致真 ask 永远 pending、agent 永远等)。
- **ISS-011**: `/pty` WS 鉴权现在同时接受 `?token=` query param 和 `Authorization: Bearer …`
  header,与 REST south API 保持一致。

#### P2 — 常规 backlog

- **ISS-007**: `PUT /api/settings` 校验 `autoStart`(`ask|auto|off`)和 `startPermission`
  枚举白名单,越界返回 400。
- **ISS-009**: 非法 JSON 请求体不再返回暴露服务器绝对路径的 HTML 堆栈页;Express 5 后挂
  `entity.parse.failed` 错误中间件,统一返回 `{"error":"invalid json"}`。
- **ISS-012**: `/pty` WS 的 token 校验从 `wss.on('connection')` 提前到 `server.on('upgrade')`
  阶段,越权连接在 HTTP 层就被 `socket.write('HTTP/1.1 401…')` 拒掉,不再有瞬时 open 后 1008 的
  问题。

#### P3 — 可选

- **ISS-008**: `PATCH /api/sessions/:id {}` 空 body 不再无声 200;返回 400
  `"no patchable fields"`。
- **ISS-013**: 去掉 `<html class="dark">` 硬编码;改为在 `<head>` 首位插入最小内联脚本
  (`localStorage + prefers-color-scheme`)在首屏 paint 前设好 theme,浅色偏好用户不再有 FOUC。

#### 已在此前版本修复(记录存档)

- **ISS-001**(P2): 组件中硬编码中文已在 v0.5.3 迁入 i18n。
- **ISS-002/014**(P1/P3): 进程版本不一致 = 未重启旧进程,无代码 bug。

## [0.5.4] - 2026-06-19

### 变更(把终端做成"永远在线",去掉断连/排队等摩擦状态)

像 Claude Code / Codex 一样:打开就能用,想跟哪个对话就跟哪个,不该出现"断连""排队""未运行"。

- **终端静默自动重连。** 去掉红色"连接失败 / 重连"大框和手动重连按钮。socket 断了自动以
  1~3s 退避重连,只在右上角显示一个不打扰的"重连中…"小标;重连时 `term.reset()` 让服务端缓冲
  回放干净重绘,不再叠字。鉴权/会话不存在(1008)才不重试。
- **发消息永不"排队"。** 没有活终端时,`/reply` 当场起一个交互式 agent 终端并把消息打进去
  (claude-code/codex);输出缓冲到你打开终端时回放。只有无法启动的 runtime 才回退排队。
  - `pty.ts` 新增 `ensurePty()`(按需 spawn)、启动期(<3.5s)消息排队待 TUI 就绪后冲刷、
    无人观看的进程也会被 30 分钟空闲回收。
  - `/reply` 决策简化为:ask 回答走长轮询 → 有活终端写进去 → 真·自治 agent 在线则投递收件箱
    → 否则当场起终端写进去。移除了 `starting/offline` 唤醒分支。

## [0.5.3] - 2026-06-19

### 修复(人机交互核心,重要)

- **发消息后终端无反应 + 智能体"自动关闭"。** 根因:Beacon 消息通道与嵌入终端是两条互不相通的链路。
  你发的消息进了 store,但终端里的交互 claude 不轮询 inbox 看不到;同时终端 claude 不调用 Beacon,
  presence 判它"离线",`/reply` 又 spawn 了一个 headless `claude --continue --print` 去同一目录恢复
  同一对话——两个 claude 冲突,headless 那个跑完一轮就退出,看起来就是"自动关闭"。
- **现在:终端就是智能体。** 当某 session 有活的终端 PTY 时,你发的聊天消息直接写入它的 stdin
  (等同于替你在 claude 里输入并回车),消息真正进入终端、智能体据此行动;**绝不再 spawn 冲突进程**。
  - `src/server/pty.ts` 新增 `hasLivePty()` / `writeToPty()`;`/reply` 优先走终端注入。
  - 终端打开期间维持 session presence "在线"(30s 心跳 `touchSeen`),交互 claude 自身不调 Beacon
    也不会被误判离线。ask 的回答仍走原长轮询通道,不注入终端。

## [0.5.2] - 2026-06-19

### 变更 / 修复

- **嵌入终端不再每次打开都慢。** 原来每次打开「终端」标签都重新 `spawn('claude --continue')`,
  claude 冷启动要数秒;切回「消息」又会 kill 进程,再切回来重启一遍。现在 PTY 进程按 sessionId
  **持久化**:第一次打开才 spawn,之后切标签、刷新页面、开第二个浏览器标签都是「附加」到已存在的
  进程,并回放最近输出缓冲(≤200KB),~10ms 内重建画面。无人连接 30 分钟后才回收进程。
  - 实测:首连 spawn 后 6s 内输出 50KB;重连 8ms 连上、9ms 回放完成,不再重启 claude。

## [0.5.1] - 2026-06-19

### 修复

- **终端 WebSocket 连接失败(400)。** `/ws` 和 `/pty` 两个 WebSocketServer 都用 `{ server }` 选项
  挂在同一 HTTP server 上时,`/ws` 的实例会先拦截 `/pty` 的升级请求并以 400 拒绝,导致终端永远连不上。
  改为两者都用 `noServer: true`,由单个 `upgrade` 事件按 pathname 手动路由。

## [0.5.0] - 2026-06-19

### 新增

- **嵌入式终端(Embedded Terminal)**。对话界面头部新增「消息 | 终端」切换标签。点「终端」直接在
  Beacon 界面里打开 xterm.js 终端,运行 `claude --continue`(claude-code)、`codex`(codex)
  或交互式 shell(其他 runtime),体验与在本地终端里操作完全一致。
  - 后端:新增 `/pty` WebSocket 端点(`src/server/pty.ts`),基于 `node-pty`(ConPTY on Windows)
    给每个连接分配独立 PTY 进程;自动注入 `BEACON_SESSION_ID` 环境变量让 agent 归属正确 session。
  - 前端:新增 `TerminalPanel.tsx`(xterm.js + FitAddon),GitHub 暗色主题,
    ResizeObserver 自动发 resize 消息,连接断开后显示提示。
  - Vite 开发代理新增 `/pty` 路径;生产下 PTY WS 与 REST 共享同一端口。

### 变更

- **移除"正在启动智能体"banner 及离线提示栏。** 不再弹出启动提示:
  有了嵌入终端,用户直接点「终端」标签启动 agent,不需要额外的"启动"按钮流程。

## [0.4.3] - 2026-06-19

### 新增

- **消息已送达确认(✓)**。人发出的 chat 消息,一旦 agent 调用 `check_inbox` 读取,
  气泡右下角即刻出现绿色 `✓` 图标,悬停可看送达时间。
  - 后端:messages 表新增 `deliveredAt INTEGER` 字段(additive migration,不破坏已有数据);
    `inbox()` 返回时 SQL 批量打标记并通过 bus 推 WS 事件。
  - 前端:WS `message` 事件改为 upsert(相同 id → in-place 更新),使 deliveredAt 能实时反映。
  - `answer` 类消息(ask 的回答)不需要此标记,因为它通过长轮询直接唤醒 agent。

## [0.4.0] - 2026-06-19

### 变更(产品化:把"启动离线智能体"做成界面操作,不再用环境变量)

- **给没在运行的智能体发消息时,界面直接出现「启动并处理」一键按钮。** 点一下就把它启动起来读消息、
  回你;可勾「以后自动启动」记住选择。普通用户全程在界面里完成,**不接触任何环境变量或"唤醒"黑话**。
- **新增设置面板(左栏齿轮)**,纯中文/英文选项:「先问我(默认)」/「自动启动它」/「只把消息排队」。
  设置存到 `data/settings.json`,经 `GET/PUT /api/settings` 读写。
- 新增 `POST /api/sessions/:id/start` 一键启动端点;`POST /reply` 现在按设置返回
  `agent: online | starting | offline | queued`,驱动界面。
- 启动逻辑仍是 `claude --continue --print --permission-mode <mode>`(复用对话上下文,stdin 传消息、防注入);
  权限默认 `bypassPermissions`(让它能真正干活),由设置控制,不再靠 `BEACON_WAKE` 环境变量。
  `BEACON_WAKE_CMD` 作为高级覆盖仍保留。

## [0.3.1] - 2026-06-19

### 变更 / 修复

- **自动唤醒改为可配置权限,默认关闭(安全可发布)。** 0.3.0 的唤醒只跑
  `claude --continue --print`,headless 下没有工具权限,被唤醒的 agent 读不了收件箱、回不了消息,
  悄悄退出 —— 看着像"发了没反应"。现在权限做成可配置:
  - `BEACON_WAKE` 选择被唤醒 agent 的权限模式,**默认 `off`(不自动唤醒)**。
  - 启用并选模式:`full`(= Claude 的 `bypassPermissions`,完全自主接着干活)、
    `acceptEdits`、`default`、`plan`、`bypassPermissions`,直接映射到 `claude --permission-mode`。
  - `--continue` 复用该对话**之前的上下文/任务**;权限模式由本设置决定(headless 启动无法自动继承)。
  - `BEACON_WAKE_CMD` 仍可整体覆盖唤醒命令。
  - **安全提示:** 设成 `full` 后,一条入站消息会自动启动一个**全自主**的 Claude 在该目录真实动手
    (消耗额度)。这是显式 opt-in;公开默认是关闭的。
- 唤醒进程的 stdout/stderr 现在被捕获并记录(退出码 + 输出片段),不再静默失败,便于排查。

## [0.3.0] - 2026-06-18

### 新增

- **在线/离线状态(presence)。** session 新增 `lastSeenAt`,agent 每次与 Beacon 交互即刷新;
  界面用实心点(在线/运行中)与空心灰圈(离线/未运行)区分,头部与右侧面板都显示。让你**一眼看出
  agent 进程是否还在跑**——而不是只看它最后自报的 working/waiting 状态。
- **离线自动唤醒(auto-wake)。** 给一个**离线**的 agent 发消息时,平台在它的工作目录里把它**重新拉起来**
  (Claude Code: `claude --continue --print`),把你的消息经 **stdin** 喂给它(不进命令行 → 防注入),
  复活的 agent 读收件箱、据此继续。**全自动、零配置**:每种运行时的唤醒方式写在 `src/server/wake.ts`
  代码里一次,人和 agent 都不用配。带 90s 冷却防风暴;给离线 agent 发消息时界面提示「正在唤醒…」。
- 环境变量:`BEACON_WAKE=0` 关闭自动唤醒;`BEACON_WAKE_CMD` 覆盖唤醒命令(自定义 resume 包装器)。

### 兼容性

- 增量迁移:`sessions` 新增 `lastSeenAt` 列,经 `ALTER TABLE` 原地补齐,旧库升级无损。

## [0.2.0] - 2026-06-18

### 新增

- **托管式 MCP 接入(HTTP transport)。** 平台自身在 `/mcp` 暴露 Streamable HTTP MCP 端点。
  接入从「绑定本地路径的 stdio 命令」简化为一行**全局、无路径**命令:
  `claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp`。
  `-s user` 让它对所有项目全局生效;**平台升级时该命令不变**——URL 就是契约。
  五个工具的定义抽到 `src/mcp/tools.ts` 单一来源,stdio 与 HTTP 两条路共用,永不漂移。
- **会话管理:重命名与归档。** 新增 `PATCH /api/sessions/:id`(`title`、`archived`);
  对话头部「⋯」菜单可重命名/归档,左栏底部「已归档」分组可展开与恢复。
- **中英文切换。** 全新 i18n(`web/src/lib/i18n.tsx`),左侧栏一键切换,跟随浏览器语言、
  记忆到 localStorage。所有界面文案双语化。
- **版本可见。** `/api/health` 与接入面板返回 `version`,便于判断在用实例是否最新。
- **更新脚本。** `npm run update` = `git pull && npm install && npm run build:web`;
  `npm run e2e:http` 为 HTTP MCP 端到端冒烟。

### 变更

- 接入面板(Connect)改为 **MCP 标签页优先**,首屏即那行全局 HTTP 命令;stdio 方式降级为
  「本地(进阶)」备选。

### 兼容性

- **数据库为增量迁移**:`sessions` 新增 `title`、`archivedAt` 两列,经 `ALTER TABLE` 原地补齐,
  旧 `data/beacon.db` 升级后数据完整保留。
- stdio MCP、REST API、skill CLI 命令保持不变,既有接入无需重配。

## [0.1.0]

- 首个可用版本:notify/ask/status/session 语义、SQLite 存储、REST + WebSocket 网关、
  stdio MCP server、零配置 skill、React 前端(Codex 风格)、Docker 部署。
