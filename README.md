# EricChan Strategy OS

Stage 0.5 is a local daily strategy report generator for EricChan. It reads external AI trend signals, combines them with `context/context.md`, asks an OpenAI-compatible LLM for opportunity-aware analysis, and writes both Markdown and structured JSON.

It is not a generic AI news digest and not a legacy project optimizer. A useful report must identify monetizable new project opportunities, judge EricChan fit, define MVP validation paths, and use legacy projects only as learning material unless the user explicitly reactivates them.

## Stage 0.5 Goal

Prove this loop:

```text
external AI trends + EricChan project context
-> LLM analysis
-> daily strategy report
-> Markdown + JSON
-> future Obsidian archive and Dashboard
```

This stage does not include a full Dashboard, login, database, or multi-user system.

## Install

```bash
npm install
```

Node.js 18 or newer is required.

## Configure `.env`

Copy `.env.example` to `.env` and fill in your OpenAI-compatible API settings:

```powershell
Copy-Item .env.example .env
```

```bash
LLM_API_KEY=your_key_here
LLM_API_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

Use the base URL without `/chat/completions`; the script appends that path.
Do not commit `.env`.

## Run Mock Mode

Mock mode does not call a real LLM API and is the safest first run:

```bash
npm run report:mock
```

It still writes a complete Markdown and JSON report.

## Run Real API Mode

After `.env` is configured:

```bash
npm run report
```

If a source fails to fetch, the script records a warning and continues. If `LLM_API_KEY` is missing or the API call fails, the script falls back to mock analysis instead of crashing.

To confirm whether the run used the real API, open `data/reports/YYYY-MM-DD.json` and check:

- `"mode": "live"` means the LLM API returned a report.
- `"mode": "mock"` means mock analysis was used.
- `warnings` will say why fallback happened, such as `LLM_API_KEY not set`.

## V0.1.1 Real Report Quality Validation

V0.1.1 adds a lightweight quality gate for the generated JSON report:

```bash
npm run validate:report
```

By default it validates `data/reports/YYYY-MM-DD.json`. You can also validate a specific file:

```bash
node scripts/validate-report.js data/reports/2026-06-30.json
```

The validator checks that the report has trends, project impacts, opportunities, next actions, agent dispatch suggestions, Obsidian export data, project bindings, and the three required self-check flags:

- `qualityChecklist.boundToProjects`
- `qualityChecklist.hasExecutableAction`
- `qualityChecklist.avoidsGenericSummary`

The report also stores the result in `qualityValidation` and the Markdown self-review section prints a score such as `12/12`.

## V0.1.2 Strategic Quality Gate

V0.1.1 checked structure: the report had the right fields. That is necessary but not enough. A `12/12` structural score can still produce bad strategy if it recommends building too early, treats placeholders as trends, or lacks evidence.

V0.1.2 adds a strategic quality gate:

- Trends must carry `sourceIds`, `sourceUrls`, `evidence`, and `confidence`.
- Manual placeholders and unverified inputs go into `dataGaps`, not `trends`.
- Opportunities and recommended actions must include `stageFit`.
- The validator blocks premature `stageFit: "now"` recommendations for Dashboard, Vercel deployment, cloud deployment, real multi-agent execution, or push integrations unless an `explicitOverrideReason` is provided.
- `qualityChecklist` now includes `evidenceBacked`, `stageAppropriate`, `noPlaceholderAsTrend`, and `avoidsPrematureBuild`.

`stageFit` values:

- `now`: fits Stage 0.5 and can be done immediately.
- `later`: valuable direction, but not for the current stage.
- `not-yet`: information or dependency is missing.
- `blocked`: should not be done under current constraints.

`dataGaps` records source gaps such as manual placeholders, failed sources, unverified categories, or missing real data. It is the right place for China AI / OPC placeholders until they are validated.

## V0.1.4 Human Feedback Loop

V0.1.4 treats Stage 0.5 as graduated after live reports repeatedly pass quality gates. The next step is Stage 1A: automatic daily report plus human feedback loop.

Stage 0.5 graduation means:

- `mode` is `live`.
- `warnings` are empty or explainable.
- `npm run validate:report` passes.
- Trends cite evidence and do not include placeholders.
- Stage-fit prevents premature Dashboard, Vercel, deployment, push, or real multi-agent execution.
- Human review finds the report useful enough to guide next actions.

Stage 1A means:

- Keep producing daily strategic reports.
- Capture EricChan's feedback on accepted, watched, rejected, and completed suggestions.
- Feed recurring feedback into `context/context.md` and `prompts/analysis-prompt.md`.
- Prepare automation for daily generation, without building a Dashboard first.

Dashboard is intentionally deferred because the core risk is not visualization. The current risk is whether the system learns EricChan's real judgment. A Dashboard before feedback would make weak recommendations look polished.

Every report includes `humanFeedbackRequired: true`. Each opportunity and recommended action includes:

```json
"humanFeedback": {
  "decision": "pending",
  "reason": "",
  "followUp": ""
}
```

Allowed feedback decisions are `pending`, `accept`, `watch`, `reject`, and `done`.

Use `templates/daily-feedback-template.md` after reviewing a report. Fill accepted suggestions, watched suggestions, rejected suggestions, actual actions, useful parts, noise, context updates, and prompt updates. For now this is manual by design; automatic Obsidian writing comes later.

## V0.1.5 Stage 1A Daily Runner

Stage 1A is automatic daily report generation plus a manual feedback file. It is still not a Dashboard, deployment, Obsidian sync, push notification system, or real multi-agent executor.

Run the full daily loop:

```bash
npm run daily
```

The daily runner:

- Generates today's report with `npm run report` behavior.
- Runs the same quality validation used by `npm run validate:report`.
- Creates `feedback/YYYY-MM-DD.md` from `templates/daily-feedback-template.md`.
- Preserves an existing feedback file so human notes are never overwritten.
- Prints mode, warnings, quality score, report paths, JSON path, raw snapshot path, and feedback path.

If the API is configured and succeeds, the report JSON should show `"mode": "live"`. If the API is unavailable, the runner safely falls back to mock mode and prints the warning; treat that as a pipeline check, not a real strategic report.

Create only today's feedback file without regenerating the report:

```bash
npm run feedback:today
```

Daily human loop:

1. Open `reports/YYYY-MM-DD.md`.
2. Check `data/reports/YYYY-MM-DD.json` for `mode`, `warnings`, and `qualityValidation`.
3. Fill `feedback/YYYY-MM-DD.md` with accepted, watched, rejected, and completed suggestions.
4. Move recurring useful feedback into `context/context.md`.
5. Move recurring prompt failures into `prompts/analysis-prompt.md`.

Windows Task Scheduler can run `npm run daily` once per day. See `scripts/setup-schedule.md` for the manual setup command and troubleshooting notes. The project does not register scheduled tasks automatically.

Stage 1B Dashboard should wait until at least 7 daily runs produce useful feedback patterns, stable quality scores, no placeholder trends, stage-appropriate actions, and clear evidence that a visual review surface would reduce manual review friction.

## V0.1.6 Daily Review

V0.1.6 closes the first learning loop. After a daily report is generated and EricChan fills `feedback/YYYY-MM-DD.md`, the review script reads the report, JSON, and feedback, then produces a Daily Review with context and prompt update suggestions.

Recommended flow:

```bash
npm run daily
# Fill feedback/YYYY-MM-DD.md manually.
npm run review:today
```

You can review another date:

```bash
npm run review -- --date 2026-06-30
```

The review script is rule-based for now. It does not call an LLM, does not read `.env`, and does not modify `context/context.md` or `prompts/analysis-prompt.md`. It only writes review artifacts:

- `reviews/YYYY-MM-DD-review.md`
- `data/reviews/YYYY-MM-DD-review.json`

If a review already exists, the script refuses to overwrite it. Use `--force` only when you intentionally want to regenerate:

```bash
npm run review -- --date 2026-06-30 --force
```

Use the generated review as a manual decision aid:

- Move stable factual/project updates into `context/context.md`.
- Move recurring report behavior corrections into `prompts/analysis-prompt.md`.
- Keep rejected suggestions and noise as evidence for what the next report should avoid.

Dashboard is still deferred. The review loop tells us whether the system is learning EricChan's judgment; a Dashboard should only package a loop that already works.

## V0.1.7 Update Proposal

V0.1.7 turns a Daily Review into a human-reviewable update proposal. It reads `data/reviews/YYYY-MM-DD-review.json` and `reviews/YYYY-MM-DD-review.md`, extracts context suggestions, prompt suggestions, noise, rejected ideas, and next-report instructions, then writes:

- `proposals/YYYY-MM-DD-update-proposal.md`

Run today's proposal:

```bash
npm run propose:today
```

Run a specific date:

```bash
npm run propose -- --date 2026-06-30
```

If a proposal already exists, the script refuses to overwrite it. Use `--force` only when intentionally regenerating:

```bash
npm run propose -- --date 2026-06-30 --force
```

The proposal is deliberately not an automatic patch. Review suggestions can contain one-off mood, noisy wording, or overfit lessons from a single day. Human approval should decide:

- Which context updates are stable enough for `context/context.md`.
- Which prompt updates should become standing behavior.
- Which rejected or noisy signals should stay out of system memory.
- Whether to apply manually or ask Codex to apply approved changes.

Only after proposal approval should the project enter an apply phase.

## V0.1.8 Opportunity Discovery Redirect

V0.1.8 redirects Strategy OS from "which old project should be updated?" to "which new opportunity is worth validating?"

Strategy OS should not default to optimizing iPortfolio, XiaoChan, 节律 App, or other legacy projects. Those projects are learning material:

- iPortfolio teaches EricChan's personal expression, visual taste, content structure, and narrative ability.
- XiaoChan teaches EricChan's interest in AI Persona, identity consistency, memory, humor, and interaction.
- 节律 App teaches EricChan's preference for minimal, premium, restrained life-tool products.
- Historical records teach iteration style, verification standards, acceptance criteria, and tool workflow.

Every trend is now classified first:

- `new-project-opportunity`
- `current-project-improvement`
- `legacy-learning-material`
- `watch-only`
- `ignore`

Default priority:

`new-project-opportunity` > `current-project-improvement` > `legacy-learning-material` > `watch-only` > `ignore`

Every opportunity now carries opportunity fields and 1-5 scores:

- `monetizationPotential`
- `ericChanFit`
- `mvpSpeed`
- `aiLeverage`
- `opcFit`
- `contentAssetPotential`
- `longTermCompounding`
- `complexityRisk`
- `currentStageFit`

`complexityRisk` is a risk score. Higher means harder and riskier; it should not be added like a positive score. A high complexity opportunity cannot be `stageFit: "now"` unless there is an explicit override reason.

The validator now blocks default old-project optimization such as updating iPortfolio, rebuilding XiaoChan, deploying legacy projects, redesigning the personal website, or expanding 节律 App. Legacy trends can be archived as learning material, but they should not become `recommendedActions` unless the user explicitly reactivates that project or the trend reveals a real new monetizable opportunity.

The next structural step should be an Opportunity Pool, not legacy project updates.

## V0.1.9 Opportunity Pool

V0.1.9 adds a local Opportunity Pool. Daily reports can discover opportunities, but the pool is where good candidates become durable strategic assets that can be deduped, reviewed, watched, validated, or rejected.

This is the next step before any Dashboard because the important question is not how opportunities look on screen. The important question is whether EricChan can repeatedly collect, compare, and approve opportunities without losing human judgment.

Recommended flow:

```bash
npm run daily
npm run opportunities:update
npm run opportunities:validate
```

Useful commands:

```bash
npm run opportunities:update
npm run opportunities:update -- --date 2026-06-30
npm run opportunities:validate
npm run opportunities:list
```

The pool writes:

- `opportunities/opportunity-pool.md`
- `data/opportunities/opportunity-pool.json`

These files are ignored by Git because they are long-term user strategy assets. The repo keeps only `.gitkeep` files so the directories exist.

Only opportunities with `enterOpportunityPool: true` and `shouldIgnore: false` are imported. The updater also skips obvious legacy-project optimization ideas such as updating iPortfolio, rebuilding XiaoChan, deploying old projects, redesigning the personal website, or expanding 节律 App.

Each opportunity contains:

- identity: `id`, `createdAt`, `updatedAt`, `opportunityName`
- source: `sourceTrend`, `sourceReportDate`, `sourceReportDates`, `classification`, `evidence`, `sourceUrls`
- judgment: `whyItMatters`, `monetizationPotential`, `ericChanFit`, `scores`
- experiment path: `mvpForm`, `firstValidationAction`, `recommendedAgent`
- control flags: `enterOpportunityPool`, `needsHumanConfirmation`, `shouldIgnore`
- user fields: `status`, `humanDecision`, `tags`, `notes`

Status values:

- `inbox`: newly imported, not yet reviewed.
- `watch`: interesting but not ready for validation.
- `validate`: ready for market/user validation.
- `mvp-spec`: ready for a small MVP spec.
- `building`: actively being built.
- `archived`: kept for reference.
- `rejected`: explicitly rejected.

Human decision values:

- `pending`: not reviewed yet.
- `accepted`: approved as a real opportunity.
- `watching`: keep observing.
- `rejected`: not worth pursuing.
- `done`: completed or resolved.

Deduping uses a stable id built from normalized `opportunityName` and `sourceTrend`. If the same opportunity appears again, the updater merges evidence, source URLs, and report dates, but preserves `notes`, `humanDecision`, and `status`.

Validation checks that the pool schema is legal, ids are unique, scores have all nine dimensions, high `complexityRisk` items are not already `building`, ignored opportunities are not active, and legacy optimization ideas do not enter active states.

Use `opportunity-pool.md` for manual review. Move only human-approved opportunities toward `validate`, `mvp-spec`, or `building`.

## V0.1.10 Opportunity Review Package

V0.1.10 adds a manual screening package for the Opportunity Pool. It does not create MVP specs and does not change opportunity `status` or `humanDecision`. Its job is to put every pool item into a review-friendly Markdown file so EricChan can decide what should move to `validate`, stay in `watch`, or be rejected.

Run:

```bash
npm run opportunities:review
```

Run for a specific date or intentionally overwrite an existing package:

```bash
npm run opportunities:review -- --date 2026-06-30
npm run opportunities:review -- --force
```

The script reads:

- `data/opportunities/opportunity-pool.json`

It writes:

- `opportunities/reviews/YYYY-MM-DD-opportunity-review.md`

The generated review package is ignored by Git because it is a user judgment artifact.

Do not move directly from Opportunity Pool to MVP spec. First screen each opportunity:

- Move to `validate` only when it is a real new project opportunity or a clearly useful current new-project improvement, has credible monetization or trust-asset potential, fits EricChan, has a small first validation action, and has manageable complexity.
- Keep as `watch` when the idea is promising but evidence, timing, target customer, or EricChan fit is still unclear.
- Mark as `rejected` when it is old-project optimization, weak monetization, weak EricChan fit, too complex for the current stage, or lacks a concrete validation path.

After filling the Human Review section, manually update `opportunity-pool.md` / `opportunity-pool.json` or ask Codex to apply the approved status and human-decision changes.

## V0.1.11 Apply Opportunity Review

V0.1.11 turns the filled review package into a safe write-back step. It reads `opportunities/reviews/YYYY-MM-DD-opportunity-review.md`, parses the `Human Review` block for each opportunity, and writes approved decisions back into:

- `data/opportunities/opportunity-pool.json`
- `opportunities/opportunity-pool.md`

Run it after the review package has been filled:

```bash
npm run opportunities:apply-review
```

Or apply a specific date:

```bash
npm run opportunities:apply-review -- --date 2026-07-03
```

The script writes back only review-control fields:

- `status`
- `humanDecision`
- `reviewReason`
- `reviewNextAction`
- `reviewInternalSystemImprovement`
- `updatedAt`

It keeps existing `notes`, `evidence`, `sourceUrls`, and `sourceReportDates`. It never creates new opportunities and never rewrites the original review Markdown.

Safety rules:

- Invalid `Suggested status` or `Suggested humanDecision` fails the whole run.
- `status=validate` requires `humanDecision=accepted` or `watching`.
- `status=rejected` requires `humanDecision=rejected`.
- Internal system improvements cannot jump directly to `mvp-spec` or `building`.
- If a review block is still the template placeholder, that opportunity is left unchanged.
- If a review name does not match the pool, the script warns and skips it.

This still does not generate an MVP spec. The point of V0.1.11 is to safely move human judgment into the Opportunity Pool so the next step can be chosen deliberately.

After write-back, re-run:

```bash
npm run opportunities:validate
npm run opportunities:list
```

## V0.1.12 Single Opportunity Validation Pack

V0.1.12 adds a validate-stage package for one opportunity at a time. It still does not generate a full MVP spec. The job here is narrower: turn a `validate / accepted` opportunity into a concrete interview-and-scoring packet so EricChan can decide whether it deserves V0.2.

By default the script targets:

- `Independent AI opportunity brief MVP`

It reads:

- `data/opportunities/opportunity-pool.json`

It writes:

- `opportunities/validation/YYYY-MM-DD-independent-ai-opportunity-brief-validation.md`

Run it with the default target:

```bash
npm run opportunities:validation-pack
```

Run it for a specific date or target opportunity:

```bash
npm run opportunities:validation-pack -- --date 2026-07-03
npm run opportunities:validation-pack -- --opportunity "Independent AI opportunity brief MVP"
```

The script only considers opportunities that are both:

- `status=validate`
- `humanDecision=accepted`

Watch or rejected opportunities are skipped. The current internal watch item, `Opportunity scoring quality gate`, is intentionally not turned into a validation pack.

Use the pack in three steps:

1. Share the sample brief with a few target users.
2. Ask the interview questions and score the responses.
3. Compare the results against the pass/fail criteria before deciding whether to enter V0.2.

Validate should not jump directly to MVP spec because a plausible idea can still fail on user urgency, distribution, willingness to pay, or differentiation from generic AI news. The validation pack exists to catch that early, before we spend time writing a more detailed product plan.

## V0.2 Daily Use Mode

V0.2 redirects the project back to personal daily usefulness. The goal is not Dashboard, deployment, productization, or a complex startup incubation pipeline. The goal is a one-page Daily Command that EricChan can actually read each day and use to decide:

- What matters today.
- Which opportunity deserves attention.
- What to ignore.
- What lightweight action to take.
- Whether a new project should be opened yet.
- Which agent should be used, only when useful.

Recommended daily flow:

```bash
npm run daily
npm run opportunities:update
npm run command:today
```

You can also generate a command for a specific date or overwrite intentionally:

```bash
npm run command -- --date 2026-07-03
npm run command:today -- --force
```

Daily Command reads:

- `data/reports/YYYY-MM-DD.json`
- `data/opportunities/opportunity-pool.json`
- optional same-day feedback, review, and proposal files when they exist

Daily Command writes:

- `daily-command/YYYY-MM-DD.md`
- `data/daily-command/YYYY-MM-DD.json`

These files are ignored by Git because they are personal daily strategic outputs.

Daily Command and Opportunity Pool have different jobs:

- The report observes external trend signals.
- The Opportunity Pool stores durable candidate opportunities and human decisions.
- Daily Command turns today's report plus the pool into one practical instruction page.

Daily Command should stay small. It caps action suggestions at 3, marks `sourceMode` so mock fallback is visible, and keeps Dashboard, deployment, old-project edits, and premature commercialization out of today's action list.

## Daily Use

The recommended default is now a single command:

```bash
npm run today
```

`npm run today` is idempotent. If today's `daily-command/YYYY-MM-DD.md` already exists, the command keeps it, prints a preserved-file summary, and exits `0`.

That one entry point runs the personal daily chain in order:

- `npm run daily`
- `npm run opportunities:update`
- `npm run opportunities:validate`
- `npm run command:today`

After it finishes, open:

- `daily-command/YYYY-MM-DD.md`

The older step-by-step commands still work and are useful for debugging or partial reruns, but the normal path is `npm run today`.

If today's Daily Command already exists and you want to refresh it, run:

```bash
npm run today -- --force
```

Windows Task Scheduler should keep using the plain `npm run today` command. That way the scheduled run is a safe no-op when today's command already exists, and only manual reruns use `--force`.

## Ask Mode 主动问答模式

V0.3 把 Strategy OS 的默认使用方式从“等系统推送”调整为“EricChan 主动提问，系统基于当前状态回答”。定时日报仍然有用，但主入口应该更像一个提问窗口：你问今天该做什么、某个项目值不值得做、该交给哪个智能体，系统给出短判断。

运行方式：

```bash
npm run ask
npm run ask -- "今天适合做什么？"
npm run ask -- "我看到一个 ESP32 墨水屏日历项目，帮我体检一下。"
npm run ask -- "帮我生成这个项目的开工包：ESP32 墨水屏日历项目。"
```

无问题运行时会输出推荐问题。这些问题来自 `config/recommended-questions.json`，后续可以直接作为网页按钮文案：

- 今天适合做什么？
- 当前项目哪个最值得推进？
- 我现在该不该开新项目？
- 我看到一个好项目，帮我体检一下。
- 帮我生成项目开工包。
- 这件事该交给哪个智能体？
- 我是不是把事情搞复杂了？

Ask Mode 会读取：

- `context/context.md`
- `data/reports/YYYY-MM-DD.json`
- `data/opportunities/opportunity-pool.json`
- `daily-command/YYYY-MM-DD.md`
- 同日 feedback / review / proposal，如果存在

如果当天还没有 Daily Command，它会用中文提示先运行 `npm run today`。Ask Mode 不修改机会池、不修改 Daily Command、不调用真实智能体，也不读取 `.env`。

项目体检用于你看到一个好项目时的第一层判断。它会回答这个项目值不值得试、适不适合 EricChan、风险在哪里、最小可验证效果是什么，以及下一步应该进入机会池、继续观察、生成开工包还是忽略。

项目开工包不是 Codex 执行提示词。它默认交给 `GPT 5.5 Thinking` 做战略总控，先判断是否适合当前阶段、是否有内容资产或变现价值、是否进入机会池、是否需要 WorkBuddy 调研、OpenDesign / MiniMax 视觉探索，最后才判断是否需要 Codex 做工程 MVP。

用户可见内容默认中文。文件名、npm scripts、JSON key、技术名词、模型名和项目名可以保留英文，但 Markdown 标题、说明、按钮、提示语和总结应优先中文。

## 极简网页主界面

V0.3.1 增加一个本地网页入口，把 Ask Mode 变成提问窗口和推荐问题按钮。它不是 Dashboard，不展示复杂图表，不做项目管理，也不会真实派发 Codex / WorkBuddy / OpenDesign / MiniMax。

运行方式：

```bash
npm run ask:ui
```

启动后打开：

```text
http://localhost:5177
```

页面包含：

- 标题：EricChan·战略OS
- 副标题：主动提问，而不是被动推送
- 推荐问题按钮
- 输入框
- 提问按钮
- 状态提示
- Ask Mode 回答输出区

推荐问题按钮来自 `config/recommended-questions.json`。点击按钮会把问题发给本地 `POST /api/ask`，服务端复用 `scripts/ask-strategy-os.js` 的判断逻辑并返回中文回答。

如果回答失败，页面会提示：“回答生成失败，请检查终端日志或先运行 npm run today。” 如果当天数据不存在，Ask Mode 原有的中文提示会正常显示。

项目开工包仍然先交给 `GPT 5.5 Thinking` 做战略总控。网页不会把“生成开工包”直接变成 Codex 执行，也不会自动修改机会池、日报、Daily Command 或旧项目。

## V0.3.2 Ask UI 视觉与阅读体验精修

V0.3.2 不新增功能，只精修极简网页主界面的视觉、版式与阅读节奏。它不是 Dashboard，也不做项目管理看板。

调整方向：

- 暖白底、深墨绿低饱和强调、深灰正文，大留白、低噪声。
- 顶部标题、副标题、本地运行状态条更克制清晰。
- 推荐问题按钮支持选中态、hover、disabled；提问期间所有按钮统一禁用，避免重复提交。
- 输入框更大、留白更足、提示文案更清楚。
- 回答区支持更顺滑的中文 Markdown 阅读：`#` / `##` / `###` 标题、`-` 列表、`**加粗**`、`` `行内代码` ``、围栏代码块；输出前会保留显示用户提问，输出后自动滚动到回答位置。
- loading 文案统一为“正在生成战略判断……”。
- 错误提示使用中文，状态条会变成红色提示音。
- 底部新增一行说明，强调项目开工包会先交给 GPT 5.5 Thinking 总控，不会默认直接派发 Codex / WorkBuddy / OpenDesign / MiniMax。
- 窄屏（≤680px）输入区与按钮自动垂直堆叠，问答区字号与内边距同步收紧。

