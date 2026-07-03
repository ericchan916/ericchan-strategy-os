const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDailyFeedback, runDailyReport } = require("../scripts/run-daily-report");

function createProjectFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-daily-"));

  fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "templates"), { recursive: true });

  fs.writeFileSync(
    path.join(rootDir, "context", "context.md"),
    "# EricChan Context\n\nProjects: iPortfolio, XiaoChan AI Persona, OPC, EricChan Strategy OS, Codex.\n"
  );
  fs.writeFileSync(path.join(rootDir, "config", "sources.config.json"), JSON.stringify({ sources: [] }));
  fs.writeFileSync(path.join(rootDir, "prompts", "analysis-prompt.md"), "Analyze with context.");
  fs.writeFileSync(
    path.join(rootDir, "templates", "daily-feedback-template.md"),
    "# Daily Strategy Feedback\n\n## Report Date\n\n## Accepted Suggestions\n\n## Watched Suggestions\n\n## Rejected Suggestions\n\n## Actions Actually Taken\n\n## What Was Useful\n\n## What Was Noise\n\n## Context Updates Needed\n\n## Prompt Updates Needed\n"
  );

  return rootDir;
}

test("createDailyFeedback writes today's feedback without overwriting existing notes", () => {
  const rootDir = createProjectFixture();
  const date = "2026-06-30";

  const first = createDailyFeedback({
    rootDir,
    date,
    markdownPath: path.join(rootDir, "reports", `${date}.md`),
    jsonPath: path.join(rootDir, "data", "reports", `${date}.json`),
    mode: "mock",
    warnings: ["test warning"],
    qualityScore: "29/29"
  });

  assert.equal(first.created, true);
  assert.ok(fs.existsSync(first.feedbackPath));
  const initial = fs.readFileSync(first.feedbackPath, "utf8");
  assert.ok(initial.includes("Report Markdown"));
  assert.ok(initial.includes("Quality score: 29/29"));
  assert.ok(initial.includes("test warning"));

  fs.writeFileSync(first.feedbackPath, `${initial}\nUSER NOTE: keep this.\n`);

  const second = createDailyFeedback({
    rootDir,
    date,
    markdownPath: path.join(rootDir, "reports", `${date}.md`),
    jsonPath: path.join(rootDir, "data", "reports", `${date}.json`),
    mode: "live",
    warnings: [],
    qualityScore: "29/29"
  });

  assert.equal(second.created, false);
  assert.ok(fs.readFileSync(second.feedbackPath, "utf8").includes("USER NOTE: keep this."));
});

test("runDailyReport generates report, validates it, and prepares feedback", async () => {
  const rootDir = createProjectFixture();

  const result = await runDailyReport({ rootDir, date: "2026-06-30", mock: true });

  assert.equal(result.mode, "mock");
  assert.equal(result.qualityScore, `${result.validation.maxScore}/${result.validation.maxScore}`);
  assert.equal(result.validation.ok, true);
  assert.equal(result.feedback.created, true);
  assert.ok(fs.existsSync(result.markdownPath));
  assert.ok(fs.existsSync(result.jsonPath));
  assert.ok(fs.existsSync(result.feedback.feedbackPath));
});
