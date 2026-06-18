# UI 重做规范 — Beacon「Codex-clean」美学

把现有 `web/` 界面重做成 **Codex 桌面应用** 那种观感:浅色为主、近单色中性、细边框胜过阴影、克制留白、
单一暖色强调(beacon 橙)、三栏(会话列表 / 对话 / 右侧信息面板)。沉稳、专业、为 agent 而生、简洁美观。
**不改任何功能/数据流/props/store 接线,只重做视觉与布局**,并新增右侧信息面板。改完 `web/` 里 `npm run build`
必须通过。只动 `web/` 下文件。文件一律 UTF-8 无 BOM。

## 总原则(对标 Codex 截图)

- 浅色为主主题(默认浅色);暗色保留并同样近单色。
- 近单色中性灰阶 + **唯一暖色强调** `--accent`(beacon 橙)。强调色只用于:品牌点、主操作按钮、`ask`(需要决策)的强调、`waiting` 状态。其余一律中性灰。
- **细 1px 边框** 为主,阴影极弱(卡片几乎不投影)。大量留白。
- 无霓虹、无高饱和、无炫光、无多余渐变(头像可用极淡纯色或极淡渐变)。
- 圆角适中(卡片 10–12px,胶囊 9999px),4px 间距尺度。字体 Inter + 系统回退,路径/ID 用等宽。

## 设计 token(替换 `web/src/index.css` 现有 token)

### 浅色(主)
```
--bg:            #FFFFFF
--bg-sidebar:    #F7F7F8
--surface-card:  #FFFFFF
--surface-hover: #F4F4F5
--surface-active:#EEEEF0
--border:        #ECECEE
--border-strong: #DEDEE1
--text:          #18181B
--text-secondary:#6B6B72
--text-muted:    #9B9BA2
--accent:        #EA580C
--accent-2:      #F97316
--accent-soft:   rgba(234,88,12,0.10)
--green:#16A34A; --amber:#D97706; --slate:#71717A; --muted-done:#A1A1AA; --danger:#DC2626;
--shadow-1: 0 1px 2px rgba(24,24,27,0.05);
--shadow-2: 0 4px 12px -4px rgba(24,24,27,0.10);
```
### 暗色(近单色)
```
--bg:#0E0E10; --bg-sidebar:#161617; --surface-card:#19191B; --surface-hover:#1F1F22;
--surface-active:#242427; --border:#2A2A2E; --border-strong:#34343A;
--text:#FAFAFA; --text-secondary:#A1A1AA; --text-muted:#71717A;
--accent:#F97316; --accent-2:#FB923C; --accent-soft:rgba(249,115,22,0.14);
--green:#22C55E; --amber:#F59E0B; --slate:#A1A1AA; --muted-done:#71717A; --danger:#EF4444;
```
状态色:working=green、waiting=accent、idle=slate、done=muted-done、registered=slate。

## 布局:三栏

```
┌───────────────┬──────────────────────────┬──────────────────┐
│ 会话列表(264)  │  对话                     │  信息面板(280)    │
│ --bg-sidebar  │  --bg                    │  --bg-sidebar    │
└───────────────┴──────────────────────────┴──────────────────┘
```
- 响应式:<1100px 隐藏右侧信息面板(对话头部一个「i」按钮可临时展开);<768px 单栏(列表→点击→对话,带返回)。
- 整页不滚动,只消息流滚动。

## 左栏:会话列表(`ContactList` / `ContactCard`)

- 头部:左「Beacon」字标(小,可带一个橙色信标点)+ 右「+ 接入」按钮(次要样式)。
- **扁平行**(不是重卡片):按状态分组,每组一个极小的大写灰标题:`WAITING` → `ACTIVE` → `DONE`。waiting 组在最上。
- 每行:左 28px 头像(极淡纯色或淡渐变,圆角方)+ 右上角小状态点;主标题=task(单行截断,中等字重);副行=runtime · workPath basename(muted,小)。行右:相对时间 + 未读数字徽章(有则显示,accent 色;有 pending ask 用 accent 实心)。
- 选中行:`--surface-active` 背景 + 左侧 2px accent 竖条;hover:`--surface-hover`。
- 空状态:居中,信标图标 + “还没有接入 agent” + 主按钮「接入一个 Agent」(打开接入面板)。

## 中栏:对话

### 头部(精简,去冗余)
- 一行:头像 + task 标题(强字重)。
- 第二行小 meta:runtime 等宽小胶囊、workPath(等宽 muted + 复制按钮)、单个状态指示(`● working` / `● waiting`…)。**去掉**现在“Waiting”+“Waiting for your reply”两个重复 pill,只留一个状态。
- 右侧:窄屏时一个「i」按钮切换右信息面板。

### 消息流
- 留白充足、按方向分组、新消息近底部时自动滚底。
- **notify(agent)**:安静的整行(非气泡)——小圆点/铃铛 + muted 文本 + 右侧浅时间;读起来像“环境信息”。
- **chat(agent)**:左对齐浅 `--surface-card` 气泡 + 细边框。
- **chat/answer(human)**:右对齐,`--accent-soft` 底 + accent 文字(不要重渐变实心)。
- **ask(agent)**:干净**卡片**(像 Codex 文件/diff 卡):白底、细边框、**左侧 2px accent 竖条**、顶部小 accent 标签「需要你决策」、问题正文、下面一排操作按钮(选项):第一个=accent 实心主按钮,其余=描边次按钮。未答保持 accent 强调;已答转安静“已解决”态(check + “你的回答:X”)。pending 卡右上角极小「关闭」(cancel)。
- 时间戳轻量(悬停/分组末尾),不每行都打。

### composer(精简)
- 圆角输入框,细边框,`--surface-card` 底,极弱阴影;发送按钮 accent 实心(禁用转灰)。Enter/Shift+Enter 提示含蓄(缩小或仅图标)。
- pending ask 时:输入框上方一条**紧凑** answering 条——只显示小标签「回答中」+ 选项小胶囊,**不再重复整段问题**。

## 右栏:信息面板(新增 `SessionInfo`)

仅在选中会话时显示,`--bg-sidebar` 背景,内容像 Codex「环境信息」:
- 顶部:头像 + task 标题(可换行)。
- `状态`:● + 文本。`运行时`:runtime(等宽小胶囊)。`工作路径`:完整 workPath(等宽换行)+ 复制按钮。
- `开始` / `更新`:相对时间。`能力`:`register · notify · ask · status · inbox`(muted)。
- 底部极淡说明:“该 agent 通过 Beacon 与你通信。”
- 细分隔线/小标题分区,留白充足,安静。

## 验收
- `web/` `npm run build` 通过;无 BOM、无乱码。
- 三栏成立;浅色为主、近单色 + 单一橙强调;ask 为干净卡片;右信息面板显示会话元信息;notify 安静。
- 暗色同样近单色协调。
- 观感对标 Codex:白净、克制、专业、简洁美观;现有交互不回归。