## Ask UI 使用习惯（V0.3.4 / V0.3.4-hotfix）

V0.3.4 调整了 Ask UI 的键盘与点击习惯；V0.3.4-hotfix 进一步加入中文化输出兜底、本地历史记录、复制按钮与轻量 loading 动画。

**顶部副标题**：

- “把想法压成判断，把判断变成下一步。” —— 取代旧的”主动提问，而不是被动推送”。

**键盘**：

- **Enter** 发送问题。
- **Shift + Enter** 在输入框里换行。
- 中文输入法 composition 期间按 Enter 不会误发送。
- 如果输入为空，按 Enter 会显示中文提示”请先输入一个问题。”，不会发送。
- Ctrl + Enter / Cmd + Enter 仍可作为向后兼容的发送方式，但不再是主快捷键。

**推荐问题按钮**：

- 点一下推荐问题按钮，只把该问题填入输入框，输入框获得焦点，按钮进入选中态。
- 不会自动发送。你可以继续改写、删减或追加内容，再按 Enter 或点”提问”发送。
- 自己改了输入内容后，按钮选中态会自动清除。

**提问框（Composer）**：

- 提问框固定在视口底部，**长回答滚动时仍可见**，适合连续追问。
- 页面底部留出 padding-bottom，最后一段回答不会被提问框盖住。
- 输入框支持自动增高，超过 max-height 后内部滚动。
- 移动端单列堆叠，提问按钮靠右。

**页面构图**：

- 桌面端主容器宽度扩展到 1180px，不再只占中间三分之一。
- 左侧：标题、状态条、推荐问题、最近提问、快捷键与说明（粘性边栏）。
- 右侧：战略回答区（最大宽度 70ch，更适合阅读）。
- 提问框横跨底部。

**输出中文化**：

- LLM 实际调用（`source=”llm”`）会先经过 `sanitizeLlmAnswer`（V0.3.3-hotfix-3）过滤 `think` / `Analysis:` / `We need to` 等内部推理。
- V0.3.4-hotfix 再追加一道 `translateInternalTerms`（脚本侧 + 前端兜底），把偶发泄漏的内部状态词转成中文：
  - `validate` → 待验证；`accepted` → 已确认；`watch` → 观察中；`watching` → 继续观察
  - `rejected` → 已拒绝；`local-fallback` → 本地兜底；`source` → 来源；`trigger` → 触发条件
  - `stageFit` → 阶段匹配；`building` → 构建中；`archived` → 已归档；`inbox` → 待处理；`ignore` → 忽略
  - `noNewOpportunitiesToday` → 今天没有新机会；`current-project-improvement` → 当前项目改进；`new-project-opportunity` → 新项目机会；`legacy-learning-material` → 旧项目学习材料
