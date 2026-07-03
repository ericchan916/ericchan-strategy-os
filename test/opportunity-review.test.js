const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { generateOpportunityReview } = require("../scripts/generate-opportunity-review");

function opportunity(overrides = {}) {
  return {
    id: "opp-independent-ai-opportunity-brief-mvp",
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    status: "inbox",
    opportunityName: "Independent AI opportunity brief MVP",
    sourceTrend: "Agentic planning and tool use",
    sourceReportDate: "2026-06-30",
    sourceReportDates: ["2026-06-30"],
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
    scores: {
      monetizationPotential: 4,
      ericChanFit: 5,
      mvpSpeed: 4,
      aiLeverage: 4,
      opcFit: 3,
      contentAssetPotential: 4,
      longTermCompounding: 4,
      complexityRisk: 2,
      currentStageFit: 4
    },
    tags: ["ai-opportunity"],
    evidence: "Agentic workflows are moving toward repeatable validation loops.",
    sourceUrls: ["mock://agentic"],
    notes: "Manual note must remain in the pool.",
    humanDecision: "pending",
    ...overrides
  };
}

function createPoolFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-opp-review-"));
  const poolPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const pool = {
    version: 1,
    updatedAt: "2026-06-30T00:00:00.000Z",
    opportunities: [
      opportunity(),
      opportunity({
        id: "opp-opportunity-scoring-quality-gate",
        opportunityName: "Opportunity scoring quality gate",
        sourceTrend: "AI evaluation patterns are becoming productized",
        classification: "current-project-improvement",
        monetizationPotential: "medium",
        ericChanFit: "high",
        mvpForm: "Quality gate checklist for opportunity briefs",
        firstValidationAction: "Use it on three opportunity candidates.",
        recommendedAgent: "Codex",
        scores: {
          monetizationPotential: 3,
          ericChanFit: 5,
          mvpSpeed: 5,
          aiLeverage: 4,
          opcFit: 4,
          contentAssetPotential: 3,
          longTermCompounding: 4,
          complexityRisk: 1,
          currentStageFit: 5
        },
        evidence: "The current pool needs stricter screening before MVP specs.",
        sourceUrls: []
      })
    ]
  };
  fs.mkdirSync(path.dirname(poolPath), { recursive: true });
  fs.writeFileSync(poolPath, JSON.stringify(pool, null, 2));
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");
  return { rootDir, poolPath, poolContent: fs.readFileSync(poolPath, "utf8") };
}

test("generateOpportunityReview creates a human screening package for every opportunity without modifying the pool", () => {
  const { rootDir, poolPath, poolContent } = createPoolFixture();

  const result = generateOpportunityReview({ rootDir, date: "2026-06-30" });
  const markdown = fs.readFileSync(result.reviewPath, "utf8");

  assert.equal(result.opportunityCount, 2);
  assert.ok(markdown.includes("## Opportunity: Independent AI opportunity brief MVP"));
  assert.ok(markdown.includes("## Opportunity: Opportunity scoring quality gate"));
  assert.ok(markdown.includes("### Human Review"));
  assert.ok(markdown.includes("- Current status: inbox"));
  assert.ok(markdown.includes("- Human decision: pending"));
  assert.ok(markdown.includes("- Source trend: Agentic planning and tool use"));
  assert.ok(markdown.includes("- Classification: new-project-opportunity"));
  assert.ok(markdown.includes("- Complexity risk: 2"));
  assert.ok(markdown.includes("- Source URLs: mock://agentic"));
  assert.ok(markdown.includes("- Should enter validate? yes / no / watch"));
  assert.equal(fs.readFileSync(poolPath, "utf8"), poolContent);
  assert.equal(markdown.includes("do-not-read-this"), false);
});

test("generateOpportunityReview gives a clear error when the opportunity pool is missing", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-opp-review-missing-"));

  assert.throws(
    () => generateOpportunityReview({ rootDir, date: "2026-06-30" }),
    /Opportunity pool JSON not found/
  );
});

test("generateOpportunityReview does not overwrite an existing review unless forced", () => {
  const { rootDir } = createPoolFixture();
  const reviewPath = path.join(rootDir, "opportunities", "reviews", "2026-06-30-opportunity-review.md");
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(reviewPath, "existing review");

  assert.throws(
    () => generateOpportunityReview({ rootDir, date: "2026-06-30" }),
    /Opportunity review already exists/
  );
  assert.equal(fs.readFileSync(reviewPath, "utf8"), "existing review");

  generateOpportunityReview({ rootDir, date: "2026-06-30", force: true });
  assert.notEqual(fs.readFileSync(reviewPath, "utf8"), "existing review");
});
