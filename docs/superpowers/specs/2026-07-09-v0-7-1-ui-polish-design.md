# V0.7.1 日用体验微调 — 设计文档

## Context

V0.7 固化指挥官协议（`ed3025e`）。三栏固定视口工作台、左 / 中 / 右轨已稳定。用户在交接文档中要求做"日用体验"微调：

1. 让页面更清晰、更克制、更适合每天使用。
2. 提升三栏信息层级，减少视觉噪音。
3. 优化 Ask 输入、回答区、历史区、机会池的阅读体验。
4. 确保固定视口和滚动体验稳定。
5. 保持 V0.7 指挥官协议的回答体验不被破坏。

**不要做**的事（来自交接文档）：
- 不要重写整个项目、引入新框架、改大架构。
- 不要新增 Dashboard、部署、数据库、登录、支付。
- 不要自动派发智能体。
- 不要恢复 Codex / Claude Code 任务按钮。
- 不要改 V0.7 Commander Protocol、Ask LLM prompt、搜索逻辑、脱敏核心逻辑、API 行为。

**修改范围**（来自交接文档）：
- `public/ask-ui/app.js`
- `public/ask-ui/styles.css`
- 必要时小幅动 `public/ask-ui/index.html`

本任务只做小修（C 类问题），不进入 OpenDesign 重做视觉系统。

---

## 1. UI 体检 — 当前 UI 最大的 3 个问题

### 最大问题 1：左栏今日机会池信息密度过高，进入首屏就被淹没

**症状**：
- `.opportunity-item` 包含 h3 标题 + 状态 badge + warning + meta 来源 / 类型 / 标签 / score chip / tags / note / next / 三个按钮（开工包 / 编辑 / 删除），单卡体积大。
- 默认（无 collapse）状态下，若机会池有 ≥3 条，左栏滚动占主要视觉，初打开页面左栏比中栏更显眼。
- 同一卡片 / 行存在 3-4 个不同颜色（accent / danger / muted-soft）和 4 类边框（line / line-soft / accent / accent-soft），视觉扫描成本高。

**根因**：V0.4 的 "机会池日用化" + V0.3.10 chips + V0.3.11 标签 / score / next / note / kickoff 逐层叠加，没人回头合并。

**建议最小修**：
- `.opportunity-item` padding 从 `12px` 收到 `10px`，score chip / tags chip 字号从 `11.5px` 收到 `11px`，gap 从 `12px 10px` 收到 `10px 8px`。
- `.opportunity-actions` 按钮字号统一 12px，颜色等级保持现在（生成开工包 = 半透墨绿 / 编辑 = 灰色 link / 删除 = 半透红虚线）但去掉 hover 时勉强变深的 box。
- 不动 V0.6 V0.7 已有逻辑、不动按钮顺序、不动 ID。

**不值得改**：保留全部字段（标题 / 状态 / 标签 / score / 备注 / 下一步 / 三个动作），合并会丢失 V0.4 "日用化" 的核心价值。

---

### 最大问题 2：composer 底部条带信息层级过满，"提问 / 发送 / 清空 / 本次联网 / 等待提问" 五件事并排

**症状**：
- composer-side 同一行放下：toggle 标签 + checkbox + 「本次联网搜索」文字 + 提问按钮（双层动效）+ 状态文字 + × 清空按钮同在 textarea 右侧。最大化下视觉宽度 20px+，但信息总量 ≥5 层级。
- 默认「本次联网搜索」无勾时与「等待提问」状态文字同时存在，初屏信息密度高。
- × 清空按钮只在有输入时出现，但 hover / focus 触发时整条 composer 都会感觉"在动"。

**建议最小修**：
- 状态文字 `#statusText` 字号收到 `12px`（V0.6.5 是 `12.5px`），状态行 opacity 在 idle 状态从 1 → 0.7；in-flight / 错误状态保持 1（保证错误可见）。
- composer-side `gap: 14px` → `gap: 12px`，节省水平像素。
- 不动按钮动效、不动 textarea / × 清空按钮结构、不动 webSearchToggle 默认 false。

**不值得改**：「本次联网搜索」的存在本身就是核心能力，不能移走。

