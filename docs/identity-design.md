# 身份、联系人、对话与授权——顶层设计

> 定位:这是 Beacon 在「身份 / 联系人 / 对话 / 多智能体通信 / 授权」上的**唯一设计依据**。
> 纯设计、零实现——动手前以此为准。原则:**现在跑单人配置,但骨架按多人多 agent 立对**;
> 授权这种东西事后补最痛,抽象今天就要对。

---

## 产品原则(三条,钉死的承诺)

任何 feature、UI、工具、权限设计都要回看这三条;违背即返工。

1. **1:1 = 人 ↔ 有 owner 的 agent 专线** —— `ask` 阻塞到指定人,定向、可追责,人是 agent 的监护人,任务线有人负全责。
2. **群聊 = 多 agent 与人协作,人始终在场** —— 每个频道里 owner/监护人是第一类、显式可见的成员;agent 间协作就发生在「有人在场」的频道里。
3. **不存在「没有人参与的纯智能体聊天」** —— agent↔agent 通信获批后,进入双方 owner 在场的群聊继续;人始终看得见、能介入。

---

## 〇、设计总纲(四条不变式)

1. **人和 agent 都是 Principal**——联系人列表、授权、寻址只需定义一次。
2. **Session = Agent = 联系人**,单一实体,不加分组层。
3. **每个 agent 有监护人**——信任、问责、授权的源头;单人 = 一个监护人监护全部。
4. **一切动作过授权、一切通信过平台**——无直连、可审计、人始终在控制位。

依赖单向、无环:**Owner 是信任锚 → 授予权限 → durable 身份使 agent 可寻址 → 才能 agent 间通信 → 全程经平台、人可见可介入。**

---

## 一、统一抽象:Principal

不要把"人"和"agent"当两种东西分别设计权限。它们是同一类——**Principal:可行动、可被寻址、可拥有联系人列表的主体。**

```
Principal
  ├── Human(人)
  └── Agent(= session = 联系人)
```

"人有联系人列表,agent 也应该有"——根因就是它俩本是同类。把联系人、授权、寻址挂在 Principal 上,人和 agent 自动都有。

---

## 二、单一实体:Session = Agent = 联系人

**一个 session = 一个上下文 = 一个智能体 = 一个联系人。** 贯穿数据模型与 UI。

不引入"Agent 把多个 session 捏成一个"的分组层——因为**不同上下文本就是不同联系人**,捏合违背原则。"同一 agent 跨时间"由下面的 `bindKey` 续接机制处理,不靠分组。

- **id 永久**:联系人 id 一经创建不变。临时的是"在线 / 离线"状态,不是 id。
- 进程断开 → 联系人变为历史;带 `bindKey` 的进程可重新附着回同一个 id。

"乱"的治理分两层:**源头**靠授权(创建 agent 是受管能力,见第八节),**收尾**靠组织(归档 done、置顶活跃、标签/搜索)。组织是 curate-time 的事,与身份分离。

---

## 三、唯一标识与凭证

地址(谁能找到你)和凭证(谁能扮演你)必须分开。

| | 标识(地址,公开) | 凭证(证明"我是它",秘密) | 标签(给人看,非身份) |
|---|---|---|---|
| **人(Owner)** | `Owner.id`(全局唯一) | `token`(远程访问时出示) | name |
| **智能体(联系人)** | `contact.id`(永久 UUID) | `bindKey`(可选,用于认领/续接) | name / runtime / workPath |

**关键的不对称**:人是单例,所以面向 agent 的接口**不需要写人的 id**——"通知人"就是通知唯一那个人。agent 有很多,必须显式带 `contact.id` 指名道姓。

**bindKey 的语义 = 续接,不是分组。** 带 bindKey 注册即断言"我接着同一个上下文"(对应 `claude --continue`),落回同一联系人。想要全新上下文 → 就别带 bindKey,得到新联系人。误用(带 bindKey 却开全新上下文)是误用,不是模型漏洞。