- 转换仅对**整词边界**生效，不破坏技术名词（GPT 5.5 Thinking、Codex、OpenDesign、MiniMax、WorkBuddy、API、MVP、OPC、LLM），不破坏围栏代码块与行内 code。

**复制回答**：

- 回答区域右上角有一个独立复制图标按钮（`#copyButton`，`aria-label=”复制回答”`）。
- 点击后复制当前回答的纯文本 Markdown，不复制 HTML。
- 成功后按钮短暂标记为”已复制”。
- 没有回答时按钮自动隐藏 / 禁用。

**最近提问（历史记录）**：

- 历史记录保存在 `localStorage` 的 `strategyOsAskHistory` 中，仅当前浏览器可见，不写入项目文件，不包含 API Key。
- 最多保留最近 20 条；同问题重复提问会更新到顶部而非叠加。
- 历史项展示问题（最多两行）、时间（当日 `HH:MM`）、状态徽标（动态回答 / 本地回答 / 已回退）。
- 点击历史项：填入问题、恢复回答、恢复来源与状态，**不**自动重新请求。
- 左下角有”清空”按钮，触发 `window.confirm(“确定清空最近提问记录吗？”)`。

**Loading 动画（V0.3.4-hotfix-3 严格复刻图二）**：

- 当前 loading 动画的目标已从”抽象适配版”调整为”**更接近图二的严格复刻版**”。
- 提问后显示一个深色卡片（约 `#1f1f1f`），上面一行中文”正在生成战略判断……”，下面居中放置完整 Uiverse 仓鼠跑轮（来自 Uiverse by Nawsome —— `wheel-and-hamster`）。
- 加载区是独立深色卡片背景，**不会扩散到整页**，loading 结束后整块隐藏、恢复正常回答区。
- 整体尺寸：10em × 10em（`font-size: 16px`，约 160 × 160 px）。
- 轮圈：浅灰（`#b8b8b8`）实线边框 + 暗灰中部 + 浅灰中轴点 —— 一眼先看到”滚轮”。
- 斜向辐条：可视的灰环 spoke。
- 仓鼠：身体横向占轮子内部更大比例，位置贴在轮子下半内沿，看起来像在”踩轮子跑”，不再掉到底边被裁切。
- 完整 class 名单 `wheel-and-hamster` → `wheel` / `hamster` / `hamster__body` / `hamster__head` / `hamster__ear` / `hamster__eye` / `hamster__nose` / `hamster__limb--{fr,fl,br,bl}` / `hamster__tail` / `spoke` 全部保留；完整 `@keyframes hamster` / `hamsterHead` / `hamsterEye` / `hamsterEar` / `hamsterBody` / `hamsterFRLimb` / `hamsterFLLimb` / `hamsterBRLimb` / `hamsterBLLimb` / `hamsterTail` / `spoke` 全部启用。
- 完成 / 出错 / 回退时动画隐藏。
- 用户设置 `prefers-reduced-motion: reduce` 时，所有动画停用，仓鼠和滚轮停留在静态首帧 —— 仍然像图二静态版（深色卡片 + 浅灰轮子 + 卡通仓鼠）。无障碍合规。

**Ask Mode 自适应回答（V0.3.4-hotfix-2）**：

- 不再机械套用”结论 / 理由 / 行动 / 今天不要做”四段式。
- 系统会**先判断问题类型**，再选择回答形式：
  - **决策型问题**：今天适合做什么、是否开新项目、项目优先级、是否过度复杂、智能体分工 —— 按需精简保留结构，但**不强求四项**。”今天不要做”只在用户明显做错事 / 资源紧张 / 风险出现时再写。
  - **自然回答型问题**：概念解释、界面使用、体验反馈、能力确认、闲聊式提问、为什么、比较工具、提示词请求、技术排查 —— 直接自然回答，**不必**强行使用结论 / 理由 / 行动 / 今天不要做。
  - 例：`现在这个系统能联网搜索吗？` → 一句自然答：”不能。当前基于本地上下文与 LLM 回答，不自动联网搜索。”
- 仍保留结构化输出：
  - **项目体检**（Project Checkup）：10 节骨架不动。
  - **项目开工包**（Kickoff Package）：10 节骨架不动。
  - **智能体分工建议**：保留清晰结构。
- 其余安全边栏继续保留：内部状态词中文化、`think` / `reasoning` 清洗、技术名词白名单、不暴露 API Key。
- prompt 与 fallback prompt 同步：两份 prompt 都包含”不是模板填空器、不要每次都固定输出四段式、请按问题类型选择回答形式”。

**联网能力说明**：

V0.3.5 已接入按需 Web Search，但默认仍然**不自动联网搜索**。只有你在 Ask UI 勾选“本次联网搜索”，或 CLI 使用 `--search`，系统才会把外部搜索结果作为补充上下文交给 Ask Mode。

- 搜索结果不是结论，最终仍由战略OS结合本地 context / Daily Command / Opportunity Pool 判断。
- 搜索失败时会 fallback，不影响本地问答。
- 搜索 API Key 只在 Node 后端读取，不会发送到浏览器。
- 历史记录只保存 `searchUsed` / `searchWarning` / `searchResultCount` / 来源摘要，不保存 API Key 或原始 provider response。
- 当前不是爬虫，不做浏览器自动化。

`如果某些模型仍持续输出 reasoning，建议更换模型或在请求参数里关闭 reasoning 输出。`

V0.3.1-hotfix 的双 loopback 监听（127.0.0.1 与 [::1]）继续保留，本机 IPv4 / IPv6 都能访问，不监听 0.0.0.0 / ::，不会暴露到局域网。

## LLM 动态问答模式

V0.3.3 在 Ask Mode 上引入可选的 LLM 动态回答能力。默认仍然使用本地规则回答，因此本机零配置即可使用。

默认行为：

- `STRATEGY_OS_LLM_ENABLED` 不设置或为 `false`：直接返回本地规则回答，`source="local"`。
- `STRATEGY_OS_LLM_ENABLED=true` 但 API Key / Model 缺失：视作未启用，依然返回本地规则回答。
- `STRATEGY_OS_LLM_ENABLED=true` 且 API 调用成功：返回 LLM 动态中文回答，`source="llm"`。
- `STRATEGY_OS_LLM_ENABLED=true` 但 API 失败或超时：自动回退本地规则回答，`source="local-fallback"`，并在状态区显示中文 warning：

  ```
  LLM 动态回答暂时不可用，已回退到本地规则回答。
  ```

配置方法（写入 `.env`，**不要提交 `.env`**）：

```bash
STRATEGY_OS_LLM_ENABLED=true
STRATEGY_OS_LLM_BASE_URL=https://api.openai.com/v1
STRATEGY_OS_LLM_API_KEY=你的密钥
STRATEGY_OS_LLM_MODEL=gpt-4o-mini
STRATEGY_OS_LLM_TIMEOUT_MS=30000
```

关键约束：

- API Key 只在 Node 后端读取，永远不会发送到浏览器，也不会出现在页面、日志或测试输出中。
- 后端日志会对错误信息中的 `sk-` 形式 Key 做替换，避免泄漏。
- Ask Mode 仍然不会真实调用 Codex / WorkBuddy / OpenDesign / MiniMax，也不会修改机会池 / Daily Command / 旧项目。
- 项目开工包在 LLM 回答中仍必须先交给 `GPT 5.5 Thinking` 总控，不会默认变成 Codex 执行提示词。
- `.env.example` 已给出全部新配置项与默认值 `STRATEGY_OS_LLM_ENABLED=false`。

命令行验证：

```bash
npm run ask -- "今天适合做什么？"
```

网页验证：

```bash
npm run ask:ui
```

打开 `http://localhost:5177`，查看状态条：

- `source="llm"` → 已使用动态战略回答。
- `source="local"` → 已使用本地规则回答。
- `source="local-fallback"` → LLM 动态回答暂时不可用，已回退到本地规则回答。

## LLM 连接诊断

V0.3.3-hotfix-2 把 Ask Mode 失败时的诊断信息做得更清楚，并新增独立诊断脚本：

```bash
npm run llm:check
```

脚本只读不写：它读取当前 `STRATEGY_OS_LLM_*` 配置（优先 shell，其次 `.env`），打印安全诊断信息，并发起一次最小 LLM 请求（"只回复：OK"）。整个过程不会修改任何项目数据。

诊断输出包含：

- `enabled`：`true` / `false`
- `apiKey`：已配置（内容已脱敏）/ 未配置
- `model`：已配置 / 未配置
- `baseUrl`：实际生效的 baseUrl
- `requestUrl`：最终请求 URL（baseUrl + `/chat/completions`）
- `timeoutMs`：超时时间

诊断结果会按状态分类：

- `success` → LLM 连接成功（响应：…）
- `disabled` → Ask Mode LLM 未启用
- `missing-key` / `missing-model` → 配置缺失
- `unauthorized` (401) → 请检查 API Key
- `forbidden` (403) → API Key 无权访问
- `not-found` (404) → 请检查 baseUrl 与模型名（错误信息会附带当前 baseUrl）
- `rate-limited` (429) → 请求被限流
- `server-error` (5xx) → LLM 服务暂时不可用
- `network` → 无法连接到 LLM 服务，请检查 baseUrl、代理或网络
- `timeout` → LLM 请求超时，请检查接口速度或代理
- `parse` / `empty` / `no-fetch` → 响应内容异常

`npm run llm:check` 与 `npm run ask` 走同一套错误分类逻辑，所以 `npm run ask:ui` 终端日志里看到的 `[ask-mode] LLM 调用失败（xxx）：…` 行就是 `npm run llm:check` 输出的同款分类。

baseUrl 兼容三种写法（系统会归一化）：

- `https://host/v1` → `https://host/v1/chat/completions`
- `https://host/v1/` → `https://host/v1/chat/completions`
- `https://host/v1/chat/completions` → 不会重复拼接成 `/chat/completions/chat/completions`

## V0.3.5 按需 Web Search

配置项：

```env
STRATEGY_OS_SEARCH_ENABLED=false
STRATEGY_OS_SEARCH_PROVIDER=tavily
STRATEGY_OS_SEARCH_API_KEY=
STRATEGY_OS_SEARCH_BASE_URL=
STRATEGY_OS_SEARCH_TIMEOUT_MS=15000
STRATEGY_OS_SEARCH_MAX_RESULTS=5
STRATEGY_OS_SEARCH_FRESHNESS=
```

当前支持的 provider：

- `tavily`：海外 Web Search provider。
- `bocha`：博查，国内 Web Search provider。

Bocha 配置示例：

```env
STRATEGY_OS_SEARCH_ENABLED=true
STRATEGY_OS_SEARCH_PROVIDER=bocha
STRATEGY_OS_SEARCH_API_KEY=你的 Bocha API Key
STRATEGY_OS_SEARCH_BASE_URL=https://api.bochaai.com/v1/web-search
STRATEGY_OS_SEARCH_MAX_RESULTS=5
STRATEGY_OS_SEARCH_FRESHNESS=
```

`STRATEGY_OS_SEARCH_FRESHNESS` 留空时由 Search Planner 根据问题类型决定；可选值包括 `oneDay` / `oneWeek` / `oneMonth` / `oneYear` / `noLimit`。

使用方式：

```bash
npm run ask -- --search "最近 Anthropic 有什么新闻？"
npm run ask:ui
```

网页里勾选“本次联网搜索”后，`POST /api/ask` 会传入 `useSearch=true`。返回内容会包含安全的 `search` 摘要：是否实际使用、搜索词、结果数量、warning、来源标题 / URL / 域名、搜索意图、实际搜索词、时间范围和过滤摘要。不会返回 API Key，也不会返回 provider 原始响应。

搜索失败时，页面会显示中文提示：“联网搜索暂时不可用，已使用本地上下文回答。” Ask Mode 仍会基于本地上下文继续回答。

## V0.3.8 搜索过程透明化与时效性控制

V0.3.8 继续保持默认不联网：只有勾选“本次联网搜索”或 CLI 使用 `--search` 时才触发搜索。

这版新增两个控制点：

- 搜索过程透明化：回答下方会显示一个轻量“搜索过程”折叠区，包含搜索意图、实际搜索词、时间范围、过滤了多少条无关财经结果、去重多少条、过滤多少条过旧结果，以及多少条结果缺少发布时间。
- 时效性控制：`news` / `ai-opportunity` / `technical-docs` 会优先较新结果。Bocha 的 `freshness` 不再固定为 `oneYear`，而是由 Search Planner 根据问题选择，例如“今天 / 这两天”优先 `oneWeek`，“最近新闻”优先 `oneMonth`，技术文档默认 `oneYear`。
- 过旧结果处理：有 `publishedAt` 且明显超出时效窗口的结果会被过滤；没有日期的结果不会直接删除，但会计入 `missingDateCount`。如果过滤后结果整体偏旧，页面会提示“搜索结果时效性较弱，请谨慎参考。”
- 历史记录只保存轻量搜索过程摘要：`intent`、最多 3 条 `plannedQueries`、`freshness`、`recency`、`filters`。不会保存 raw response、snippet、provider 原始 payload 或 API Key。
- 复制按钮仍只复制回答正文，不复制搜索过程、搜索词、来源或 raw JSON。

## V0.3.9 搜索质量评分与机会池网页化

