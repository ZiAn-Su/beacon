# 身份体系——实现计划(分阶段)

> 依据 [`docs/identity-design.md`](identity-design.md) 的顶层设计落地。**只增不改、向后兼容**——
> 旧 agent 接入不受影响,旧库 `ensureColumn` 原地迁移。核心语义见设计文档;本文是实现规格。

## 状态标注(必读)

本文是 P1/P4 等历史切片的**实现规范**,保留切片当时的完整写法供审计参考。

**现行授权模型**与本规范描述不完全一致:

- **现行模型**(以 [`src/core/permissions.ts`](../src/core/permissions.ts) 为准):授权 = 能力(`contact_agent` / `register_agent` / `spawn_agent`)× 效果(`allow` / `ask` / `deny`)。
- **解析顺序**:逐对 grant (contact only) > 逐 agent override > owner 全局默认 > 内置兜底 'ask'。
- **`trustTier` 是遗留字段**:仍在 sessions 表里、读时默认 `'standard'`,但**授权解析里零引用、什么都不触发**,不是「restricted 触发 deny」——它根本不参与判定。已被能力 × 效果取代,保留仅为兼容历史数据。

下文 P4 切片 1 段落里出现的 trustTier / 四档描述均为切片当时规范,不动即可,不视作现状。

## 总分期(build order)

| 阶段 | 内容 | 风险 |
|---|---|---|
| **P1** | 身份与监护地基(Owner / 永久 contact 身份 / bindKey 续接 / guardian / trustTier)——纯增量后端 | 低 |
| P2 | Channel(对话容器)+ Participant;存量 session 消息映射到自动 Direct channel | 中 |
| P3 | agent↔agent 通信(peer notify/ask + MCP 工具 + peer 消息方向) | 中 |
| P4 | 授权(三类能力 / 分级信任 / Grant / 审批队列) | 高 |
| P5 | 群组 + 人侧 UI 面(联系人档案、监督视图、权限面板) | 中 |

---

## Phase 1 规格(本次实现)

目标:给"session = agent = 联系人"补上**稳定身份 + 监护归属**,全部增量,不动消息/对话模型,不动 UI。

### 1. 约定(必须遵守,违反即返工)

- 全程 ESM,相对导入省略扩展名;`tsx` 运行,**不加编译步骤**。
- 迁移**只用 `ensureColumn`**(`ALTER TABLE ADD COLUMN`),**绝不** DROP/改列/重写。
- 文件 **UTF-8 无 BOM**;`src/**` 内**不得**出现中文(编码门 `npm run check:encoding` 会拦)。
- zod 用现有原始 shape 写法(见 `src/mcp/tools.ts`),不改风格。
- 现有 `/api/sessions/register` 在**不带新字段时行为完全不变**;响应只**新增**字段,不删不改。

### 2. 数据模型增量(`src/core/store.ts`)