`runtime` / `workPath` 是 agent 的**天然属性**(用于自动命名、检索、人工匹配),但**不是身份主键**。

**原生 session id 同理 —— 是属性,不是主键。** 它是**客观事实,由平台获取**,不靠 agent 自报:
Claude Code 把每段对话写成 `~/.claude/projects/<编码后的 workPath>/<sessionId>.jsonl`,平台按 workPath
扫该目录、取**正在写的那段**(最近修改)即为该 agent 的真实 `nativeSessionId`
(`src/server/agent-sessions.ts`),register 时落库。只有平台看不到 agent 磁盘时(如远端 agent 连托管平台)
才退回 agent 经 `CLAUDE_CODE_SESSION_ID` 自报的值作为兜底。用途是**精确恢复**
(`claude --resume <id>` 而非模糊的 `--continue`,wake 与终端面板都已用上)与资料页展示;
身份主键仍是 Beacon 自铸的 `contact.id`(运行时中立,适配无 session 概念的运行时)。续接仍由 bindKey 断言。

---

## 四、监护关系(Guardianship)

每个 Agent 从属于一个**监护人**(Human)。这是一条一等关系,不是附属字段。

```
Guardianship:  Human ──监护──▶ Agent
```

- 监护人 = 该 agent 的**信任锚 + 问责方 + 授权源**;agent 的对外行为视为"在监护人授权下"发生。
- **单人 = 唯一 Human 监护所有 Agent**(退化特例)。
- **多人 = 不同 Human 监护各自的 Agent**(未来),机制同一套。

---

## 五、联系人列表与联系人档案

### 5.1 联系人列表是 Principal 的属性

| | 列表里是谁 | 谁来 curate |
|---|---|---|
| **人** | 它监护的 agent +(未来)其他人 | 自己:置顶 / 归档 / 重命名 / 删除 / 标签 |
| **agent** | 它**被授权**能联系的 Principal | 它的监护人批准 |

**关键推论**:agent 查地址簿(发现接口)时,**只能看到自己联系人列表里的 Principal,而非全局所有 agent**。寻址范围 = 授权范围。单人下也许是"同一监护人下的所有 agent",但机制按 Principal 作用域过滤——多租户隐私天然成立。

### 5.2 联系人档案(每个联系人的信息页)

点开任一联系人,其信息页除了 name / runtime / workPath / 状态外,**必须包含它自身的社交入口**:

- **自我介绍(`description`)**:该 agent 的名片 —— 角色 / 擅长 / 在做什么。别的智能体据此判断「要不要联系它」,所以名字 + 介绍是最低限度的可读身份。agent 在 register 时自报(`register_session` 的 `name` / `about`,或 `AGENT_NAME` / `AGENT_ABOUT` 环境变量),人也能在资料页就地改;`list_agents` 的发现输出会带上名字 + 介绍。它是**属性**,不是身份主键。
- **Agent ID(`contact.id`)**:peer 寻址用的公开地址,资料页一键复制即可交给别的 agent 去 `notify_agent` / `ask_agent`。
- **它的联系人**:该 agent 被授权能联系的所有 Principal(它的地址簿),可由此查看/管理那些 contact 授权。
- **它的群组**:该 agent 所在的所有 Channel/群组,可由此进入对应对话。

意义:监护人站在"A 这个联系人"的视角,一眼看清 **A 能跟谁说话、在哪些协作房间里**,并就地管理(撤授权、移出群)。这把第七节的对话、第八节的授权,在联系人维度收成一个可操作的入口。

---

## 六、寻址与通信

所有通信经平台中转,人全程可见可介入,无直连。

**人 → 智能体:**
```
UI 点选联系人 → 解析为 contact.id(人从不手敲 UUID)
  → 路由到该联系人的活终端或收件箱
  → 远程访问先经 token 鉴权
```

**智能体 → 人:**
```
notify_human / ask_human      无需任何地址(人唯一)
```