V0.3.9 不改变默认不联网原则，也不把 Ask UI 做成复杂 Dashboard。它只补两个日用缺口：外部搜索结果是否值得信，以及当前机会池是否能在网页里直接看见和轻量维护。

搜索质量评分：

- 每条外部来源会在进入 LLM 前得到 `quality` 评分：`relevanceScore`、`freshnessScore`、`credibilityScore`、`overallScore`。
- `relevance` 关注是否贴近 AI Agent、大模型、AI 工具、独立开发者、产品机会、OPC / 个人 OS 等战略OS主线；宽泛趋势问题下会降低 A股 / 股票 / 行情类噪声。
- `freshness` 根据搜索意图判断：新闻更偏 30 天内，AI 机会更偏 90-180 天内，技术文档更偏当前版本；缺少发布时间不会直接归零，但会降低可信度。
- `credibility` 用轻量域名/来源启发式判断：官方站点、GitHub、研究机构、大厂博客、主流科技媒体更高；SEO 聚合、广告站、低质转载更低。
- Ask UI 只展示一句来源质量摘要，例如“来源质量：较高 / 一般 / 偏弱”，不会展示大表格，也不会保存 provider raw response 或 API Key。

机会池网页化：

- Ask UI 左侧新增“机会池”区域，读取 `data/opportunities/opportunity-pool.json`。
- 网页显示统计：全部、已确认、待验证、观察中、已归档。
- 机会状态对用户显示为中文，例如待处理、观察中、待验证、MVP 规格、构建中、已归档、已拒绝。
- 如果机会池为空，显示中文空态：“还没有可展示的机会。你可以先通过联网搜索或 Ask Mode 发现一个新机会。”

机会池轻量编辑：

- 网页内可编辑状态、备注、标签。
- 保存走本地 `PATCH /api/opportunities/:id`，只允许白名单字段，不允许从请求 body 控制文件路径，也不会暴露服务器路径。
- 归档 / 拒绝会先确认；保存成功后刷新机会池区域。
- 保存时保留未知字段和原有机会结构，只把原始字段写回机会池 JSON；中文展示 label 不会污染数据文件。

顶部状态与阅读层级：

- 未勾选搜索：显示“默认不联网”。
- 勾选但未提问：显示“本次将联网搜索”。
- 搜索中：显示“正在联网搜索”。
- 搜索成功：显示“已参考外部搜索结果”。
- 搜索失败 fallback：显示“联网搜索失败，已本地回答”。
- 回答正文仍是主内容；参考来源在回答后；搜索过程默认折叠；搜索质量只是一句辅助摘要；机会池作为侧边管理区。

## V0.3.10 机会池中文化、标签体系与一键收录

V0.3.10 不改后端搜索 provider / 不改 Ask Mode prompt / 不动 loading / 不动端口监听。它只做三件事：让机会池 UI 全中文、让标签变成可选 chips、让"问 Ask → 一键加入机会池"形成闭环，并且让用户编辑的备注 / 标签 / 状态会变成 AI 下一次回答的上下文。

### 机会池 UI 全中文化

- 状态 / 人类决策 / 类型 / 评分字段在 UI 上全部显示为中文，例如：
  - 状态：`待处理` / `观察中` / `待验证` / `MVP 规格` / `构建中` / `已归档` / `已拒绝`
  - 类型：`新项目机会` / `当前项目改进` / `旧项目学习材料` / `仅观察`
  - 评分字段：`变现潜力` / `个人匹配度` / `MVP 速度` / `AI 杠杆` / `OPC 匹配度` / `内容资产潜力` / `长期复利` / `复杂度风险` / `当前阶段匹配度`
- 底层 JSON 仍然保留英文枚举（`status: "validate"` 等），中文 label 只在 UI 渲染时映射；保存回盘时不会写中文 status / type。
- 缺字段时显示中文空态，例如"暂无备注"、"暂无下一步"；不显示 `null` / `undefined` / 英文内部字段。
- 标题不清（默认"未命名机会"）时显示弱提示："这个机会缺少清晰标题，建议补充名称。"但不会自动重写用户数据。

### 机会项展示更清楚

每个机会至少显示：

1. 机会名称（h3）
2. 中文状态徽标
3. 中文类型 + 人类决策（如"新项目机会 · 已确认"）
4. 来源（来自 Ask Mode / 来自搜索 / 手动添加 / 历史机会）
5. 更新时间
6. 评分 chips（仅显示非空字段）
7. 标签 chips
8. 备注 / 下一步（如有）
9. 编辑按钮

编辑表单新增"类型"下拉、"下一步"输入框、标签 chips 多选（点击切换）。

### 标签改为可选 chips

预设 15 个产品标签：

```
AI Agent / 大模型应用 / 独立开发者 / 小型可变现 / 内容产品 / 自动化工作流 /
编程工具 / 前端视觉 / 个人 OS / OPC / 需要调研 / 可快速验证 / 暂缓 / 高潜力 / 噪声较大
```

- 编辑表单提供 chips 点击切换；不需要手打逗号字符串。
- 已选标签高亮（深墨绿底 + 白字）。
- 用户已有的自定义标签（不在 15 个预设里）会被保留，并显示为虚线边 chip 区分。
- 标签保存为数组，存到 `opportunity-pool.json` 的 `tags` 字段。

### 备注、标签、状态进入 Ask Mode 上下文

- 新增 `buildOpportunityContextForPrompt(opportunities, { maxItems=10 })`，输出结构化中文摘要（不是 raw JSON）。
- 注入规则：
  - 默认最多 10 条；按优先级排序：已确认 > 待验证 > 观察中；带"高潜力" / "可快速验证"标签加分；最近更新加分。
  - 默认不注入 `archived` / `rejected` / `ignore`（除非显式 `includeArchived=true`）。
  - 缺失字段用中文空态（"暂无备注" / "暂无标签" / "暂无下一步"）而不是 null/undefined。
  - 输出不含 raw JSON 字段名（如 `"tags":` / `"scores":` / `humanDecision:`）。
- 每次 Ask 请求的 user prompt 都会带上当前机会池的中文摘要（`buildLlmUserPrompt` 内部使用）。
- 用户编辑机会的备注 / 标签 / 状态后，**下一次**提问会自动反映新内容（因为读盘每次都重读 `opportunity-pool.json`）。

### 一键加入机会池

回答区右上角新增"加入机会池"按钮（与复制按钮并排，但样式区分）。点击后展开一个轻量内联表单，字段包括：

- 机会名称（必填，预填入问题摘要前 60 字）
- 状态（默认 `待验证`）
- 类型（默认 `新项目机会`）
- 备注（默认填入问题 + 回答摘要 ≤ 300 字，可编辑）
- 标签（chips 多选）
- 来源（自动判断：`ask-mode` 或 `search`）
- 如果本次回答带 search sources，会显示"已带入 N 条参考来源（仅保存标题 / 链接 / 域名）"

如果回答内容含有 `开工包 / 项目体检 / 新项目 / 新机会 / 趋势 / 建议尝试 / 试试` 等关键词，按钮文案为"加入机会池"；否则更保守地写"从本次回答创建机会"。

### POST /api/opportunities 安全约束

- 只接受白名单字段：`title` / `status` / `type` / `tags` / `note` / `nextAction` / `humanDecision` / `source` / `sourceQuestion` / `sourceAnswerSummary` / `sourceUrls` / `scores`。
- `filePath` / `jsonPath` / `markdownPath` / `rootDir` 都不会被持久化（即使 body 注入也无效）。
- 任何 `apiKey` / `STRATEGY_OS_LLM_API_KEY` / `LLM_API_KEY` / `sk-` 形式的 Key 都不会被持久化。
- `rawAnswer` / `rawResponse` 不持久化；如需保留回答片段，只存 `sourceAnswerSummary`（≤ 600 字）。
- `sourceUrls` 截断到 5 条，每条只保留 `title` / `url` / `source`。
- `note` 截断到 3000 字。
- `title` 缺失时返回 400 + 中文错误："请填写机会名称。"
- 重复标题给出 `warning: "已存在同名机会，建议编辑已有条目而不是重复添加。"`

### 不动的部分

- 不修改 `scripts/search-client.js` / `scripts/search-planner.js` / `scripts/llm-client.js` / `prompts/ask-mode-system-prompt.md`。
- 不修改 Bocha / Tavily provider。
- 不修改 `scripts/start-ask-ui.js` 的双 loopback 监听（127.0.0.1 + ::1）。
- 不修改 loading 动画（V0.3.4-hotfix-3 深色卡片 + 仓鼠跑轮 / 后续切换的 3D 盒子任一版本都保留）。
- 默认不联网原则不变；"本次联网搜索"checkbox 仍默认关闭。

## V0.3.10-hotfix 修复机会池乱码、中文化、删除与一键加入

V0.3.10 提交后用户真实打开网页发现三个问题：
1. 机会池里历史数据是 mojibake（UTF-8 字节被错误编码写入）；
2. 旧英文 opportunityName 在 UI 上仍是英文，对用户意义不明；
3. 没有删除按钮，没法从机会池里移除无用机会。

V0.3.10-hotfix 不再动后端 search / LLM / loading / port，只补"机会池中文化 + 删除 + 数据写入防御"。

### 修复 1：mojibake 与编码

- 全部源文件确认是合法 UTF-8，无 `�` / `锟斤拷` / `����` 字面残留。
- 静态资源全部带 `charset=utf-8`：
  - `text/html; charset=utf-8`
  - `text/css; charset=utf-8`
  - `text/javascript; charset=utf-8`
  - `application/json; charset=utf-8`
- HTML `<meta charset="utf-8" />`。
- 新写入的 JSON 永远是合法 UTF-8（`fs.readFileSync(filePath, "utf8")` + `JSON.stringify`）。
- 读取 / 渲染时检测 mojibake（包含 U+FFFD / GBK 错读字节序列）并走中文兜底，不会把乱码直接输出到 UI 或 LLM prompt。

### 修复 2：旧机会中文化（displayTitle）

新增 `OPPORTUNITY_TITLE_OVERRIDES` 与 `getDisplayTitle(item)`：

- `Independent AI opportunity brief MVP` → `独立 AI 机会简报 MVP`
- `Opportunity scoring quality gate` → `机会评分质量门槛`

行为：

- **底层 JSON 保留原值**（不强制改名），用户随时可以编辑。
- UI / `buildOpportunityContextForPrompt` 输出都用 `displayTitle`（中文）。
- 任何乱码 / 未知英文标题都会给中文兜底（"机会标题损坏，请编辑补充" / "V0.3.10 测试机会（标题损坏，请编辑）" / "机会：xxx"）。
- PATCH `/api/opportunities/:id` 现在接受 `opportunityName` 字段，用户在网页编辑后保存中文名会立即进入下次 Ask Mode 上下文。

### 修复 3：删除机会

新增 `DELETE /api/opportunities/:id`：

- 中文 confirm 提示：`确定要删除这个机会吗？此操作会从机会池中移除它。`
- 删除前自动写本地备份到 `data/opportunities/backups/opportunity-pool-YYYY-MM-DD-HHMMSS.json`（被 `.gitignore` 包含，不提交）。
- 安全约束：
  - id 缺失 / 含 `..` / 含 `/` / 含 `\` / 含控制字符 → 400 中文错误。
  - id 不存在 → 404 中文错误。
  - 不接受 body / query 控制文件路径。
  - 不删除整个池，只删指定 id。
- 前端：每个机会项新增"删除"按钮（红色虚线边），confirm 取消时不调 API。
- 成功 → 立即刷新机会池区域 + 状态条显示"已删除。"。

### 修复 4：一键加入机会池真实 UI 链路

之前 V0.3.10 已经实现，但用户真实点击仍然不工作——根因是 V0.3.10 时部分数据 POST 走的是错误编码路径，存进去就是 mojibake。

V0.3.10-hotfix 验证：

- `<button id="addOpportunityButton">` 在 HTML 渲染，正常出现在回答区右上角。
- 回答存在时按钮 `hidden=false`、`disabled=false`。
- 回答清空时按钮 `hidden=true`。
- 点击 → `#addOpportunityContainer` 显示，`buildAddOpportunityFormMarkup` 注入表单。
- 表单预填：
  - 机会名称（来自问题前 60 字）
  - 状态默认 `待验证`
  - 类型默认 `新项目机会`
  - 备注默认 `问题 + 回答摘要`（≤ 300 字）
  - 标签 chips 多选
  - 来源标识（ask-mode / search）
  - 最多 5 条参考来源
- 提交 → `POST /api/opportunities` → `applyOpportunityPanel` 立即刷新。
- 重复标题给中文 warning（不静默）。
- title 缺失给中文错误。
- 不保存 raw answer / raw search response / API Key（白名单 + sanitize）。
- 刷新页面后新机会仍存在。
- 下一次 Ask Mode prompt 立刻包含新机会（`buildOpportunityContextForPrompt` 每次重新读 `opportunity-pool.json`）。

### 不动的部分（hotfix 继续保留）

- 不改后端 search / LLM / loading / 端口监听。
- 不引入数据库 / 账号系统。
- 不暴露 API Key。
- 不修改 `start-ask-ui.js` 的双 loopback 监听。
- 不修改 `opportunity-pool.json`（被 `.gitignore` 包含，hotfix 不会提交历史数据）。

## V0.3.11 智能机会收录与机会开工包

V0.3.10-hotfix 已把机会池变成可编辑的中文工具，但用户反馈两件事：

1. "加入机会池"只是把用户问题当机会名 + 整段回答当备注，**不是机会卡**。
2. 开工包应该能从机会池里直接生成，**而不是让用户重新描述**。