---

### 最大问题 3：战略回答区空状态文案 + 初始边框已统一（V0.6.7），但 hero 区域仍偏"商业落地页"

**症状**：
- `.hero` 上方有 `eyebrow` ("Ask Mode · 个人战略总控入口") + `h1` (EricChan·战略OS) + `.subtitle` + `.status-line`，叠 4 行。
- eyebrow 用 12px 大写 + letter-spacing 0.12em，对日用而言偏"宣传"。
- 状态行 `本地运行 · 中文问答 · 不自动派发智能体 · 默认不联网` 与右下方 composer `本次联网搜索` 重复了"默认不联网"信号。

**建议最小修**：
- `.eyebrow` 不动（保留品牌识别），但 `.status-line` 默认 opacity 从 1 降到 0.85；hover / focus 提到 1。
- `.subtitle` 字号保持 `17px`，但 `color: var(--muted)` 收到 `--muted-soft` 略更轻，让 hero 整体退到背景，主体（战略回答）跳到前景。
- 不动 eyebrow / h1 / 状态行内容（这是用户写明的）。

**不值得改**：去掉 eyebrow / 状态行，会丢失"这是什么"的边界感，反而让日用感变弱。

---

### 不要改 / 不建议改

- `.answer strong / mark / h2` 淡橙 / 橙黄高光（V0.6.7 用户已确认，明确非黑，已交付）。
- `.answer.empty / .answer-loading` 360px min-height（V0.6.7 统一尺寸，已交付）。
- Ask Mode、推荐问题 ID、答案空态文案、提问按钮动效、机会池按钮动效、追问按钮、复制按钮、Goal idle / edit 分层（V0.6 + V0.6.5 交付）。
- loading-spinner 6 个 div 内部结构（"不要改 loading 动画"明确要求）。
- body overflow: hidden、.shell height calc、三个局部滚动区（fixed viewport 约束）。
- 默认不联网、sk-* 脱敏、Bocha / Tavily provider、Commander Protocol。

---

## 2. 最小修改方案

| 改动 | 文件 | 内容 | 影响 |
| --- | --- | --- | --- |
| W1 | public/ask-ui/styles.css | `.opportunity-item` padding/gap/字号微调 | 左栏密度 -15% |
| W2 | public/ask-ui/styles.css | composer-side / status-text 字号 / opacity 微调 | 底部条带更克制 |
| W3 | public/ask-ui/styles.css | `.hero` `.subtitle` / `.status-line` 颜色 / opacity 微调 | 顶部 hero 退到背景 |

**所有改动只动 CSS**，不动 JS / HTML / prompt / API / Commander Protocol / loading / 推荐问题 ID / 机会池按钮动效 / 复制逻辑。

---

## 3. 设计验证

### 测试

- `npm test` 必须全过（0 fail）。
- 新增 1-2 个最小必要测试覆盖：composer-status-text opacity 不被覆盖；hero subtitle / status-line 颜色 / opacity 已生效。

### 真实网页验证

- 启动 `npm run ask:ui`（或 `node scripts/start-ask-ui.js --port 5177`）。
- 桌面端（1280px 以上）：三栏可视；左栏密度降低；底部条带更克制；hero 退到背景。
- 小屏（≤900px）：单列堆叠；hero / 机会池 / 历史正常排版。
- 默认不联网（webSearchToggle 无 checked）。
- loading 不变（仍 6 个 div + 3D 盒子）。
- API Key 仍 `[redacted]`。

### 最终汇报

按交接文档 §10 格式：UI 体检结论 / 修改文件 / 页面变化 / 交互变化 / 测试结果 / 真实网页验证结果 / 是否建议 OpenDesign / 风险 / Git 状态。

---

## 4. 不该被这股需求顺手改的地方

- Commander Protocol 不能动（V0.7 交付。
- Ask LLM prompt（包括 V0.6.7 短回答约束）不能动。
- search-client / search-planner 不能动。
- secret-redact 不能动。
- .env / opportunity-pool.json / data/opportunities/backups 不能 commit。
- Codex / Claude Code 任务按钮不能恢复。
- loading 动画本体不动。