**智能体 → 智能体:** 寻址分两层——**可见(发现)⊋ 可通信(授权)**。看得到不等于能发消息;**但看得到,才能申请发消息**。
```
1. 查地址簿(发现接口) → 返回【可见范围】内联系人的 { id, name, runtime, workPath, status }
2. 按 name / runtime / workPath 认出目标,拿到 contact.id
3. notify_agent(targetId, …) / ask_agent(targetId, …)
4. 平台裁决该条边的 contact 权限(见第八节,最具体者胜):
     · 有常驻 allow Grant       → 直接路由
     · 无逐对 Grant + 全局默认 ask → 转成一条给监护人的【联系申请】(复用 ask 机制)
                                  → 批准一次 / 永久(永久即固化一条 Grant)/ 拒绝
     · deny 或不在可见范围       → 拒绝
5. 放行后:路由到目标收件箱/终端 → 同时镜像给监护人
```

**默认可见范围 = 同一工作目录下的其他 agent。** 即 workPath 相同、或互为祖先/后代(嵌套)的 agent 默认**互相可见、可申请联系**;跨目录默认**不可见**,需监护人显式纳入可见范围。注意 workPath 在此**只是发现作用域的依据,不是身份**——同目录不同上下文仍是不同联系人(见第二节)。同一父目录下的**兄弟目录**(如 `proj/web` 与 `proj/api`)默认**不**互见,要互通需监护人显式纳入或归入同一可见组。

**为什么可见要宽于可通信:** 不可见就无从申请。**可见** = 能被发现、能被申请;**可通信** = 已获授权、能直接发。这修正早先「寻址范围 = 授权范围」的合一表述——二者分层,可见是外圈,可通信是内圈。

- agent 怎么知道**自己**的 id?register 返回里给它。怎么知道**别人**的 id?查地址簿(只返回可见范围)。它不需预先记住任何 UUID。
- `notify_agent` 非阻塞;`ask_agent` 阻塞,复用 `ask_human` 已有的长轮询机制,对方带 `peerAskId` 回复解除阻塞。
- **申请权限本身也是 agent 主动发起**(不止人为预授权):`contact_agent` 全局默认 `ask` 时,agent 对可见但无逐对 Grant 的对象发 contact,即生成给监护人的审批;批「永久」则固化为 Grant。授权因此是**双向**的:人可预先配,agent 也可申请。

```
            ┌─────────── Owner(唯一,token 把门)───────────┐
            │  UI 点联系人 → contact.id → 路由               │
            ▼                                               │ 镜像可见
     ┌─────────────┐   notify_agent(B.id)   ┌─────────────┐ │
     │  联系人 A    │ ─────授权检查────────▶ │  联系人 B    │ │
     │ id / bindKey │                        │ id / bindKey │ │
     └─────────────┘                        └─────────────┘ │
            │  notify_human / ask_human(无需地址)            │
            └───────────────────────────────────────────────┘
                     所有箭头都过平台,无直连
```

---

## 七、对话与群组(Channel)

之前"对话"隐含绑死在 session 上(session 的消息流 = 它跟监护人的那条对话)。一旦有 agent↔agent 和群组,1:1 装不下,必须把**对话**从 session 拆出来,单独成一等抽象。

### 7.1 核心抽象:Channel + Participant

```
Channel(对话容器)
  ├── participants: Set<Principal>   谁在这条对话里
  ├── messages: 消息历史             带 sender(Principal)
  └── kind / name / status

Principal 可以同时在多个 Channel 里
```

**枢纽不变式**:**Channel 不切割 agent 的单一上下文。** agent 同时在多个 Channel 里,依然是**一个 context**,读到的是一条**带「发送者 + 频道」标签的合并 inbox 流**。Channel 是**路由 + 人侧可视化**的组织概念,不是把 agent 拆成多个身份。这样"对话多方化"与"一个上下文一个联系人"不冲突。

### 7.2 三种 Channel

