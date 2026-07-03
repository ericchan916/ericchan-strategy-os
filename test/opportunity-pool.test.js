const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { updateOpportunityPool } = require("../scripts/update-opportunity-pool");
const { validateOpportunityPool } = require("../scripts/validate-opportunity-pool");

function scores(overrides = {}) {
  return {
    monetizationPotential: 4,
    ericChanFit: 5,
    mvpSpeed: 4,
    aiLeverage: 4,
    opcFit: 3,
    contentAssetPotential: 4,
    longTermCompounding: 4,
    complexityRisk: 2,
    currentStageFit: 4,
    ...overrides
  };
}

function opportunity(overrides = {}) {
  return {
    opportunityName: "Independent AI opportunity brief MVP",
    sourceTrend: "Agentic planning and tool use",
    relatedTrend: "Agentic planning and tool use",
    relatedProject: "EricChan Strategy OS",
    classification: "new-project-opportunity",
    whyItMatters: "Turns trend reading into a monetizable brief.",
    monetizationPotential: "medium-high",
    ericChanFit: "high",
    mvpForm: "Markdown paid-style sample brief",
    firstValidationAction: "Create one sample brief for one niche.",
    recommendedAgent: "GPT 5.5 Thinking + Codex",
    enterOpportunityPool: true,
    needsHumanConfirmation: true,
    shouldIgnore: false,
    scores: scores(),
    tags: ["ai-opportunity"],
    evidence: "Agentic workflows are moving toward repeatable validation loops.",
    sourceUrls: ["mock://agentic"],
    ...overrides
  };
}

function createPoolFixture(reportOverrides = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-pool-"));
  const date = "2026-06-30";
  fs.mkdirSync(path.join(rootDir, "data", "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "data", "reports", `${date}.json`),
    JSON.stringify(
      {
        date,
        opportunities: [
          opportunity(),
          opportunity({
            opportunityName: "Ignore me",
            enterOpportunityPool: true,
            shouldIgnore: true
          }),
          opportunity({
            opportunityName: "Do not enter",
            enterOpportunityPool: false,
            shouldIgnore: false
          })
        ],
        ...reportOverrides
      },
      null,
      2
    )
  );
  return { rootDir, date };
}

test("updateOpportunityPool imports eligible opportunities only", () => {
  const { rootDir, date } = createPoolFixture();

  const result = updateOpportunityPool({ rootDir, date });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.pool.opportunities.length, 1);
  assert.equal(result.pool.opportunities[0].opportunityName, "Independent AI opportunity brief MVP");
  assert.equal(result.pool.opportunities[0].status, "inbox");
  assert.equal(result.pool.opportunities[0].humanDecision, "pending");
  assert.ok(fs.existsSync(path.join(rootDir, "opportunities", "opportunity-pool.md")));
  assert.ok(fs.existsSync(path.join(rootDir, "data", "opportunities", "opportunity-pool.json")));
});

test("updateOpportunityPool dedupes without overwriting humanDecision or notes", () => {
  const { rootDir, date } = createPoolFixture();
  const first = updateOpportunityPool({ rootDir, date });
  const existing = first.pool.opportunities[0];
  existing.humanDecision = "accepted";
  existing.notes = "Keep this manual note.";
  fs.writeFileSync(first.jsonPath, JSON.stringify(first.pool, null, 2));

  const second = updateOpportunityPool({ rootDir, date });
  const updated = second.pool.opportunities[0];

  assert.equal(second.imported, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.pool.opportunities.length, 1);
  assert.equal(updated.humanDecision, "accepted");
  assert.equal(updated.notes, "Keep this manual note.");
  assert.ok(updated.sourceReportDates.includes(date));
});

test("validateOpportunityPool accepts valid pool schema", () => {
  const { rootDir, date } = createPoolFixture();
  const result = updateOpportunityPool({ rootDir, date });

  const validation = validateOpportunityPool(result.pool);

  assert.equal(validation.ok, true);
  assert.equal(validation.failures.length, 0);
});

test("validateOpportunityPool rejects invalid status, duplicates, high-risk building, ignored active, and legacy optimization", () => {
  const base = updateOpportunityPool(createPoolFixture()).pool.opportunities[0];
  const pool = {
    version: 1,
    updatedAt: new Date().toISOString(),
    opportunities: [
      { ...base, status: "building", scores: scores({ complexityRisk: 4 }) },
      { ...base, id: "ignored-active", status: "validate", shouldIgnore: true },
      {
        ...base,
        id: "legacy-active",
        opportunityName: "Update iPortfolio for AI design trend",
        status: "validate",
        relatedProject: "iPortfolio"
      },
      { ...base, id: "bad-status", status: "todo" },
      { ...base }
    ]
  };

  const validation = validateOpportunityPool(pool);

  assert.equal(validation.ok, false);
  assert.ok(validation.failures.includes("duplicate id does not exist"));
  assert.ok(validation.failures.includes("status is valid"));
  assert.ok(validation.failures.includes("high complexity opportunities are not building"));
  assert.ok(validation.failures.includes("ignored opportunities are not active"));
  assert.ok(validation.failures.includes("legacy optimization opportunities are not active"));
});
