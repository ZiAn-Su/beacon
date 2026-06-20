# 身份体系——实现计划(分阶段)

> 依据 [`docs/identity-design.md`](identity-design.md) 的顶层设计落地。**只增不改、向后兼容**——
> 旧 agent 接入不受影响,旧库 `ensureColumn` 原地迁移。核心语义见设计文档;本文是实现规格。

## 总分期(build order)

| 阶段 | 内容 | 风险 | 委托性 |
|---|---|---|---|
| **P1** | 身份与监护地基(Owner / 永久 contact 身份 / bindKey 续接 / guardian / trustTier)——纯增量后端 | 低 | ✅ 可委托 |
| P2 | Channel(对话容器)+ Participant;存量 session 消息映射到自动 Direct channel | 中 | 半委托 |
| P3 | agent↔agent 通信(peer notify/ask + MCP 工具 + peer 消息方向) | 中 | 半委托 |
| P4 | 授权(三类能力 / 分级信任 / Grant / 审批队列) | 高 | 作者主导 |
| P5 | 群组 + 人侧 UI 面(联系人档案、监督视图、权限面板) | 中 | 委托 UI |

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
