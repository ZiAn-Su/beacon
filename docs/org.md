# Beacon 公司 · 组织架构与运转机制 v1

> 我们造的是 agent-native IM。组织本身就是它第一个真实用户(dogfood):
> 组织 = 一组通过 Beacon 协作的 **agent 席位**。

本文件是机制的单一事实源。改机制先改这里。

## 原则

- **异步优先,无会议**:同步靠 Beacon 消息 + 状态,通讯录就是组织实时看板。
- **质量闸硬性**:不过闸不合并(见 Definition of Done)。
- **CEO 对成品负最终责任**:委托(含 `codex -p minimax`)产物必须自己复验,不信自述。
- **编制即权限表**:谁能拉起谁、谁能联系谁,由权限系统显式表达,chair 随时可收口。

## 架构(席位 = 联系人)

扁平,围绕 CEO 协调。专家席**按需拉起、不常驻空耗**;席位之间用 Beacon peer 消息直接协作,
不必都过 CEO。

| 席位 | 职责 | 形态 |
|---|---|---|
| **CEO**(我) | 战略 / 优先级 / 最终品味与质量闸 / 对接 chair | 常驻 |
| **Core 工程** | core·gateway·MCP·skill 语义 | 按需 spawn |
| **Web 工程** | 前端 React/Vite/Tailwind | 按需 spawn |
| **QA/验证** | typecheck·encoding·build·e2e·浏览器实测·回归 | 按需 spawn |
| **设计/产品** | 信息架构·交互·视觉规范 | 顾问席(按需) |
| **文档/发布** | CHANGELOG·README·release notes | 顾问席(按需) |

重活外包 `codex -p minimax`,产出归某个工程席复验后才算数。

## 运转机制(全程跑在 Beacon 上)

1. **立项** —— chair 用 `ask`/`notify` 提需求 → CEO 拆成 task。
2. **分派** —— CEO `spawn_agent` 在对应工作目录拉起专家席,注入 task(小任务 CEO 直接做)。
3. **协作** —— 席位间 peer 通信;要 chair 拍板 → `ask_human`;阶段切换 → `update_status`。
4. **质量闸(DoD)** —— 见下。
5. **验收** —— CEO 复验(不信自述)→ 过闸才 commit / 版本 / push。
6. **知会** —— 里程碑 `notify` chair;发布写 CHANGELOG。

一个任务 = 一个 session = 一个联系人。

## Definition of Done(硬性,缺一不可)

- `npm run typecheck` 通过(前后端)。
- `npm run check:encoding` 通过(UTF-8 无 BOM、src 内无 CJK,i18n.tsx 除外)。
- `cd web && npm run build` 通过。
- 涉及闭环语义:`npm run e2e` / `npm run sim` / curl 自测通过。
- UI 改动:浏览器实测(/browse)+ 一轮设计自审。
- 委托产物:CEO 亲自复验。

## 权限策略(dogfood v0.7.x 权限系统)

在 Beacon「设置 → 权限」配置;组织的"编制"就是这张表:

- **全局默认**:`register=ask`(新席位先准入)、`spawn=ask`、`contact=ask`。
- **CEO 单席覆盖** `spawn=allow` —— 只有 CEO 能自由拉起席位。
- **专家席**:同工作域 `contact=allow`(同项目内互通),跨域走按对授权;`spawn=deny`。

## 当前运行参数(v1,2026-06-21 chair 拍板)

- **自治程度:高** —— CEO 自行拆解 / 拉起 / 验收;仅重大方向决策与每次发布前 `ask` chair。
- **起步规模:CEO + 按需 1 席** —— 跑通一个真实任务的完整闭环后再扩编。
- **配套产品:先用现有能力** —— 权限 + notify/ask + spawn + peer 已够支撑;先跑机制、暴露真痛点,
  再决定是否做「群组 / 角色模板 / 权限预设包」(P2)。

## 分期

- **P0(本周)**:本文档 + 配好权限默认;跑一个真实任务端到端验证机制。
- **P1**:固化专家席 spawn 模板(名字 / about / 任务模板)。
- **P2**:把「组织视图 / 角色 / 权限预设包」做进产品 —— Beacon 团队协作卖点的自然延伸。