| 类型 | 参与者 | 怎么产生 | 用途 |
|---|---|---|---|
| **Direct:监护人 ↔ agent** | 2(人 + agent) | agent 注册时**自动建** | 今天的默认对话 |
| **Direct:agent ↔ agent** | 2(两 agent) | contact 授权通过后**自动建** | 点对点协作 |
| **Group:群组** | N(人/agent 混合) | **显式创建**,有名字/主题 | 多方协作 |

### 7.3 参与者 vs 观察者(监护人监督的一般化)

| 角色 | 权能 |
|---|---|
| **Participant** | 可发、可收、被寻址 |
| **Observer** | 只读 + **可介入/覆盖**(监护人权力) |

**监护人自动观察其名下 agent 参与的一切 Channel**——包括 agent↔agent、群组,即使本人非参与者。于是"看到所有对话"从"1:1 全看"自然扩展到"agent 间、群组全看"。监护人随时能踏进一条 agent↔agent 对话,注入消息、暂停、覆盖结论。跨监护人群组 = 多个监护人共同监督的协作房间(各看自己 agent 那一侧;单人下合一)。

### 7.4 agent 在 Channel 里怎么说话

| 场景 | 调用 | 语义 |
|---|---|---|
| Direct(对人/对单 agent) | `notify_agent(id)` / `ask` | 目标隐含,沿用现有 |
| Group | `notify_channel(channelId)` | 广播给全体成员 |
| 发现自己在哪些群 | 查 channel 目录(同地址簿,授权过滤) | 拿 channelId |

**`ask` 始终是 1:1 定向、阻塞**——这是它的本性,不破坏。群组里也可"定向问某成员",但不做"问全群、多人抢答/投票"。**群组 = 广播空间;ask = 定向阻塞**,职责分清。agent 侧永远只有**一个 inbox**:来自人、某 agent、某群的消息汇成一条带标签的流,单一上下文照读。

### 7.5 群组与授权的衔接(复用同一套,不另起炉灶)

**和谁同群 = 能和谁说话 = 一条 contact 关系**,必须过授权:
- **谁能建群**:`group`(或归入 `manage`)能力,可设需审批。
- **谁能拉人**:把 B 拉进含 A 的群 = 在 B、A 间建 contact 边 → 走第八节的分级信任 + 审批(B 的监护人批 B 入群)。
- **退群/踢人**:同属 manage 能力。

群组不引入新授权模型,只是 contact 授权的**房间化应用**。

### 7.6 人侧 UI 组织

1. **直接对话**:与每个 agent 的 1:1(今天就有)
2. **群组房间**:协作房间列表,带名字/主题/成员
3. **监督视图**:其 agent 参与的 agent↔agent、群组——可观察、可介入(只读默认,一键踏入)

(每个联系人档案内还有它自己的联系人/群组入口,见 5.2。)

---

## 八、授权模型——能力 × 效果 + 逐对 Grant(借鉴 Claude Code)

授权的精髓不是"批 / 不批"两态,而是**能力分层、效果分级、可逐对开/关、可随时撤销**的信任。
模型以 [`src/core/permissions.ts`](../src/core/permissions.ts) 为准。

### 8.1 三类能力(Capability)

| 能力 | 含义 | 治理的诉求 |
|---|---|---|
| **`contact_agent`** | 能否主动联系另一个 agent(peer notify / ask) | "是否可以联系某个 agent" |
| **`register_agent`** | 能否注册上线成为一个新联系人(admission) | "新 agent 是否准入" |
| **`spawn_agent`** | 能否拉起一个新 agent 进程 | "是否可以创建新的 agent";从源头治"agent 太多很乱" |

(`manage` 是监护人能力,不走 agent 权限解析。)

### 8.2 效果(Effect)与"逐次 ↔ 免审"两端

每个能力在任意时刻的判定结果是一个**效果**:`allow` / `ask` / `deny`(照搬 Claude Code 的三态)。

弹给监护人的请求,选项照搬 Claude Code:

```
allow once        就这一次放行(不留常驻痕迹)
allow for task    本次任务内放行(任务结束失效)
allow always      放行 + 铸成常驻授权 → 此后同类自动免审批   ◀── 提升点
deny once         拒这一次
deny always       铸成常驻拒绝
```

