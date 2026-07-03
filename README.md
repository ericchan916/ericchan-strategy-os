# EricChan Strategy OS

Stage 0.5 is a local daily strategy report generator for EricChan. It reads external AI trend signals, combines them with `context/context.md`, asks an OpenAI-compatible LLM for project-aware analysis, and writes both Markdown and structured JSON.

It is not a generic AI news digest. A useful report must connect trends to EricChan projects such as iPortfolio, XiaoChan AI Persona, OPC exploration, EricChan Strategy OS, and the agent/tool chain.

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

## Output Files

Each run writes:

- `reports/YYYY-MM-DD.md`
- `data/reports/YYYY-MM-DD.json`
- `data/raw/YYYY-MM-DD.json`

`reports/` is for Obsidian-friendly Markdown. `data/reports/` is for future Dashboard consumption. `data/raw/` stores collected source items.

## How To Judge Report Value

A report is useful only if it passes these checks:

- It binds trends to concrete EricChan projects.
- It creates at least one executable next action.
- It includes an opportunity inbox.
- It recommends agent dispatch without actually calling those agents.
- It names what should be ignored or watched.
- It avoids generic "AI news is important" language.

## Real Report Acceptance Standard

A real report is accepted for Stage 0.5 only when:

- `mode` is `live`.
- `npm run validate:report` returns a full score.
- At least one trend is connected to a specific EricChan project.
- Trends are evidence-backed and do not include placeholders.
- Opportunities and actions use `stageFit` honestly.
- The opportunity inbox contains at least one `test` or `build` candidate.
- The next action can be executed without needing a Dashboard.
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
npm run clean        # remove generated report files, keep .gitkeep files
npm test             # run local verification tests
```

## Stage 1 / Stage 2 Ideas

Enter Stage 1A after 2-3 live reports are useful without manual rescue: they should bind trends to projects, cite evidence, avoid placeholder trends, mark premature build/deployment ideas as `later` or `not-yet`, pass `npm run validate:report`, and produce feedback worth recording.

Stage 1A should prepare automatic daily reports and human feedback capture. A small local Dashboard belongs after feedback patterns are stable.

Stage 2 can add richer source ingestion, Obsidian export automation, recurring schedules, trend deduplication, and explicit feedback scoring across multiple days.