V0.3.11 仍然只动机会池和 Ask UI 的相关路径，不动后端 search / LLM / loading / 端口。

### 功能 1：智能机会卡草稿（deriveOpportunityDraftFromAnswer）

新增 `deriveOpportunityDraftFromAnswer({ question, answer, search })`，纯规则型摘要（不调用 LLM）：

- **opportunityName**：从 answer 抽"做/做一个 X"的核心短语（≤ 24 字），不会直接拿 question 当机会名。
- **oneLineSummary**：从 answer 提炼一句话中文（≤ 80 字），明确"这个机会是什么"。
- **note**：从 answer 拆 2-4 个关键短句（每句 ≤ 60 字），用换行分隔；总长 ≤ 300 字。**不会复制整段 answer**。
- **nextAction**：从 answer 找"做 X / MVP 步骤"等可执行动词开头的句子（≤ 500 字）。
- **suggestedTags**：从 `PRESET_TAGS` 推断（基于关键词，如"agent / 大模型 / 独立开发者 / 可快速验证"等）。
- **sourceUrls**：自动截到 5 条，只保留 `title / url / source`。
- **信息不足兜底**：当 question/answer 不像"机会"上下文（如问天气），返回 `opportunityName = "没有识别到明确机会，请手动补充名称。"` 并附中文 nextAction 引导。
- **脱敏**：所有进入 draft 的字段先过 `sk-xxx / API_KEY` 脱敏，绝不把 API Key 串写入机会池。

### 功能 2：表单新结构

`buildAddOpportunityFormMarkup` 现在预填精炼字段：

- 机会名称
- **一句话说明**（oneLineSummary）
- 状态 / 类型
- 备注（精炼版）
- **下一步**（nextAction，可执行动作）
- 标签 chips（已自动勾选 suggestedTags）
- 来源问题（只读）
- 来源列表（最多 5 条，默认折叠）

提交时 POST body 一次性发送：
```json
{
  "title": "...",
  "oneLineSummary": "...",
  "note": "...",
  "nextAction": "...",
  "tags": [...],
  "status": "...",
  "type": "...",
  "source": "ask-mode",
  "sourceQuestion": "...",
  "sourceAnswerSummary": "...",
  "sourceUrls": [...]
}
```

服务端 `addOpportunity` 白名单新增 `oneLineSummary`，`oneLineSummary` 超过 300 字自动截断，`nextAction` 超过 500 字自动截断。

### 功能 3：机会开工包（POST /api/opportunities/:id/kickoff）

每个机会项新增"生成开工包"按钮（墨绿实心边，视觉上比删除更正向）。

点击后：

1. 不要求用户重新输入问题。
2. 调 `POST /api/opportunities/:id/kickoff`。
3. 回答区显示开工包（10 小节结构：项目一句话 / 为什么值得做 / 目标用户 / 最小 MVP / 第一版功能边界 / 不要做什么 / 推荐执行工具 / 第一轮验证路径 / 风险与卡点 / 下一步提示词草稿）。
4. 复制按钮可复制开工包正文。
5. 自动进入历史记录（`type: "kickoff-package"`），点击历史可恢复，不重新请求。
6. questionEcho 显示"为「机会名」生成开工包"。

服务端 `generateKickoffPackageForOpportunity` 行为：

- 数据稀疏时（oneLineSummary / note / nextAction / tags 全空）回退到"保守版开工包"，返回中文 warning `当前机会信息不足，以下是保守版开工包，建议先补充备注或标签。`
- 数据完整时优先调 LLM client（无 LLM 配置则回退到本地规则模板）。
- 严格中文输出；不调用 Codex / WorkBuddy / MiniMax；不主动开启联网搜索。
- 防御：所有进入 prompt 的字段先脱敏 `sk-xxx / API_KEY`。
- 失败时返回中文 error；id 不存在 → 404；id 含路径分隔符 → 400。

### 功能 4：上下文同步

`buildOpportunityContextForPrompt` 注入新字段：

- `一句话：...`
- `下一步：...`
- 缺字段时给中文兜底"暂无一句话说明" / "暂无下一步"，不出现 `null / undefined`。
- 下一轮 Ask Mode 提问时（如"今天适合做什么？"）会自动带上 oneLineSummary + nextAction。
- 不出现 raw JSON / 英文内部枚举 / API Key。

### 不动的部分

- 不修改后端 search / LLM / loading / 端口监听。
- 不引入数据库 / 账号系统。
- 不暴露 API Key。
- 不修改 `start-ask-ui.js` 的双 loopback 监听。
- 不保存 raw answer 全文 / raw search response。
- 开工包生成**不**真实调用 Codex / WorkBuddy / OpenDesign / MiniMax；只做"虚拟开工包"。

## V0.3.11-hotfix 修复机会提炼与开工包生成质量

V0.3.11 提交后用户真实使用时反馈两个核心问题：

1. "一键加入机会池"时，`opportunityName` 经常还是用户的原问题（如「最近有什么适合独立开发者做的小型 AI 项目？」），不是从回答中提炼出的项目机会名。
2. 生成开工包时，多个小节只输出"信息不足，建议补充 X"，用户需要逐项罗列，体验差。

V0.3.11-hotfix 仍只动机会池与 Ask UI，不改后端 search / LLM / loading / 端口。

### 修复 1：机会名称 = 回答中提炼的项目，不是原问题

重写 `deriveOpportunityDraftFromAnswer`：

- **机会名称优先从 answer 抽产品名**：使用 `PRODUCT_NAME_SUFFIXES`（助手/工具/平台/雷达/简报/看板/生成器/工作流/日历/模板/系统/OS/插件/agent/Agent/bot/Bot/MVP/选题器/分析器/检查器/体检器 等 30+ 后缀）。
- **剥离无意义前缀**：`NAME_PREFIXES_TO_STRIP` 列表覆盖「我建议你 / 适合做 / 可以先 / 面向 / 一个 / 最近 / 帮我 / 请你」等 30+ 前缀。
- **智能压缩**：超过 24 字时优先保留含后缀的"X 助手 / X 工具"短语，**避免简单截断**。
- **疑问句检测**：`isQuestionishQuestion()` 识别"最近有什么 / 怎么 / 为什么 / 帮我 / 给我推荐"等模式，从 question 抽取名字时只对非疑问句生效。
- **机会信号检测**：`OPPORTUNITY_QUESTION_HINTS` 要求 question/answer 含"做 / 想 / 试试 / 值得 / MVP / 工具 / 助手 / 选题 ..."等信号，否则视为"非机会"。
- **移除孤悬形容词**：开头"超级 / 无敌 / 最强 / 完美 / 关键 / 基础"等修饰词被剥离。
- **无法识别时返回空 + `draftWarning`**：当 opportunityName 为空时附中文提示「没有识别到明确机会，请补充机会名称。」

### 修复 2：前端二次保护

`buildAddOpportunityFormMarkup` 在前端做兜底：

- `titleMatchesQuestion(title, q)` 检测去标点后是否包含 / 被包含
- `hasUselessPrefix(title)` 检测以「我建议你 / 适合做 / 可以先 / 面向 / 最近 / 帮我」开头
- 任一命中 → `protectedName = ""` + `formWarning` 提示用户
- `formWarning` 用 `data-op-add-warning` 节点 + 红色左边框样式

### 修复 3：开工包不再"逃避生成"

新增 `inferKickoffFields({ name, oneLine, note, next, tags })`，基于机会名/标签推断：

- **目标用户**：根据 name 关键词（短视频/选题 → 短视频创作者 / 个人 IP；编程/工具 → 独立开发者；大模型/LLM → AI 开发者等）推断。
- **最小 MVP**：基于 name + next 推断"输入 → 输出"最小流程。
- **第一版功能边界**：基于 tags 圈定核心功能。
- **风险与卡点**：5+ 条独立开发者常见风险模板 + 基于 name/oneLine/tags 拼接额外风险：
  - 需求过宽 → 泛工具
  - 数据来源 / 搜索质量不稳定
  - 用户是否愿意付费 / 二次使用未知
  - MVP 容易演变成"内容生成玩具"
  - AI 输出不稳定 → 准备"用户反馈兜底 / 退化为模板"
  - 内容质量主观性强
  - 开发工具迁移成本高

即使信息完全为空，`buildSparseKickoff` 也会生成完整 10 小节（每节都有具体"暂定 / 推断"内容）。

### 修复 4：LLM prompt 强化

`buildKickoffUserPrompt` 新增"硬约束 V0.3.11-hotfix"段：

- 不要用「信息不足」替代生成
- 每个小节必须给出具体内容，可以标注"暂定 / 推断 / 保守判断"
- 风险与卡点必须主动生成 ≥ 3 条具体风险
- 目标用户 / MVP / 边界即使信息不足也要做"暂定推断"

`readKickoffSystemPrompt` 也同步更新硬约束。

### 真实验证

用户输入 `最近有什么适合独立开发者做的小型 AI 项目？` + 包含「我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合」的 answer：

- 机会名称：`AI 短视频选题助手`（不是原问题）
- 一句话说明：`AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合，做一个把热点转成可拍选题的工具。`
- 下一步：`用提示词和简单网页跑通`（可执行动词开头）
- 标签：`["独立开发者","内容产品","可快速验证"]`
- 开工包：10 小节齐全，5 条具体风险，仅 1 处"信息不足"且后跟具体"建议补充 X"

### 不动的部分

- 不修改后端 search / LLM / loading / 端口监听。
- 不引入数据库 / 账号系统。
- 不暴露 API Key。
- 不保存 raw answer / raw search response / API Key。
- 开工包生成**不**真实调用 Codex / WorkBuddy / OpenDesign / MiniMax。

## V0.3.11-hotfix-2 修复加入机会池按钮状态与加载卡片留白

V0.3.11-hotfix 上线后用户真实使用反馈两个体验问题：

1. 普通 Ask / 联网搜索回答后，**"加入机会池"按钮又变成不能点击的状态**（可见但 disabled）。
2. 搜索 loading 所在的**白色框太小**，loading 标识显得很挤，等待状态体验差。

V0.3.11-hotfix-2 仍只动 Ask UI 前端与样式，不改后端 search / LLM / API 配置 / 端口。

### 修复 1：加入机会池按钮状态统一

新增 `syncOpportunityActionState()` 单一入口函数，根据当前 UI 状态统一决定按钮：

```js
hasAnswer = state.currentAnswer.trim() !== ""
isLoading = state.inFlight === true
isKickoff = state.currentAnswerType === "kickoff-package"

if (hasAnswer && !isLoading && !isKickoff) {
  // 显示 + 可点
} else {
  // 隐藏（不是 disabled 灰按钮）
}
```

`state.currentAnswerType` 是 V0.3.11-hotfix-2 新增字段，用于记录当前显示的回答是 `ask` 还是 `kickoff-package`：

- 普通 Ask → `ask`
- 联网搜索 → `ask`（即使 `source=llm` / `search.used=true`）
- 搜索失败 fallback 但有本地 answer → `ask`
- 生成开工包 → `kickoff-package`（避免从开工包递归创建机会）

`setCurrentAnswer` / `setInFlight` / `restoreHistoryItem` / `generateKickoffForOpportunity` 末尾都统一调用 `syncOpportunityActionState()`，杜绝多个分支互相覆盖。

### 修复 2：提炼失败不禁用主按钮

`draftWarning` 仍走 V0.3.11-hotfix 的二次保护流程：

- 主按钮**仍然可点**（不为空回答就一定可点）
- 点击后表单打开
- 表单内 `data-op-add-warning` 显示「没有识别到明确机会，请补充机会名称。」
- 提交时若 title 空，POST 返回中文错误「请填写机会名称。」

### 修复 3：loading 白色框放大

只调整外层容器，**不动 loading 动画本体**：

- `.answer-loading` `min-height` 96px → **220px**
- `.answer-loading` `padding` 16/22/18px → **36px 32px**
- `.loading-inner` `gap` 8px → **18px**（文字与图形之间更舒展）

保留：

- `@keyframes loading-spinner` 不动
- 6 个 `<div></div>` 内部结构不动
- `animation: loading-spinner 1.6s infinite ease` 不动
- `.loading-spinner` 选择器 + `nth-of-type(1..6)` 不动

### 真实验证

- 普通 Ask 完成后：`addOpportunityButton.hidden=false disabled=false` ✅
- 联网搜索（`search.used=true`）完成后：按钮仍可点 ✅
- 搜索失败 fallback 但有本地 answer：按钮仍可点 ✅
- draftWarning（weather 类）：主按钮可点 + 表单内显示 warning ✅
- 历史恢复普通 answer：按钮可点 ✅
- 历史恢复 `kickoff-package`：按钮隐藏（不是 disabled 灰按钮） ✅
- 加载框：白色框明显变大（220px min-height + 36px/32px padding），loading 标识不再贴边 ✅

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）。
- 不恢复仓鼠跑轮动画。
- 不默认自动联网 / 不默认勾选"本次联网搜索"。
- 不删除 Bocha / Tavily provider。
- 不改 LLM API 配置逻辑。
- 不暴露 API Key / 不提交 .env。
- 不提交 `data/opportunities/*.json` 或测试机会数据。

## V0.3.11-hotfix-3 优化机会草稿与输入体验

V0.3.11-hotfix-2 完成后用户真实使用反馈 6 个体验问题。本次仍只动 Ask UI 前端 + 后端草稿 API，不改后端 search / LLM API 配置 / 端口。

### 修复 1：机会池按钮精简

