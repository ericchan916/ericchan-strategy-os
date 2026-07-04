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