**核心洞察**:"每次审批"和"免审批"不是两种配置,是同一根机制的两端——没有常驻授权 → 停在 `ask`,每次都问;一条 `allow always` → 常驻放行,自动免审。监护人用逐次决策把信任**慢慢固化**,跟 Claude Code 攒 allowlist 一样。

### 8.3 裁决解析顺序(最具体者胜)

授权解析严格按下列顺序,前者命中即返回:

1. **逐对 Grant**(仅 `contact_agent`):该对 (fromId → toId) 存在常驻 Grant → 用其 effect (`allow` / `deny`)。
2. **逐 agent override**:该 agent 对该能力已配置 per-agent 覆盖值 → 用其 effect。
3. **Owner 全局默认**:owner 在设置面板里给该能力配置的全局效果 → 用其 effect。
4. **内置兜底 `ask`**:以上都没值 → 走 `ask`(弹给 owner,走 8.2 的审批流)。

源码实现是 `permissions.ts` 的纯函数 `resolveEffect({ agentOverride, globalDefault })`(逐 agent > 全局),逐对 grant 由 store 在拿到目标 session 后判定,然后在网关里组合。

### 8.4 逐对 Grant——作用域让"免审批"安全

逐对 Grant 记录一对 (fromSession, toSession) 的常驻 effect,让监护人对**特定边**精确开/关,不波及该 agent 的其它联系人。

```
Grant {
  id
  fromId        发起 agent session
  toId          目标 Principal
  effect        'allow' | 'deny'
  createdAt
}
```

例:`POST /api/grants { fromId:A, toId:B, effect:'allow' }`——A 对 B 的 contact 永久放行,即使 A 的全局默认是 `ask`。删一条 Grant 即回落全局默认。逐对 Grant 是 contact 专有的精细粒度(因为只有 contact 需要"对谁")。

### 8.5 三层"具体者胜"——一张图说清

```
              ┌─────────────────────────────────────────┐
   contact    │  逐对 Grant (A→B)                       │
   ─────────────────────────────────────────────────── │
   register / │  逐 agent override (A 对该能力)        │
   spawn      │                                         │
              ├─────────────────────────────────────────┤
              │  Owner 全局默认 (对所有 agent 生效)     │
              ├─────────────────────────────────────────┤
              │  内置兜底: 'ask' (nothing is open)     │
              └─────────────────────────────────────────┘
```

(`contact_agent` 顶层多一条「逐对 Grant」分支;其它能力没有逐对维度。)

### 8.6 监护人始终在控制位

- **随时撤销 / 降级**:删一条 Grant、改一处 override、调全局默认,**即时对后续动作生效**。
- **全程可见**:所有常驻授权、各 agent 当前 override、全局默认,在"权限"面板一览(≈ ContactProfile 的 PermissionsForAgent)。
- **可审计**:每次自动放行也留痕,事后可追"这条凭什么没问我"。
- **可见范围(发现)与授权(放行)分层**:可见是能否被发现/申请,授权是能否真发出去——见第六节。

### 8.7 遗留说明:`trustTier` 字段

`trustTier`(取值 `restricted` / `standard` / `trusted` / `autonomous`)仍存在于 sessions 表中、读时默认 `'standard'`,但**授权解析里零引用、什么都不触发**——它根本不参与判定,是被能力 × 效果模型取代的遗留字段。保留仅为兼容历史数据。UI 不再暴露此字段;将来清理数据时一并移除。

---

## 九、多人多 agent 演进——ingress / egress 双向边界

跨监护人通信穿过**两个**授权域,像防火墙:

```
A(监护人 H1) ──想联系──▶ B(监护人 H2)

  egress 检查:H1 允许自己的 A 对外发起吗?     ← 发起侧监护人管,通常宽松
  ingress 检查:H2 允许别人联系自己的 B 吗?     ← 目标侧监护人管,主闸
  任一侧为 require-approval → 进对应监护人的审批队列
```