按钮只显示 `+` 大加号，aria-label 仍是"加入机会池"（满足无障碍）。删除 `app.js` 里的 `.replace("加入机会池", labelText)` 长文案拼接逻辑。`add-opportunity-icon` 字号 `14px → 18px`；按钮 `padding: 5px 12px 5px 10px → 4px 9px`，`min-width/height: 32px` 保持可点击区域。

### 修复 2：战略回答下方小字合并为单行

- `renderSearchProcess` 改为单行 `<span class="search-process-summary">搜索过程 · 意图 · 搜索词 · 时间范围</span>` + 折叠的 `<details>` 内含完整列表
- `renderSearchSources` 头/摘要合并为单行 `<span>`，`<ul>` 移到 `<details>` 内
- CSS `@media (min-width: 900px)` 把两个容器在桌面端 flex 排成单行；details 用 `margin-left: auto` 推到右侧

### 修复 3：draftWarning 误显示

`buildAddOpportunityFormMarkup` 改为 post-guard：

```js
let protectedName = d.opportunityName || "";
let warningReason = null;
if (d.draftWarning) {
  if (!protectedName) warningReason = d.draftWarning;  // 仅在 protectedName 真的为空时记下
} else if (titleMatchesQuestion(...)) { ... } 
  else if (hasUselessPrefix(...)) { ... }
const formWarning = protectedName ? null : warningReason;  // post-guard
```

效果：即使后端 / LLM 同时返回 `draftWarning` + 非空 `opportunityName`，也不再显示 warning。

warning 样式也变轻：删除红左边框，改成 `border-radius: 999px` + 透明背景的小 chip。

### 修复 4：智能草稿 API

新增 `POST /api/opportunities/draft`：

- 请求体：`{ question, answer, search, source, answerType }`
- 响应体：`{ opportunityName, oneLineSummary, note, nextAction, status, type, suggestedTags, draftWarning, sourceQuestion, sourceAnswerSummary, sourceUrls, draftSource }`
- 优先级：**LLM → 规则 → fallback**
- `draftSource ∈ { "llm" | "local-rule" | "fallback" }`
- 响应走 `pickDraftResponse` 字段白名单，丢弃 `filePath` / `apiKey` / `rawAnswer` / `rawSearchResponse`
- body cap **200KB**
- 不调用外部搜索 / 不保存 raw answer / raw search
- 不暴露 API Key（错误消息用 `sk-*` 脱敏）
- 复用现有 `callChatCompletion` + `isConfigured`

实现文件：
- `scripts/ask-strategy-os.js`：新增 `generateOpportunityDraft` / `readDraftSystemPrompt` / `buildDraftUserPrompt` / `parseLlmDraftJson` / `pickDraftFields` / `buildDraftByRule`
- `scripts/start-ask-ui.js`：新增路由 + `pickDraftResponse` + `readBody(req, maxBytes)`
- 前端 `openAddOpportunityForm` 改 async，先调 draft API，失败时 `draft=null` 走 `buildAddOpportunityFormMarkup` 内嵌的本地规则兜底

### 修复 5：加入机会池表单重新排版

把字段包成 4 个 fieldsets，保留 `data-op-add-*` selectors：

- `opportunity-add-fieldset--core`（边框 accent 色，背景 panel-strong）：机会名称（更大字号 / 加粗）+ 一句话说明
- `opportunity-add-fieldset--judgment`（桌面端两列 grid，移动端单列）：状态 + 类型
- `opportunity-add-fieldset--action`：备注 + 下一步
- `opportunity-add-source-info`（`<details>` 默认折叠）：标签 chips + 参考来源

CSS：grid 间距 10px，fieldsets 圆角边框，warning 改为 chip，移动端不破布局。

### 修复 6：输入框提交后自动清空 + × 清空按钮

- `<textarea>` 包进 `<div class="composer-textarea-wrap">`；textarea `padding-right: 38px` 给 × 留位
- 新增 `<button id="clearInputButton" aria-label="清空输入" hidden>×</button>`
- `clearComposerInput()`：`input.value = ""`、`updateClearButtonVisibility()`、`input.focus()`
- `updateClearButtonVisibility()`：根据 `input.value.trim().length > 0` 切换 `clearInputButton.hidden`
- `submitAsk()`：捕获问题后立即 `input.value = ""` + `updateClearButtonVisibility()`，fetch body 仍用捕获的 `value`，`questionEcho` 继续显示原问题
- `mount()`：input 事件 + click 监听都到位
- 全部保留 Enter 发送 / Shift+Enter 换行 / IME composition / 移动端可点

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）
- 不恢复仓鼠跑轮
- 不默认自动联网 / 不默认勾选"本次联网搜索"
- 不删除 Bocha / Tavily provider
- 不改 LLM API 配置逻辑
- 不暴露 API Key / 不提交 .env
- 不提交 `data/opportunities/*.json` 或测试机会数据
- 不调用真实 Codex / WorkBuddy / OpenDesign / MiniMax

## V0.3.11-hotfix-4 修复机会池按钮文案与草稿脱敏

V0.3.11-hotfix-3 完成后用户真实使用反馈两个问题：

1. "机会池"按钮只显示加号，缺少右侧的"机会池"三个字。
2. 真实验证时，draft 响应中出现了用户输入的 `sk-fakefake` 原文（即使 LLM 在 note 中引用了用户的输入）。

本次仍只动前端 + 后端脱敏共享层，不改 LLM provider / search / 端口。

### 修复 1：机会池按钮文案

按钮可见内容恢复为 `＋ 机会池`（加号 + 三字文案）：

```html
<button id="addOpportunityButton" class="add-opportunity-button"
        aria-label="加入机会池" title="把当前回答加入机会池" hidden disabled>
  <span class="add-opportunity-icon" aria-hidden="true">＋</span>
  <span class="add-opportunity-label">机会池</span>
</button>
```

CSS：

- `.add-opportunity-icon` `font-size: 18px`（加号更大）
- `.add-opportunity-label` `font-size: 13px`（文字小一号，弱于加号）
- 加号 `color: var(--accent-dark)` 与文字一致
- `aria-label="加入机会池"` + `title="把当前回答加入机会池"` 保留无障碍文本

### 修复 2：统一 sk-* 脱敏

新增 `scripts/secret-redact.js`，提供纯函数 `redactSecretLikeText(value)`：

- 字符串中匹配 `/sk-[A-Za-z0-9_-]+/g` 的内容，全部替换为 `[redacted]`
- 递归处理对象 / 数组
- 保留 null / undefined / number / boolean 原值
- 不改变正常中文内容，不改变普通 URL（除非 URL 自身含 sk-*）

应用链路（**所有进入 prompt / 响应 / 持久化前的输入都要先过 redactSecretLikeText**）：

| 链路 | 入口 | 文件 |
| --- | --- | --- |
| `/api/opportunities/draft` 响应 | `generateOpportunityDraft` 三层（LLM / 规则 / fallback）出口 | `scripts/ask-strategy-os.js` |
| `POST /api/opportunities` 保存 | `addOpportunity` 入口 | `scripts/opportunity-store.js` |
| `PATCH /api/opportunities/:id` 更新 | `updateOpportunity` 入口 | `scripts/opportunity-store.js` |
| Ask Mode LLM context | `buildOpportunityContextForPrompt` 入口 | `scripts/opportunity-store.js` |
| Kickoff LLM prompt | `buildKickoffUserPrompt` 入口 | `scripts/ask-strategy-os.js` |
| 本地 Kickoff 兜底 | `buildLocalKickoff` 入口 | `scripts/ask-strategy-os.js` |

新增 `OPPORTUNITY_DRAFT_PRESET_TAGS` 中 `sourceUrls` 字段也参与脱敏，限制 5 条以内、每条字段长度限制。

### 真实验证

- `POST /api/opportunities/draft` body 含 `sk-fakefake`，响应中 `note` / `oneLineSummary` / `sourceAnswerSummary` / `sourceUrls[].title|url|source` 均无 sk-* 原文；含 `[redacted]`
- `POST /api/opportunities` 保存 `note = "sk-fakefake in note"`，opportunity-pool.json 持久化字段无 sk-* 原文
- `PATCH /api/opportunities/:id` 更新 `note`，持久化字段无 sk-* 原文
- `buildOpportunityContextForPrompt` 输入含 sk-* 的 note，输出字符串无 sk-* 原文
- `buildKickoffUserPrompt` / `buildLocalKickoff` 输入含 sk-* 的字段，输出字符串无 sk-* 原文
- 即使是用户输入的假 key，也会被脱敏；不允许"用户输入就回显"

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）
- 不恢复仓鼠跑轮
- 不默认自动联网 / 不默认勾选"本次联网搜索"
- 不删除 Bocha / Tavily provider
- 不改 LLM API 配置逻辑
- 不暴露 API Key / 不提交 .env
- 不提交 `data/opportunities/*.json` 或测试机会数据
- 不调用真实 Codex / WorkBuddy / OpenDesign / MiniMax

## V0.4 整理战略OS日用入口

V0.3 主线（联网搜索 → 战略回答 → ＋机会池 → 智能草稿 → 保存 → 编辑 → 开工包 → 历史恢复 → 复制 → 删除）已收束闭环。V0.4 不堆新功能，只把工具整理成"日用战略入口"。

### 1. 首页入口层级

- 主输入区：提问输入框 + 本次联网搜索 toggle + 发送按钮 + 清空按钮
- 回答区：回答正文为主，meta 单行，＋机会池按钮 + 复制按钮
- 侧边：今日机会池（不再是"机会池"），历史弱化
- 搜索过程默认折叠；搜索来源默认隐藏
- 顶部状态条保持"默认不联网"

### 2. 机会池日用化

- 标题改为"今日机会池"
- 机会项里 `nextAction` 用 `border-left: 2px solid accent` 高亮，作为"今日可推进"的主信号
- 无 `nextAction` 时显示弱提示「暂无下一步，建议补充行动。」
- 按钮顺序：生成开工包（主）→ 编辑 → 删除
- stats 文案精简：仅显示"全部 N / 已归档 M / 已拒绝 K"；不再把 watch / validate / accepted 混在同一排

### 3. 开工包入口强化

- 机会项上"生成开工包"按钮视觉权重最大（墨绿边 + hover 实心）
- 点击后在回答区显示"为「机会名」生成开工包"（通过 questionEcho 体现）
- 复制按钮可复制开工包正文
- 历史保存为 `kickoff-package` 类型，恢复时按钮按 V0.3.11-hotfix-2 逻辑隐藏

### 4. 历史 / 来源 / 搜索过程弱化

- 历史保留但视觉弱化
- 搜索过程默认折叠为 `<details>`
- 搜索来源默认 hidden，需要时由 applySearchSources 显式显示
- meta 单行不抢主视觉

### 5. stats 口径修复

修复 V0.3.12 验收时发现的 stats 矛盾：

- 旧实现：同一机会 `status=validate` + `humanDecision=watching` 会被 validate 桶 +1、watch 桶 +1（双计）
- 新实现（V0.4）：互斥桶。每个机会按优先级归入唯一一个主桶
  - `archived` → 已归档
  - `rejected` → 已拒绝
  - `status=watch` 或 `humanDecision=watching` → 观察中
  - 其它 → 待验证（inbox / validate / mvp-spec / building 都归这里）
- `humanDecision=accepted` 单独计入 `accepted` 桶（作为决策维度，与 status 桶正交）
- UI 改为只显示 total / archived / rejected，避免用户看到 validate+watch 互斥之和 ≠ total 的矛盾

### 6. 输入区

- 提交后自动清空（V0.3.11-hotfix-3）
- × 清空按钮（V0.3.11-hotfix-3）
- Enter 发送 / Shift+Enter 换行 / IME composition 不误触发（V0.3.4）
- 本次联网搜索 toggle 默认关闭

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）
- 不恢复仓鼠跑轮
- 不默认自动联网 / 不默认勾选"本次联网搜索"
- 不删除 Bocha / Tavily provider
- 不改 LLM API 配置逻辑
- 不暴露 API Key / 不提交 .env
- 不提交 `data/opportunities/*.json` 或测试机会数据
- 不调用真实 Codex / WorkBuddy / OpenDesign / MiniMax
- 不做复杂 Dashboard / 拖拽看板 / 引入 UI 库
- 不把旧项目当成默认优化对象

## V0.4.1 优化战略OS三栏日用布局

V0.4 已经把首页标题、stats 口径和开工包顺序整理到位。V0.4.1 进一步把首页布局重做为桌面三栏 + 收窄屏 / 移动端两档断点,并清理过时的 `.composer-hint` 提示。

### 1. 桌面三栏布局

```
左 (300px)        | 中 (minmax 720px, 1fr) | 右 (280px)
今日机会池 (可折叠) | 推荐问题             | 最近提问
                  | 战略回答 (主体)      |
                  | meta 说明            |
```

- `.layout` 改用 `grid-template-columns: 300px minmax(720px, 1fr) 280px`
- 左栏 `.rail--left` 仅含"今日机会池"（V0.4 的左栏太大，机会池 + 历史 + 推荐问题 + meta 全塞一栏）
- 中栏 `.main` 含推荐问题 + 战略回答 + meta 说明
- 右栏 `.rail--right` 仅含"最近提问"（与机会池分离）
- 收窄屏 (`max-width: 1280px`) 退化为两栏（隐藏右栏）；移动端 (`max-width: 900px`) 单列堆叠

### 2. 页面饱满度

- `--content-width: 1180px → 1600px`
- `.shell / .composer-inner / .footer` 全部用 `width: min(var(--content-width), 96vw)`
- 桌面端 1080p+ 1920px+ 显示器左右留白从原来 300px+ 收窄到 80px 左右

### 3. 今日机会池折叠 / 展开