新建表(`CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS owner (
  id TEXT PRIMARY KEY,
  name TEXT,
  token TEXT,
  createdAt INTEGER NOT NULL
);
```

sessions 增列(每列一句 `ensureColumn`):

| 列 | 类型 | 含义 / 默认 |
|---|---|---|
| `bindKey` | TEXT | 续接凭证;null = 匿名一次性 |
| `origin` | TEXT | 'agent'(自注册)\| 'human'(人预建);默认按 'agent' 处理 |
| `guardianId` | TEXT | 监护人 = Owner.id;注册时回填 |
| `trustTier` | TEXT | 'restricted'\|'standard'\|'trusted'\|'autonomous';读时默认 'standard' |

> 注意:`ensureColumn` 不支持带默认值的回填;新列对旧行为 NULL,**在 map/读取层兜底默认值**(如 `trustTier ?? 'standard'`),不要写 UPDATE 批量回填。

### 3. 类型增量(`src/core/types.ts`)

- 新增 `Owner` 接口:`{ id: string; name: string | null; token: string | null; createdAt: number }`。
- `Session` 接口追加:`bindKey: string | null; origin: 'agent' | 'human'; guardianId: string | null; trustTier: TrustTier`。
- 新增 `export type TrustTier = 'restricted' | 'standard' | 'trusted' | 'autonomous'` + `TRUST_TIERS` 数组。
- `mapSession` 化:目前 store 直接把 row 当 Session 返回(`SessionRow = Omit<Session,never>`)。**新增一个显式 `mapSession(row)`**,对新列做默认兜底(`origin ?? 'agent'`、`trustTier ?? 'standard'`、其余 `?? null`),所有读取路径(`getSession`/`listSessions`)都经它。

### 4. 行为增量(`src/core/store.ts`)

- `ensureOwner(): Owner` —— 启动时调用;若 `owner` 表空,插入一条 `{ id: randomUUID(), name: null, token: process.env.PLATFORM_TOKEN ?? null, createdAt }`。返回唯一 Owner。模块加载时执行一次,导出 `getOwner()`。
- `createSession` 扩展入参:`{ runtime, workPath, task, bindKey?, origin?, name? }`。
  - `guardianId` 回填为 `getOwner().id`。
  - `origin` 默认 'agent';`bindKey` 默认 null;`name` 若给则写入 `title`。
  - 其余不变(仍 emit `bus('session')`)。
- **`registerOrClaim(input)`** —— 新函数,注册的"找或建":
  - 若 `input.bindKey` 非空且存在 `bindKey` 匹配的 session → **续接**:更新其 `lastSeenAt`、status 置 'working'、emit session,返回该 session(同一 id)。
  - 否则 → `createSession(input)`。
  - 返回 `Session`。
  - 加一条预编译 `selectSessionByBindKey`。

### 5. 网关增量(`src/server/index.ts`,`/api/sessions/register`)

- 入参解析追加可选:`bindKey`、`name`、`origin`(仅接受 'agent'|'human',非法忽略按 'agent')。校验沿用现有(runtime/task 必填)。
- 改调 `store.registerOrClaim({ runtime, workPath, task, bindKey, origin, name })`。
- 响应**新增** `agentId: session.id`(与 `session` 并存),其余不变。

### 6. 验收(子智能体必须自测并贴出证据)

```bash
npm run typecheck        # 必须过
npm run check:encoding   # 必须过(src 内无中文/BOM)
# e2e:另起一终端 npm run platform,再:
npm run e2e              # 现有 stdio MCP 回归必须仍过(向后兼容证明)
```

手测(平台跑起来后):

```bash
B=http://127.0.0.1:4319
# a) 不带 bindKey:每次新 id(向后兼容)
curl -s -X POST $B/api/sessions/register -d '{"runtime":"t","task":"x"}' -H content-type:application/json
# b) 带 bindKey 两次:同一 id(续接)
curl -s -X POST $B/api/sessions/register -d '{"runtime":"t","task":"x","bindKey":"KEY-1"}' -H content-type:application/json
curl -s -X POST $B/api/sessions/register -d '{"runtime":"t","task":"y","bindKey":"KEY-1"}' -H content-type:application/json
# 两次返回的 session.id / agentId 应相同
# c) 响应含 agentId 字段;GET /api/sessions 各项含 guardianId / trustTier / origin / bindKey
```

### 7. 明确不做(越界即返工)

- 不动 messages / asks 表与逻辑;不引入 channel(那是 P2)。
- 不做授权检查、不做 peer 通信(P3/P4)。
- 不动任何 `web/**`、不动 README、不动 `company/**`、不动 `docs/identity-design.md`。
- 不改 MCP 工具的对外 schema(P1 不需要 agent 侧感知 bindKey;后续阶段再加)。
- 不删除/重命名任何现有导出函数。

---

## 架构决定:agent↔agent 先用 peer-message 模型,channel 留给群组

摸过真实代码后定调:UI 与 WS 全部按 `sessionId` 寻址。**现在做完整 channel 重构会打断 UI 且慢**。
所以 agent↔agent 用**向后兼容的 peer-message 模型**——单行消息挂在收件方 session 上,发件方靠
`fromSessionId` 也能看到;**阻塞式 peer-ask 复用现有 ask + 长轮询 + waiter 基础设施,不新写长轮询**。
完整 Channel(N 方房间)留到 **P5 群组**真正需要时再上。这样核心功能最快落地、零破坏。

---

## Phase 3 规格(后端:agent↔agent 通信)—— 本次实现

> 约定同 P1(ESM / ensureColumn 只增 / src 内无中文 / 不删改现有导出 / 向后兼容)。
> **本阶段只做后端(core + gateway),不做 MCP 工具、不做 UI**——那是 P3 的后续子任务。

### A. 消息模型增量

- `src/core/types.ts`:`MsgKind` 增加 `'peer'`;`Message` 增加 `fromSessionId: string | null`。
- `src/core/store.ts`:`ensureColumn('messages','fromSessionId','TEXT')`;`MessageRow` 加 `fromSessionId`;
  `mapMessage` 输出 `fromSessionId: r.fromSessionId ?? null`;`insertMessage` 的 SQL + `addMessage`
  支持可选 `fromSessionId`(默认 null,旧调用不变)。

**peer 消息的统一形状**(一行,挂在“收件方”线程):
```
{ sessionId: <收件方>, fromSessionId: <发件方>, direction:'agent', kind:'peer', text, askId?, meta? }
```
- 收件方线程(`sessionId=收件方`)与收件箱天然能看到它。
- 发件方线程靠下面 §C 扩展的 `messages()` 用 `fromSessionId` 包含进来。

### B. 收件箱与线程读取扩展

- `inbox(sessionId, afterTs)`:在现有 `direction='human' AND kind='chat'` 基础上,**或上** `kind='peer'
  AND sessionId=? AND fromSessionId IS NOT NULL`(即投给我的 peer 消息)。仍照旧标记 delivered + emit。
  → agent 通过 check_inbox 收到别的 agent 发来的话。
- `messages(sessionId)`:SQL 改为 `WHERE sessionId=? OR fromSessionId=? ORDER BY createdAt ASC`。
  → 发件方线程也能看到自己发出的 peer 消息(UI 后续按 from/to 标注;本阶段不管 UI)。

### C. peer-notify(非阻塞)

`store.peerNotify(fromId, toId, text): Message`
- 校验两个 session 都存在(任一不存在 → 抛错,gateway 转 404)。
- `addMessage({ sessionId: toId, fromSessionId: fromId, direction:'agent', kind:'peer', text })`。
- 返回该 message(`addMessage` 已 emit + touch toId)。

### D. peer-ask(阻塞,复用现有 ask 基础设施)—— 核心,务必逐字按此实现

`store.peerAsk(fromId, toId, question, options): Ask`
1. 校验 fromId、toId 存在。
2. **直接 INSERT 一条 ask 行**(不要调用现有 `createAsk`,它会把问题作为 agent→human 的 ask 浮到人那侧):
   `{ id:uuid, sessionId: fromId, question, options, status:'pending', answer:null, createdAt, answeredAt:null }`。
   —— ask 归属**发问方 fromId**(它要阻塞)。
3. `setStatus(fromId, 'waiting')`(发问方进入等待)。
4. 把问题作为 peer 消息投到**收件方**:`addMessage({ sessionId: toId, fromSessionId: fromId,
   direction:'agent', kind:'peer', text: question, askId: <该 ask id>, meta: options?{options}:null })`。
5. 返回该 ask。
- 发问方 agent 随后照常长轮询 **现有** `GET /api/asks/:askId/wait`(无需新代码)。

`store.agentAnswer(askId, text): Ask`(收件方回答,解除发问方阻塞)
1. `getAsk(askId)`;若不存在或非 pending → 返回原样(gateway 据此 404/409)。
2. 把回答作为 peer 消息投回**发问方线程**:`addMessage({ sessionId: ask.sessionId(=fromId),
   fromSessionId: <回答方 toId>, direction:'agent', kind:'peer', text, askId })`。
3. `updateAskAnswer.run({ id:askId, answer:text, answeredAt:now() })`。
4. 若发问方 session 当前 'waiting' → `setStatus(fromId,'working')`。
5. `flushWaiters(getAsk(askId)!)` —— 唤醒发问方的长轮询(复用现有 waiter 表)。
6. 返回 answered 后的 ask。

### E. 目录(联系人寻址用)

`GET /api/agents` → `ok(res, { agents: store.listSessions() })`(单用户下即全部联系人,带 P1 的
`guardianId/trustTier/origin/bindKey` 与状态)。本阶段不做作用域过滤(P4 授权再做)。

### F. 网关端点(`src/server/index.ts`)

- `POST /api/sessions/:id/peer-notify`  body `{ targetId, text }` → 校验 text 非空、targetId 存在 →
  `store.peerNotify(param(req,'id'), targetId, text)` → `ok(res,{message})`;target 不存在 → 404。
- `POST /api/sessions/:id/peer-ask`  body `{ targetId, question, options? }` → 校验 question 非空、
  targetId 存在 → `store.peerAsk(id, targetId, question, options??null)` → `ok(res,{askId})`。
- `POST /api/sessions/:id/peer-reply`  body `{ askId, text }` → 校验 text 非空、ask 存在且 pending →
  `store.agentAnswer(askId, text)` → `ok(res,{ok:true})`;ask 不存在/已答 → 404/409。
- 沿用现有 `param()`、`agentAuthOk()`(peer 端点同样过 `agentAuthOk`)、`ok()` 辅助。
- **最小授权闸**:`getSettings()` 增加 `agentComm: 'open' | 'off'`(默认 `'open'`,单用户同一监护人);
  若为 `'off'`,peer-notify / peer-ask 返回 403 `{error:'agent-to-agent messaging disabled'}`。
  (完整能力/Grant/审批是 P4;本阶段仅此全局开关。)

### G. 验收(子智能体自测 + 贴证据)

- `npm run typecheck`、`npm run check:encoding` 必须过。
- `npm run e2e` 全回归必须仍过(隔离实例,证明没破坏 human↔agent 路径)。
- 隔离实例手测(curl,贴真实输出):注册两个 session A、B;
  1. A `peer-notify` → B;`GET /api/sessions/B/inbox?afterTs=0` 含该 peer 消息(`kind:'peer'`,`fromSessionId=A`)。
  2. A `peer-ask` → 拿到 askId;`B/inbox` 看到带 `askId` 的问题;**后台**对 `/api/asks/:askId/wait` 发起轮询;
     B `peer-reply{askId,text}` → 该轮询返回 `status:'answered'`、`answer=text`;`GET A` 的 status 回到 `working`;
     `GET /api/sessions/A/messages` 能看到这条回答(`fromSessionId=B`)。
  3. `GET /api/agents` 返回 A、B 且各含 `trustTier/guardianId`。
  4. 设 `agentComm:'off'` 后 peer-notify 返回 403。
- 清理隔离实例与临时库。

### H. 明确不做(越界即返工)

- 不做 MCP 工具(notify_agent/ask_agent/list_agents)——下一子任务。
- 不动任何 `web/**`、README、`company/**`、设计文档。
- 不做 P4 的能力/Grant/审批/作用域过滤;只做 `agentComm` 全局开关。
- 不引入 channel 表。不删除/重命名现有导出函数。

---

## Phase 3b 规格(agent 侧接入面:MCP 两路 + skill CLI)—— 本次实现

> 后端端点已就绪且验过(`peer-notify`/`peer-ask`/`peer-reply`/`GET /api/agents`)。本阶段把它们暴露给
> agent。约定同前(ESM / src 无中文 / 向后兼容 / 不删改现有导出)。**只动 agent 接入面,不动 core/gateway/web。**

### 可触文件(仅此三个)
- `src/mcp/tools.ts` —— `AgentOps` 接口扩展、`registerBeaconTools` 新工具、`httpOps` 实现
- `src/server/mcp-http.ts` —— `storeOps` 实现新 ops(直连 store/HTTP 皆可,见下)
- `skill/beacon/beacon.mjs` —— 新增 CLI 子命令

### A. AgentOps 扩展(`src/mcp/tools.ts`)

新增方法(都接已存在的后端端点 / store):
```
listAgents(): Promise<{ id: string; task: string; status: string; runtime: string }[]>
peerNotify(fromId, targetId, text): Promise<void>
peerAsk(fromId, targetId, question, options?): Promise<{ askId: string }>
peerReply(answererId, askId, text): Promise<void>
```
并**加宽 `inbox` 返回**(加可选字段,向后兼容):
```
inbox(id, after): Promise<{ text; createdAt; kind?: string; fromSessionId?: string | null; askId?: string | null }[]>
```
- `httpOps`:listAgents→`GET /api/agents`(返回 `agents`,映射 id/task/status/runtime);peerNotify→`POST /api/sessions/{fromId}/peer-notify {targetId,text}`;peerAsk→`POST .../peer-ask {targetId,question,options}`;peerReply→`POST /api/sessions/{answererId}/peer-reply {askId,text}`;inbox 改为透传 `kind/fromSessionId/askId`(后端 inbox 已返回完整 message)。
- `storeOps`(mcp-http.ts):listAgents→`store.listSessions()` 映射;peerNotify→`store.peerNotify`;peerAsk→`store.peerAsk(...)`→`{askId}`;peerReply→`store.agentAnswer(askId, text, answererId)`;inbox 映射时带上 `kind/fromSessionId/askId`。

### B. 新增 4 个工具(`registerBeaconTools`)

- `list_agents`(无输入):列出**其他**联系人(排除自己 sessionId),格式 `<id> — <task> [<status>]`;空则提示无其他 agent。
- `notify_agent`(`agent_id`, `message`):`ensure()` 拿自身 id → `peerNotify(self, agent_id, message)` → "Delivered to agent."。
- `ask_agent`(`agent_id`, `question`, `options?`):`ensure()` → `peerAsk(self, agent_id, question, options)` → 拿 askId → **复用现有 waitAsk 循环**(同 ask_human)→ 返回对方答复;cancelled 时给出对应文案。
- `answer_agent`(`ask_id`, `answer`):`ensure()` → `peerReply(self, ask_id, answer)` → "Answered."。

### C. 强化 `check_inbox` 渲染

逐条按 kind 标注,使收方知道**谁发来、是不是需要回答的问题、用什么 ask_id 回答**:
- `kind==='peer' && askId`:`[QUESTION from agent <fromSessionId>] <text>  (reply with answer_agent ask_id=<askId>)`
- `kind==='peer'`:`[from agent <fromSessionId>] <text>`
- 其它(人类 chat):保持原样 `- <text>`
- 游标 `lastInboxTs` 逻辑不变。
- (说明:A 问 B 的回答也会回流进 A 的 inbox——属可接受冗余,A 已从 ask_agent 返回拿到答案;不需特殊过滤。)

### D. skill CLI 新增子命令(`skill/beacon/beacon.mjs`)

沿用其 `api()` 与按 work-path 缓存的 sessionId:
- `agents` → `GET /api/agents`,打印其他联系人 `id — task [status]`。
- `notify-agent <agentId> <msg...>` → `POST /api/sessions/<self>/peer-notify {targetId,text}`。
- `ask-agent <agentId> <question> [opt...]` → `POST .../peer-ask` → 循环 `GET /api/asks/<askId>/wait` 打印答复(同 `ask`)。
- `answer-agent <askId> <answer...>` → `POST /api/sessions/<self>/peer-reply {askId,text}`。
- 更新顶部 usage 注释与末尾 usage 字符串。

### E. 验收(子智能体自测 + 贴证据)

- `npm run typecheck`、`npm run check:encoding` 必须过。
- `npm run e2e`(stdio MCP)与 `npm run e2e:http`(托管 HTTP MCP)在隔离实例上**都必须仍过**(证明 5 个原工具未被破坏)。
- 隔离实例 + 两个真实 MCP/CLI 会话演示一遍 agent↔agent:用 skill CLI 起 A、B,`agents` 能互相看见,A `ask-agent B` 阻塞,B `inbox` 看到带 ask_id 的问题,B `answer-agent <askId>` → A 收到答复解除阻塞。贴真实输出。
- 清理隔离实例与临时库。

### F. 明确不做

- 不动 `src/core/**`、`src/server/index.ts`(后端已完成且冻结)、`web/**`、README、`company/**`、设计文档。
- 不删除/重命名任何现有工具或导出。不改 5 个原工具的对外 schema。

---

## Phase 4 规格(授权 · 切片 1:信任档位 + 逐对 Grant)—— 本次实现

> 把 agent↔agent 的"全局 on/off"升级为**真授权**:每个 agent 的**信任档位** + **逐对放行/拒绝**。
> 本切片**不做审批队列/held 消息/approve-once-or-always**(那是切片 2 的内容)。约定同前。
> **本切片只做后端**(core + gateway),不做 UI。

### 可触文件(仅此三个)
- `src/core/types.ts` —— 新增 `Grant` 接口、`GrantEffect` 类型。
- `src/core/store.ts` —— `grants` 表 + `setGrant`/`removeGrant`/`listGrants`/`getGrant` + **`resolvePeerPermission(fromId,toId)`**。
- `src/server/index.ts` —— grants 的 CRUD 端点;peer-notify/peer-ask 接入 `resolvePeerPermission`;PATCH 会话支持 `trustTier`。

### A. 裁决语义(`resolvePeerPermission(fromId, toId): 'allow' | 'deny'`)

按优先级(最具体者胜),纯函数,无副作用:
1. 全局总闸:`getSettings().agentComm === 'off'` → **deny**(master switch,最高优先)。
2. 逐对 Grant:存在 `(fromId → toId)` 的 Grant → 用其 `effect`('allow'|'deny')。
3. 回落发起方信任档位(P1 已存 `trustTier`,读时默认 'standard'):
   - `'restricted'` → **deny**
   - `'standard'` / `'trusted'` / `'autonomous'` → **allow**
- 设计原则:默认(standard)放行,单用户同一监护人下 agent 可互通;把某 agent 降到 `restricted` 即锁死其对外发起;逐对 Grant 精确开/关某条边。

### B. 数据模型(`src/core/store.ts`)

```sql
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  fromId TEXT NOT NULL,
  toId TEXT NOT NULL,
  effect TEXT NOT NULL,          -- 'allow' | 'deny'
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grants_pair ON grants(fromId, toId);
```
- `setGrant(fromId,toId,effect)`:同一 (fromId,toId) 已存在则更新 effect,否则插入;返回 Grant。
- `removeGrant(id)`;`listGrants(): Grant[]`;`getGrantForPair(fromId,toId): Grant | undefined`。
- `resolvePeerPermission` 用 `getGrantForPair` + `getSession(fromId).trustTier` + `getSettings().agentComm`。
- 新增 `setTrustTier(id, tier)`:校验 tier ∈ TRUST_TIERS,`UPDATE sessions SET trustTier=...`,emit session,返回 session。

### C. 类型(`src/core/types.ts`)

```
export type GrantEffect = 'allow' | 'deny';
export interface Grant { id: string; fromId: string; toId: string; effect: GrantEffect; createdAt: number; }
```

### D. 网关(`src/server/index.ts`)

- 在 `peer-notify` 与 `peer-ask` 里,**把现有 `agentCommOk(res)` 替换/补充为**对 `resolvePeerPermission(fromId,toId)` 的检查:deny → 403 `{error:'not authorized to contact this agent'}`。(全局 off 仍在 resolve 内最高优先。)
- 北向(人)端点:
  - `GET /api/grants` → `{ grants: store.listGrants() }`
  - `POST /api/grants` body `{ fromId, toId, effect }`:校验两 session 存在、effect ∈ {'allow','deny'} → `store.setGrant(...)` → `{ grant }`;否则 400/404。
  - `DELETE /api/grants/:id` → `store.removeGrant(...)` → `{ ok:true }`。
- `PATCH /api/sessions/:id`:识别 `trustTier` 字段 → 校验 ∈ TRUST_TIERS → `store.setTrustTier(id, trustTier)`;非法值 400。(保持现有 rename/archive 行为不变。)

### E. 验收(子智能体自测 + 贴证据)

- `npm run typecheck`、`npm run check:encoding` 过;`npm run e2e` 全回归过(human↔agent 零破坏)。
- 隔离实例手测(贴输出):注册 A、B;
  1. 默认(standard):A peer-notify B → 200(放行)。
  2. `PATCH /api/sessions/<A> {trustTier:'restricted'}` → 之后 A peer-notify B → **403**。
  3. `POST /api/grants {fromId:A,toId:B,effect:'allow'}` → 即便 A 仍 restricted,A peer-notify B → **200**(逐对 Grant 覆盖档位)。
  4. `POST /api/grants {... effect:'deny'}`(改该对为 deny)→ A peer-notify B → **403**。
  5. `GET /api/grants` 含该对;`DELETE /api/grants/<id>` 后回落档位(A 仍 restricted → 403)。
- 清理隔离实例与临时库。

### F. 明确不做(切片 2 再做)

- 不做审批队列 / held 消息 / approve-once|task|always / 作用域 scope / ingress-egress 跨监护人。
- 不做 UI(权限面板、信任档位控件)——后续 UI 子任务。
- 本计划仅修改 `src/` 与 `web/` 子集;不动 MCP 工具、skill、README、设计文档。
- 不删改现有导出。grants 只加不改;`agentComm` 全局闸保留。