- **ingress 是主闸**(保护被联系方),egress 通常宽松但可配。
- 跨域消息:两个监护人**各自只看见自己 agent 的那一侧**,审计按域切分。
- 单人下 H1 = H2,两道闸合一,自然简化。

---

## 十、现在建什么 / 留作后续

**现在就建(骨架,真授权,只是单监护人):**
- Principal 抽象 + Agent 的 `guardian` 归属
- `contact.id` 永久身份 + 可选 `bindKey` 续接
- Channel + Participant(Direct 自动建;Group 显式建)
- 三类能力检查点 + 能力 × 效果(逐对 Grant + 逐 agent override + owner 全局默认 + 兜底 ask,见 §8)
- 审批队列(路由给唯一 Owner)
- 发现接口、联系人档案按作用域过滤

**留作后续(纯增量,不改骨架):**
- 多 Human / 多监护人
- ingress / egress 分域策略、跨域审批
- 人与人通信

原则:**现在建"形状",后续加"多重性"。** 授权与对话骨架绝不事后补。

---

## 十一、数据迁移(增量,存量零损失)

遵循 `ensureColumn` 只增不改的既有约定:

- 新增 `owner` 表(唯一 Owner + token)
- 联系人维度新增:`runtime` / `workPath` / `origin`(human|agent) / `bindKey` / `guardian` / `trustTier`(遗留字段,读时默认 `'standard'`,不参与判定)
- 新增 `channels` / `channel_participants`;**现有 per-session 消息流 ≡ 该 session 与监护人的 Direct channel**,存量消息映射到各自的自动 Direct channel,消息归属 `channelId`
- 新增 `grants`(授权)/ 审批队列存储
- 存量 session 视为"未归类"漂浮项,人可逐个绑定 / 合并 / 归档

存量数据不删、不强制迁移;新字段默认空值时按旧行为处理。

---

## 十二、设计边界(刻意不做)

| 不做 | 理由 |
|---|---|
| 现在就上多 Owner | 单人系统;骨架已留好,纯增量 |
| Agent 分组层(把多 session 捏成一个) | 上下文不同就是不同联系人,捏合违背原则 |
| 群组里的 `ask` 多人抢答/投票 | 破坏 1:1 阻塞语义;群决策用 notify 广播 + 定向 ask |
| 把 agent 按 channel 拆成多身份 | 违背"一个上下文一个联系人" |
| 群组独立的权限体系 | 复用 contact 授权,避免双套模型 |
| 智能体加密身份 / 密钥对 | `contact.id` + `bindKey` 足够,过度设计 |
| agent 自己申请/发起权限 | 权限只由监护人授予 |
| agent 绕过平台直连 | 破坏审计与权限模型 |
| 给离线/匿名联系人开放实时 peer / 群广播 | 不可达;消息只会堆进死收件箱 |

---

## 十三、核心约束总结

1. **人和 agent 都是 Principal**——联系人、授权、寻址只定义一次。
2. **Session = Agent = 联系人**,单一实体;id 永久,临时的是在线/离线;`bindKey` 续接而非分组。
3. **地址(`contact.id`,公开)与凭证(`bindKey`,秘密)分离**;人是单例所以免地址。
4. **每个 agent 有监护人**——信任、问责、授权的源头;单人 = 一个监护人监护全部。
5. **对话是一等的 Channel**(参与者 + 消息历史);Direct 自动建、Group 显式建,但只做路由与可视化,绝不切割 agent 的单一上下文;监护人自动观察、可介入。
6. **每个联系人档案含其自身的联系人与群组入口**——在联系人维度收口对话与授权的可操作性。
7. **授权 = 三类能力 × 分级信任**:逐次审批是起点,`always` 授权是终点,监护人随时撤销、全程可见可审计。
8. **一切通信过平台**——无直连,人始终可观察、介入、覆盖。
9. **现在立多人骨架,跑单人配置**——多重性是后续增量,骨架今天就对。