- 标题行右侧加 `+` 按钮 `<button id="opportunityToggle" aria-expanded="true" aria-controls="opportunityBody">`
- 点击 → `toggleOpportunityPanel` 切换 `.is-collapsed` class + `aria-expanded` + `body.hidden`
- 折叠状态 **不持久化**：每次刷新回到默认展开
- 纯函数 `toggleOpportunityPanel({ panel, body, toggle, expand })` 在 `app.js` 顶层导出，可单测

### 4. 推荐问题 + 最近提问分栏迁移

- 推荐问题 `.questions-panel` 移到中栏 `.main` 顶部（紧贴战略回答）
- 最近提问 `.history-panel` 移到右栏 `.rail--right`
- 点击推荐问题仍只填入输入框；点击历史项仍恢复搜索过程 / 参考来源

### 5. 删除底部 "Enter 发送 / Shift + Enter 换行" 提示

- HTML 删除 `<p class="composer-hint">` 节点
- CSS 删除 `.composer-hint { ... }` 规则
- 交互逻辑不变：Enter 仍发送 / Shift+Enter 仍换行 / IME composition 仍不误触发（保留在 `app.js` 的实现注释里作为 fallback）

### 6. 战略回答下方 meta 单行

- `.question-echo` 基础规则加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%`
- 长 question / kickoff 描述不会撑成两行；过长时省略号截断

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）
- 不恢复仓鼠跑轮
- 不默认自动联网 / 不默认勾选"本次联网搜索"
- 不删除 Bocha / Tavily provider
- 不改 LLM API 配置逻辑
- 不暴露 API Key / 不提交 .env
- 不提交 `data/opportunities/*.json` 或测试机会数据
- 不调用真实 Codex / WorkBuddy / OpenDesign / MiniMax
- 不做复杂 Dashboard / 拖拽看板 / 引入 UI 库
- 不把旧项目当成默认优化对象

## V0.4.2 修补三栏日用细节

V0.4.1 把桌面三栏、推荐问题 / 历史分栏、折叠按钮搭好。V0.4.2 把"每天打开都顺手"打磨到位：左右栏独立滚动、折叠状态记忆、右栏密度更舒服。

### 1. 三栏独立滚动

- `.rail` 桌面端 `position: sticky; top: 24px; max-height: calc(100vh - var(--composer-height) - 32px); overflow-y: auto`
- 左栏今日机会池 / 右栏最近提问 各自独立滚动，不再拖累主栏
- 滚动条弱化：`scrollbar-width: thin` + `::-webkit-scrollbar` 6px 浅色，不抢戏
- 移动端 (`max-width: 900px`) `.rail { position: static; max-height: none }` 退化为普通流

### 2. 今日机会池折叠状态记忆

- 新增纯函数 `loadOpportunityCollapsed(storage)` / `saveOpportunityCollapsed(storage, value)`
- key：`strategyOsOpportunityPanelCollapsed`，`"true"` / `"false"`
- `createApp.mount` 时读取 → 若为折叠则初始化 `is-collapsed`
- 点击折叠按钮 → `toggleOpportunityPanel` → `saveOpportunityCollapsed` 写入
- localStorage 不可用 / 抛错 / 写入非法值 → 静默 fallback false（默认展开）
- 不影响机会池新增 / 编辑 / 删除 / 生成开工包

### 3. 最近提问右栏密度优化

- `.history-item` padding 从 `10px 12px` 收到 `7px 10px`
- `.history-question` line-clamp 2 行保留（不溢出）
- `.history-meta` / `.history-source` 字号 11.5px → 10.5px
- `.history-list` 取消 `max-height: 280px`（外层 `.rail` 已限制）
- 长问题标题继续被 `-webkit-line-clamp: 2` 截断
- kickoff-package 历史项仍显示"开工包"标签，可点击恢复

### 4. 主栏输入区与回答 meta 稳定性

- `.question-echo` 从 `inline-block` 改为 `display: block; width: 100%` + `box-sizing: border-box`
- 真实场景中长 question / kickoff 描述不会被工具栏挤压、不会换行成两行
- composer / 推荐问题 / ＋机会池 按钮位置不动；与 V0.4.1 一致

### 不动的部分

- 不修改 loading 动画本体（keyframes / 内部 6 个 div / animation 时长都不动）
- 不默认自动联网 / 不默认勾选"本次联网搜索"
- 不删除 Bocha / Tavily provider
- 不改 LLM API 配置逻辑
- 不暴露 API Key / 不提交 .env
- 不提交 `data/opportunities/*.json` 或测试机会数据
- 不调用真实 Codex / WorkBuddy / OpenDesign / MiniMax
- 不做复杂 Dashboard / 拖拽看板 / 引入 UI 库
- 不改旧项目文件

## V0.4.3 代码体检与轻量重构

V0.4.3 不新增产品功能，只做代码体检和低风险整理。用户可见行为保持不变，默认不联网原则保持不变。

体检结论：

- `public/ask-ui/app.js`、`public/ask-ui/styles.css`、`test/ask-ui-app.test.js` 已经偏大，但当前是无构建的本地单页应用；强拆前端模块需要改变浏览器加载与测试方式，收益不够确定，所以本次不拆文件。
- `scripts/opportunity-store.js` 承担机会池读写、normalize、草稿派生和 prompt 摘要，边界基本清楚；后续若继续增长，可优先拆出 label / draft 纯函数。
- `scripts/start-ask-ui.js` 仍保持 HTTP route 层职责，不承载业务逻辑。
- `search-client.js` / `search-planner.js` 边界清楚：前者负责 provider 调用、去重、时效和质量评分；后者负责意图与 query planning。

本次轻量整理：

- 修复机会池保存时的派生字段污染：`displayTitle`、`statusLabel`、`humanDecisionLabel`、`typeLabel` 只用于 UI，不再写入 `opportunity-pool.json` 或删除备份。
- `start-ask-ui.js` 新增 `safeErrorMessage`，统一复用 `secret-redact.js` 的 `sk-*` 脱敏，替代多处手写 regex。
- 更新测试覆盖：机会池保存 / 删除备份不落 UI 派生字段；HTTP 错误消息不会回显 `sk-*`。

不动的部分：

- 不修改 loading 动画本体、keyframes、内部结构或参数。
- 不改 Ask UI 三栏布局、搜索开关默认值、LLM 配置、Bocha / Tavily provider。
- 不提交 `.env`、`opportunity-pool.json`、`data/opportunities/backups` 或测试机会数据。

## V0.4.4 开工包任务复制

V0.4.4 只整理开工包派发前的手动准备动作：当回答类型是 `kickoff-package` 时，回答区会额外显示“复制为 Codex 任务”和“复制为 Claude Code 任务”。

- 普通战略回答不显示这两个专属按钮，仍只保留“＋ 机会池”和普通复制。
- 开工包历史恢复后，专属任务复制按钮仍可用。
- 按钮只生成可复制的任务提示词，不会自动调用 Codex、Claude Code、OpenDesign 或任何外部执行工具。
- 复制内容会对 `sk-*` 做脱敏，避免把 API Key 原文带入下游工具。
- Codex 任务模板偏工程执行：现状检查、边界、测试、Git 与最终汇报。
- Claude Code 任务模板偏前端 / 交互执行：禁止大改架构，要求真实网页验证并汇报 URL 与停止方式。
- 默认不联网原则不变，“本次联网搜索”不会被默认打开。
- loading 动画未修改。
- `.env`、`opportunity-pool.json` 和用户生成数据仍不提交。

## V0.4.5 修复开工包任务复制与冗余信息

V0.4.5 只修复日用体验问题，不新增产品流程。

- 修复开工包任务复制按钮的可用性验证：按钮 click listener 会实际写入对应任务提示词。
- 为“复制为 Codex 任务”和“复制为 Claude Code 任务”补充 `title` / `aria-label` 区别说明：Codex 偏工程、脚本、测试、Git；Claude Code 偏前端页面、UI、交互和真实网页验证。
- 删除战略回答下方“范围 / 搜索”冗余信息块，中间区域只保留战略回答、必要操作、搜索过程和参考来源。
- 调整顶部标题容器为 sticky + 背景 + z-index，避免最大化滚动时被侧栏或内容层遮住。
- 默认不联网原则不变。
- loading 动画未修改。
- `.env`、`opportunity-pool.json` 和用户生成数据仍不提交。

## V0.4.6 固定战略OS工作台滚动模型

V0.4.6 把桌面端 Ask UI 从“网页滚动”收束为固定视口工作台。

- 桌面端 `html` / `body` 不再产生整页滚动，浏览器右侧页面级滚动条应消失。
- 顶部标题区与底部输入区固定可见，中间三栏占据剩余视口高度。
- 只有三个日用区域内部滚动：今日机会池、战略回答 / 主输出区、最近提问。
- 战略回答区新增内部滚动容器，长回答、搜索过程、参考来源和加入机会池表单不会撑破整页。
- 移动端保留更保守的自然页面滚动，避免小屏固定视口过挤。
- 主动修补了移动端滚动 override 顺序问题，避免桌面规则覆盖移动端恢复策略。
- 默认不联网原则不变。
- loading 动画未修改。
- `.env`、`opportunity-pool.json`、`data/opportunities/backups` 和用户生成数据仍不提交。
- Goal 模块本次不实现，后续如果进入 Goal 方向，应先定义极简的“今日目标 / 当前阶段 / 不做事项”输入，而不是新增复杂任务系统。

## V0.5 轻量 Goal 方向锚点

V0.5 新增“当前目标”，但它不是 OKR、待办列表或项目管理系统。它只回答一个问题：EricChan 现在主要想推进什么方向。

- 页面顶部新增轻量当前目标区域，支持设置、修改、清除。
- 当前目标只保存在浏览器 `localStorage` 的 `strategyOsCurrentGoal`，不新增数据库，不写入 `opportunity-pool.json`，不提交到 Git。
- 目标文本会限制在 200 字以内，空目标视为未设置，`sk-*` 会脱敏。
- Ask 提问时，前端会把 `currentGoal` 作为可选字段传给 `/api/ask`；服务端 prompt 会把它作为方向锚点，而不是强行套用到所有问题。
- 如果问题与当前目标冲突，回答应指出冲突；如果无关，回答应说明是否值得偏离。
- 从机会池生成开工包时，`currentGoal` 会进入 kickoff prompt，开工包会说明这个机会是否服务当前目标。
- “复制为 Codex 任务”和“复制为 Claude Code 任务”会在存在当前目标时加入“当前目标”段落，并继续做 `sk-*` 脱敏。
- 历史恢复不会改变当前目标；Goal 只代表当前浏览器里的最新方向锚点。
- 固定视口工作台不变，默认不联网原则不变，loading 动画未修改。

## V0.5.1 Goal 真实链路验收

V0.5.1 对 Goal 做真实链路验收和小修补，重点不是增加目标管理功能，而是确认“当前目标”真的进入日用判断链路。

- Ask 回答会围绕 Goal 做判断，但不会机械迎合；如果问题与 Goal 冲突，会提示偏离；如果问题与 Goal 无关，会说明是否值得偏离。
- “＋机会池”的智能草稿会把 Goal 作为上下文：例如 Goal 强调独立开发者、小型 AI 产品、7 天验证时，草稿的摘要、备注、下一步会优先压到这个方向。
- 开工包继续强化“与当前目标的关系”，并保持不使用“信息不足”逃避判断。
- “复制为 Codex 任务”和“复制为 Claude Code 任务”继续包含 Goal 上下文、开工包正文、执行边界、测试 / Git / 真实验证要求。
- 清除 Goal 后，Ask、智能草稿、开工包和任务复制不会继续带旧目标。
- 不新增多目标、OKR、待办、目标评分、数据库或外部同步。
- 默认不联网、固定视口工作台、loading 动画和 `opportunity-pool.json` 不提交原则不变。

## V0.6 Goal 匹配度与今日优先级

V0.6 让今日机会池根据当前 Goal 做轻量派生判断：不是项目管理，也不是复杂评分系统，只回答“今天哪个机会更值得推一下”。

- 机会池响应会派生 `Goal匹配度`：高匹配 / 中匹配 / 低匹配 / 未判断。
- 同时派生 `今日优先级`：今日优先 / 可观察 / 暂缓；今日优先最多突出 1-2 个。
- 没有 Goal 时不做假判断，只显示“未判断”或设置目标后再判断的弱提示。
- 派生字段只用于 API response、Ask prompt 和前端展示，不写入 `opportunity-pool.json`、删除备份或 Git。
- Goal 改变或清除后，前端会重新请求机会池并刷新派生判断。
- Ask prompt 会把今日优先项作为上下文，回答“今天适合做什么？”时优先参考它，但不会机械复述所有机会。
- 开工包会体现机会与当前 Goal / 今日优先级的关系；低匹配机会仍可生成开工包，但会提示可能偏离当前目标。
- 不新增 OKR、多目标、看板拖拽、数据库、自动派发或任务管理。
- 默认不联网、固定视口工作台、loading 动画和 `opportunity-pool.json` 不提交原则不变。

## V0.6.1-hotfix 恢复 LLM 与联网搜索链路

V0.6.1-hotfix 修复的是运行链路稳定性，不新增功能。

- `npm run llm:check` 和 `npm run search:check` 仍是首选诊断入口，只输出是否配置、状态码和安全化错误，不输出 API Key。
- 普通 Ask 继续走 LLM 动态回答；LLM 成功时返回 `source="llm"`。
- 勾选“本次联网搜索”或 CLI 使用 `--search` 后，搜索结果仍会作为补充上下文交给 LLM。
- 如果带搜索结果的 LLM 请求首次超时，系统会自动用压缩版搜索上下文重试一次：保留关键来源，减少搜索质量 / 时效性细节，避免一次超时就直接退回本地规则。
- 非超时错误（401 / 403 / 404 / 429 / 5xx 等）不会被压缩重试掩盖，仍按原诊断和 fallback 处理。
- 搜索失败时仍显示中文 warning，Ask 本地 fallback 保留。
- 默认不联网原则不变，搜索 checkbox 不会默认勾选。
- 固定视口工作台、Goal 匹配度、今日优先级、Bocha / Tavily provider、loading 动画和 `opportunity-pool.json` 不提交原则不变。

## V0.3.7 搜索意图改写与相关性过滤

V0.3.7 在调用搜索 provider 前增加轻量 Search Planner。它不会让系统默认联网，只在用户勾选“本次联网搜索”或 CLI 使用 `--search` 后生效。

Search Planner 会做三件事：

- 判断搜索意图：`ai-opportunity` / `project-research` / `news` / `competitor-research` / `technical-docs` / `general`。
- 把宽泛问题改写成更贴近 EricChan 战略OS的搜索词。例如“今天有什么趋势？”不会直接搜索原句，而会改写到 AI Agent、大模型应用、独立开发者、商业机会、个人 OS / OPC 等方向。
- 对结果做轻量相关性过滤。宽泛趋势类问题会过滤明显 A股 / 股票 / 行情 / 盘面热点污染；如果用户明确问财经，则不做这类过滤。

搜索结果仍然只是补充证据，不替代战略判断。`search` 返回中会包含 `intent`、`plannedQueries`、`freshness`、`recency` 与 `filters`；前端只展示轻量搜索过程，不展示完整搜索响应。

## V0.3.6 精修搜索来源展示体验

V0.3.6 不再改后端搜索 provider，只在前端把搜索结果展示得更轻量、更自然。

**回答区显示规则**：

- 搜索成功（`search.used=true` 且 `search.sources.length>0`）时，回答正文下方显示一个“参考来源”区域：
  - 顶部一行“参考来源” + “已参考 N 条外部结果”（N 为实际展示条数，最多 5 条）。
  - 每条来源显示：标题（点击可打开外链，`target="_blank" rel="noopener noreferrer"`）+ 来源站点（域名）。
  - URL 仅允许 `http(s)` 协议；其它协议或 localhost/127.0.0.0/::1 会被降级为纯文本（避免把内部 URL 误开放成外链）。
  - 所有字段均做 HTML escape，标题里出现 `<script>` 不会执行。
- 搜索失败（`search.used=true` 但 `search.warning` 存在）时，**不**渲染空来源列表，只在状态条显示中文 warning：“联网搜索暂时不可用，已使用本地上下文回答。”
- 未勾选搜索 / `search.used=false` / `search` 字段缺失时，整个“参考来源”区域保持隐藏，不占回答区空间。
- 来源区与回答正文是兄弟节点，复制按钮默认**只**复制 `#answerOutput` 内的回答正文，不会把 sources / raw search JSON / API Key 带进剪贴板。

**历史记录恢复**：

- 历史项保存轻量 `searchSources` 摘要，每条只含 `title` / `url` / `source`，**最多 5 条**；`snippet` / `raw` / API Key / provider 原始 payload 都不会进 history。
- 点击历史项时，会：
  - 恢复回答正文（已存在能力）。
  - 重新渲染来源区（基于当时保存的 `searchSources`）。
  - 恢复 warning 文案（如果是搜索失败的那次）。
  - **不**重新调用 `/api/ask`，不触发任何 `fetch`。
- 恢复后的来源区与新搜索时显示效果一致。

**复制按钮隔离**：

- `buildClipboardPayload` 现在明确忽略 `searchSources` / 任何外部结构；只输出 `text` (Markdown 纯文本) + `format: "text/markdown"`。
- 测试覆盖：传入 `searchSources` 也不会写入剪贴板；剪贴板里看不到任何 URL / 标题。

**前端展示结构**：

- 新增轻量容器 `#searchSources`，位于 `#answerOutput` 之后；默认 `hidden`。
- 由 `renderSearchSources(sources)` 纯函数生成内层 HTML（`<section.search-sources>` + head + summary + `<ul>`）。
- 视觉风格：浅色（`var(--bg-soft)` 底）+ 1px 边线 + 圆角，文字沿用页面 accent / muted 色系；外链显示但颜色克制（`text-decoration: underline` + 半透明下划线）。
- 全部交由 CSS 控制；`prefers-reduced-motion` 不影响来源区（无动画）。

**不动的部分**：

- 不修改 `scripts/search-client.js` / `scripts/check-search.js` / `scripts/ask-strategy-os.js` / `scripts/llm-client.js`。
- 不修改 `prompts/ask-mode-system-prompt.md` / `ASK_MODE_SYSTEM_PROMPT_FALLBACK`。
- 不修改 `scripts/start-ask-ui.js` 的双 loopback 监听（127.0.0.1 + ::1）。
- 不修改 loading 动画（仓鼠跑轮 / 3D 盒子任一版本仍按 V0.3.4-hotfix-3 / 后续小调整原样保留）。

## 搜索诊断

```bash
npm run search:check
```

用于检查：

- enabled
- provider
- key 是否存在（只显示 true / false）
- baseUrl
- timeout
- maxResults
- 测试搜索是否成功

诊断脚本不会输出真实 Key，不会修改任何项目数据。当前内置 provider：`tavily`、`bocha`。

## LLM 回答清洗（V0.3.3-hotfix-3）

Ask Mode 只展示中文最终答案。系统在两个层面做约束：

**Prompt 层**（`prompts/ask-mode-system-prompt.md`）：

- 明文要求模型只输出最终答案，不得输出思考过程、推理过程、草稿、chain-of-thought。
- 禁止输出 `<think>...</think>` 标签，禁止 `Analysis:` / `Reasoning:` / `Thought:` / `Chain of thought:` / `CoT:` / `Internal reasoning:` 等英文标签段落。
- 禁止 `We need to ...` / `Let's analyze ...` / `The user asks ...` / `I need to ...` / `First, let me ...` 等英文元说明。
- 理由部分只能是简短结论性理由，每条不超过一行，不展示逐步推理。
- 所有用户可见内容必须为中文；技术名词如 GPT 5.5 Thinking、Codex、OpenDesign、MiniMax、WorkBuddy、API、MVP、OPC 例外。

**工程层**（`scripts/llm-client.js` 的 `sanitizeLlmAnswer`）作为兜底：

- 移除 `<think>...</think>` 块（包括多行）。
- 移除 ` ```thinking ``` ` / ` ```reasoning ``` ` / ` ```analysis ``` ` / ` ```cot ``` ` 围栏代码块。
- 移除以 `Analysis:` / `Reasoning:` / `Thought:` / `Chain of thought:` / `CoT:` / `Internal reasoning:` 开头的整段。
- 移除以 `We need to ...` / `Let's analyze ...` / `The user asks ...` / `I need to ...` / `First, let me ...` 开头的英文元说明。
- 若出现 `Final:` 或 `最终答案：` 标记，只保留标记之后的内容。
- **不**误删中文"理由："部分。
- **不**误删技术名词 GPT 5.5 Thinking、Codex、API、MVP。
- 清洗后为空 → 抛 `empty` 错误 → fallback 到本地规则回答。

`/api/ask` 和 `npm run ask` 都会自动应用这个清洗。如果某些模型仍持续输出 reasoning，建议更换模型或在请求参数里关闭 reasoning 输出。

## Output Files

Each run writes:

- `reports/YYYY-MM-DD.md`
- `data/reports/YYYY-MM-DD.json`
- `data/raw/YYYY-MM-DD.json`
- `feedback/YYYY-MM-DD.md` when using `npm run daily` or `npm run feedback:today`
- `reviews/YYYY-MM-DD-review.md` and `data/reviews/YYYY-MM-DD-review.json` when using `npm run review:today`
- `proposals/YYYY-MM-DD-update-proposal.md` when using `npm run propose:today`
- `opportunities/opportunity-pool.md` and `data/opportunities/opportunity-pool.json` when using `npm run opportunities:update`
- `opportunities/reviews/YYYY-MM-DD-opportunity-review.md` when using `npm run opportunities:review`
- `opportunities/validation/YYYY-MM-DD-independent-ai-opportunity-brief-validation.md` when using `npm run opportunities:validation-pack`
- `daily-command/YYYY-MM-DD.md` and `data/daily-command/YYYY-MM-DD.json` when using `npm run command:today`

`reports/` is for Obsidian-friendly Markdown. `data/reports/` is for future Dashboard consumption. `data/raw/` stores collected source items.
`feedback/` stores personal review notes and is ignored by Git except for `.gitkeep`.
`reviews/` and `data/reviews/` store generated review artifacts and are ignored by Git except for `.gitkeep`.
`proposals/` stores generated update proposals and is ignored by Git except for `.gitkeep`.
`opportunities/` and `data/opportunities/` store the generated Opportunity Pool and are ignored by Git except for `.gitkeep`.
`opportunities/reviews/` stores generated opportunity screening packages and is ignored by Git except for `.gitkeep`.
`opportunities/validation/` stores single-opportunity validation packs and is ignored by Git except for `.gitkeep`.
`daily-command/` and `data/daily-command/` store personal Daily Command outputs and are ignored by Git except for `.gitkeep`.

## How To Judge Report Value

A report is useful only if it passes these checks:

- It classifies trends before recommending action.
- It prioritizes monetizable new project opportunities.
- It uses legacy projects as learning material, not default action targets.
- It creates at least one executable next action.
- It includes an opportunity inbox.
- It gives MVP form and first validation action for opportunities.
- It includes monetization and EricChan-fit assessment.
- It recommends agent dispatch without actually calling those agents.
- It names what should be ignored or watched.
- It avoids generic "AI news is important" language.

## Real Report Acceptance Standard

A real report is accepted for Stage 0.5 only when:

- `mode` is `live`.
- `npm run validate:report` returns a full score.
- At least one trend is connected to a specific EricChan project.
- Trends are evidence-backed and do not include placeholders.
- Trends include valid `classification`.
- Opportunities include monetization, EricChan fit, MVP form, first validation action, and complete scoring.
- Opportunities and actions use `stageFit` honestly.
- The opportunity inbox contains at least one new-opportunity `test` candidate or current-project improvement.
- The next action validates a new opportunity, researches a market, creates an MVP spec, archives an opportunity, updates context, or ignores a noisy trend.
- The report does not recommend updating iPortfolio, rebuilding XiaoChan, deploying old projects, redesigning the personal website, or expanding 节律 App by default.
- The dispatch section recommends agents but does not call them.

If `mode` is `mock`, treat it as a pipeline check, not a real strategy report.

## Source Handling

Trend sources live in `config/sources.config.json`. Prefer official RSS, changelog, release, or blog sources. If a source becomes unstable:

- Replace it with a stable official RSS/API when available.
- Use an official webpage source if no RSS exists.
- Disable it or convert it to `manual-placeholder` if it creates noise.
- Do not add a crawler just to rescue one source.

## Commands

```bash
npm run report       # live sources + real API when .env is configured
npm run report:mock  # mock trends + mock analysis
npm run validate:report # validate the generated report quality
npm run daily        # generate report, validate it, and prepare feedback/YYYY-MM-DD.md
npm run feedback:today # create today's feedback file without regenerating the report
npm run review:today # generate today's Daily Review from report + feedback
npm run review -- --date YYYY-MM-DD # generate review for a specific date
npm run propose:today # generate today's context/prompt update proposal
npm run propose -- --date YYYY-MM-DD # generate proposal for a specific date
npm run command:today # generate today's personal Daily Command
npm run command -- --date YYYY-MM-DD # generate Daily Command for a specific date
npm run today # run the full personal daily flow and point to today's Daily Command
npm run opportunities:update # import report opportunities into the local Opportunity Pool
npm run opportunities:update -- --date YYYY-MM-DD # import opportunities for a specific date
npm run opportunities:validate # validate Opportunity Pool schema and strategy gates
npm run opportunities:list # list Opportunity Pool entries
npm run opportunities:review # generate a manual Opportunity Pool screening package
npm run opportunities:apply-review # write filled Human Review decisions back into the Opportunity Pool
npm run opportunities:validation-pack # generate a validate-stage pack for one accepted opportunity
npm run clean        # remove generated report files, keep .gitkeep files
npm run ask -- "今天适合做什么？"   # CLI Ask Mode（默认本地规则；可配 LLM 动态）
npm run ask -- --search "最近 Anthropic 有什么新闻？" # 本次按需联网搜索
npm run ask:ui                       # 本地网页主界面（监听 127.0.0.1:5177 + [::1]:5177）
npm run llm:check                    # LLM 连接诊断，不修改任何项目数据
npm run search:check                 # 搜索连接诊断，不输出 API Key
npm test             # run local verification tests
```

## Stage 1 / Stage 2 Ideas

Enter Stage 1A after 2-3 live reports are useful without manual rescue: they should bind trends to projects, cite evidence, avoid placeholder trends, mark premature build/deployment ideas as `later` or `not-yet`, pass `npm run validate:report`, and produce feedback worth recording.

Stage 1A is now implemented as `npm run daily`, `feedback/YYYY-MM-DD.md`, `npm run review:today`, `npm run propose:today`, `npm run opportunities:update`, and `npm run opportunities:review`. V0.1.10 adds manual opportunity screening so the next work should be filling review decisions before any Dashboard or MVP spec automation.

Stage 2 can expand the Opportunity Pool, add richer source ingestion, Obsidian export automation, recurring schedules, trend deduplication, and explicit feedback scoring across multiple days.
