# 版本管理与升级策略

> 目标:平台已经在用,既要**保证后续持续可用**,又要能**快速迭代升级**——两者不冲突,
> 关键是把「稳定的契约」和「会变的实现」分开。

## 一、什么是「稳定契约」(升级也不会变)

升级只改实现,不动这三层对外契约,所以**已接入的 agent 无需重新配置**:

1. **MCP 接入命令。** 推荐用托管式 HTTP 端点接入:
   ```
   claude mcp add --transport http -s user beacon http://127.0.0.1:4319/mcp
   ```
   这条命令里没有任何本地路径,只有平台 URL。无论平台代码怎么升级,只要 URL 不变,这条命令永远有效。
   (旧的 stdio 方式会绑定本地仓库路径,升级若移动了目录就要重配——所以现在默认推荐 HTTP。)
2. **REST / WebSocket API。** `/api/sessions/*`、`/api/asks/*`、`/ws` 的形状保持稳定。
3. **skill CLI 命令。** `node beacon.mjs register|notify|ask|status|inbox` 不变。

破坏以上任意一层,才需要升 MAJOR 版本号并在 `CHANGELOG.md` 显式说明。

## 二、数据如何跨升级保留

- 数据在 `data/beacon.db`(SQLite,WAL),**不随代码升级删除**,已被 `.gitignore` 忽略。
- 表结构演进**只增不改**:启动时 `store.ts` 用 `PRAGMA table_info` 检查并 `ALTER TABLE ADD COLUMN`
  补齐缺失列(见 `ensureColumn`)。旧库升级后数据完整、无需手工迁移。
- 想换库位置:设 `BEACON_DB` 环境变量。升级前想备份:直接拷贝 `data/` 目录即可。

## 三、版本可见

- `GET /api/health` 返回 `{ ok, version, ts }`。
- 接入面板(Connect)也返回 `version`。
- 由此可随时判断在用实例是不是最新。当前版本以 `package.json` 的 `version` 为唯一来源。

## 四、升级流程(在用中也安全)

```bash
# 1) (可选) 备份数据
cp -r data data.bak

# 2) 拉取 + 安装 + 构建前端 —— 一条命令
npm run update          # = git pull && npm install && npm run build:web

# 3) 重启网关
npm run platform
```

- 升级期间正在阻塞等待的 `ask` 会随重启中断;agent 端会在重连后重新轮询,人回答后即恢复。
- 想零感知升级,可在重启前先 `update_status idle` 或挑无 pending ask 的时机。

## 五、发布节奏

- 用语义化版本 + `CHANGELOG.md` 记录每次改了什么、是否影响契约、数据是否需要动作。
- 建议每个稳定点打 git tag(如 `v0.2.0`);需要回滚时 `git checkout v0.1.0 && npm run update`。
- 单人快速推进:小步提交,功能进 MINOR,修复进 PATCH,契约破坏才进 MAJOR 并提前在日志里预告。

## 六、检查清单(每次升级前)

- [ ] `npm run verify`(typecheck + 编码扫描 + 前端构建)通过
- [ ] `npm run e2e` 与 `npm run e2e:http` 通过(stdio 与 HTTP 两条 MCP 路)
- [ ] `CHANGELOG.md` 写明变更与兼容性
- [ ] 若动了表结构,确认是**增量** `ALTER TABLE`,旧库能原地升级
