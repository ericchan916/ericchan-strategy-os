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

`reports/` is for Obsidian-friendly Markdown. `data/reports/` is for future Dashboard consumption. `data/raw/` stores collected source items.
`feedback/` stores personal review notes and is ignored by Git except for `.gitkeep`.
`reviews/` and `data/reviews/` store generated review artifacts and are ignored by Git except for `.gitkeep`.
`proposals/` stores generated update proposals and is ignored by Git except for `.gitkeep`.
`opportunities/` and `data/opportunities/` store the generated Opportunity Pool and are ignored by Git except for `.gitkeep`.
`opportunities/reviews/` stores generated opportunity screening packages and is ignored by Git except for `.gitkeep`.

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
npm run opportunities:update # import report opportunities into the local Opportunity Pool
npm run opportunities:update -- --date YYYY-MM-DD # import opportunities for a specific date
npm run opportunities:validate # validate Opportunity Pool schema and strategy gates
npm run opportunities:list # list Opportunity Pool entries
npm run opportunities:review # generate a manual Opportunity Pool screening package
npm run opportunities:apply-review # write filled Human Review decisions back into the Opportunity Pool
npm run clean        # remove generated report files, keep .gitkeep files
npm test             # run local verification tests
```

## Stage 1 / Stage 2 Ideas

Enter Stage 1A after 2-3 live reports are useful without manual rescue: they should bind trends to projects, cite evidence, avoid placeholder trends, mark premature build/deployment ideas as `later` or `not-yet`, pass `npm run validate:report`, and produce feedback worth recording.

Stage 1A is now implemented as `npm run daily`, `feedback/YYYY-MM-DD.md`, `npm run review:today`, `npm run propose:today`, `npm run opportunities:update`, and `npm run opportunities:review`. V0.1.10 adds manual opportunity screening so the next work should be filling review decisions before any Dashboard or MVP spec automation.

Stage 2 can expand the Opportunity Pool, add richer source ingestion, Obsidian export automation, recurring schedules, trend deduplication, and explicit feedback scoring across multiple days.
