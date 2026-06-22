# 发布制度

Beacon **已有真实用户在用**。发布要稳、可追溯、且尽量不打断线上。这份文档定义谁做什么、怎么做。

## 角色:大部分由团队(CEO/eng)承担,不需要监护人手动

| 环节 | 谁做 | 说明 |
|---|---|---|
| 写功能 / 修复 + 提交 | 团队 | 正常开发,提交到 `main`(或分支) |
| 写 CHANGELOG 条目 | 团队 | 每次发布前,在 `CHANGELOG.md` 顶部加 `## [新版本]` 一节 |
| 验证(typecheck / 编码 / web build) | 团队(`npm run release` 自动跑) | 不过不发 |
| bump 版本 + 打 tag + push | 团队(`npm run release`) | 版本读自 `package.json`,这步让平台显示的版本真正前进 |
| **部署到线上(重启)** | **唯一需要决策的一步** | 重启会短暂断开 WS / 长轮询,影响在用用户——所以是**刻意动作**,挑低峰、或由监护人点头/触发 |

**结论**:构建、版本、CHANGELOG、打 tag、推送——团队全包,监护人不必碰。唯一对线上用户有感的「重启部署」是刻意的一步(见下)。纯前端改动连重启都不需要。

## 版本规则(语义化)

- **MAJOR**:破坏「契约」——MCP/HTTP API、skill 命令、数据库结构的不兼容改动。
- **MINOR**:向后兼容的新功能。
- **PATCH**:修复。

## 开发循环(快,自动热更,零手动)

在开发 / 预发实例上:

```bash
npm run dev               # 后端:tsx watch,改 src/** 自动重启
cd web && npm run dev     # 前端:Vite HMR,改 web/src/** 即时生效(:5173)
```

两个都开着时,改代码即生效,无需手动 build / 重启。**注意:这是开发模式,不要直接当线上**——`tsx watch` 每次改动都重启,会打断真实用户。

## 切一个发布(团队执行,一条命令)

1. 在 `CHANGELOG.md` 顶部写好 `## [X.Y.Z] - 日期` 一节(没有这节,release 会拒绝)。
2. 跑:

```bash
npm run release minor     # 或 patch / major
```

`scripts/release.mjs` 会按顺序:校验 CHANGELOG 有该版本节 → 校验工作树干净 → typecheck + 编码 + web build → 写版本到两个 package.json → 提交 `release: vX.Y.Z` → 打 tag → push main + tag。任一步失败即中止。

## 部署到线上(刻意的一步)

平台前端托管的是 `web/dist`(不入库,在主机上构建);后端用 tsx 跑源码,**改了后端要重启进程**才生效。

- **纯前端改动**:在线上主机 `npm run build:web`(团队可代跑)→ 用户刷新即获得新前端,**无需重启后端、零中断**。
- **含后端改动**:在线上主机
  ```bash
  npm run update          # git pull + npm install + build:web
  ```
  然后**重启平台进程一次**(刻意挑低峰)。这一步会短暂断 WS / 长轮询。

### 想把「重启」也自动化、彻底不找监护人

线上用进程管理器跑(而非前台 `npm run platform`),团队即可自助重启:

```bash
# 一次性:用 pm2 托管(示例)
pm2 start "npm run platform" --name beacon
# 之后每次部署:
npm run update && pm2 restart beacon
```

是否引入 pm2 这类依赖,属方向性决定,由监护人拍板;在此之前,「重启」保持为刻意的人工/约定动作。

## 回滚

tag 即锚点:`git checkout vX.Y.Z` → `npm run update` → 重启。数据库迁移一律 additive(只增不改),所以回滚代码不会破坏已有数据。
