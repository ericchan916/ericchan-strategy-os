const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { generateOpportunityValidationPack } = require("../scripts/generate-opportunity-validation-pack");

function poolOpportunity(overrides = {}) {
  return {
    id: "opp-independent-ai-opportunity-brief-mvp-agentic-pla-040d67ce",
    createdAt: "2026-07-03T08:32:42.278Z",
    updatedAt: "2026-07-03T11:28:25.912Z",
    status: "validate",
    opportunityName: "Independent AI opportunity brief MVP",
    sourceTrend: "Agentic planning and tool use",
    sourceReportDate: "2026-07-03",
    sourceReportDates: ["2026-07-03"],
    classification: "new-project-opportunity",
    whyItMatters: "把趋势翻译成可验证、可变现的新项目机会，符合 Strategy OS 的新定位。",
    monetizationPotential: "medium-high: niche paid brief, consulting intake, or productized research workflow",
    ericChanFit: "high: uses EricChan's synthesis taste, AI workflow fluency, and restrained product judgment",
    mvpForm: "Markdown-based weekly opportunity brief plus manual scoring table",
    firstValidationAction: "Pick one niche audience and produce one paid-style sample brief for human review.",
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
    tags: [],
    evidence: "Original evidence must remain.",
    sourceUrls: [],
    notes: "",
    humanDecision: "accepted",
    reviewReason: "This is a real external opportunity.",
    reviewNextAction: "Generate one sample brief first.",
    reviewInternalSystemImprovement: false,
    ...overrides
  };
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-validation-pack-"));
  const poolJsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const pool = {
    version: 1,
    updatedAt: "2026-07-03T11:28:25.912Z",
    opportunities: [
      poolOpportunity(),
      poolOpportunity({
        id: "opp-opportunity-scoring-quality-gate-long-context-mo-55b44cb3",
        status: "watch",
        opportunityName: "Opportunity scoring quality gate",
        humanDecision: "watching",
        reviewInternalSystemImprovement: true
      })
    ]
  };
  fs.mkdirSync(path.dirname(poolJsonPath), { recursive: true });
  fs.writeFileSync(poolJsonPath, JSON.stringify(pool, null, 2));
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");
  return {
    rootDir,
    poolJsonPath,
    poolContent: fs.readFileSync(poolJsonPath, "utf8")
  };
}

test("generateOpportunityValidationPack reads the validate accepted opportunity and skips watch opportunities", () => {
  const fixture = createFixture();

  const result = generateOpportunityValidationPack({ rootDir: fixture.rootDir, date: "2026-07-03" });
  const markdown = fs.readFileSync(result.validationPackPath, "utf8");

  assert.equal(result.opportunity.opportunityName, "Independent AI opportunity brief MVP");
  assert.equal(result.skippedCount, 1);
  assert.ok(markdown.includes("# Opportunity Validation Pack"));
  assert.ok(markdown.includes("## 2. Target User Hypotheses"));
  assert.ok(markdown.includes("独立开发者"));
  assert.ok(markdown.includes("## 4. Sample Opportunity Brief"));
  assert.ok(markdown.includes("trend signal"));
  assert.ok(markdown.includes("## 6. Validation Scorecard"));
  assert.ok(markdown.includes("problem clarity"));
  assert.ok(markdown.includes("## 7. Pass / Fail Criteria"));
  assert.ok(markdown.includes("## 8. Recommended Next Action"));
  assert.equal(markdown.includes("Opportunity scoring quality gate"), false);
  assert.equal(markdown.includes("do-not-read-this"), false);
  assert.equal(fs.readFileSync(fixture.poolJsonPath, "utf8"), fixture.poolContent);
});

test("generateOpportunityValidationPack does not overwrite an existing pack unless forced", () => {
  const fixture = createFixture();
  const existingPath = path.join(
    fixture.rootDir,
    "opportunities",
    "validation",
    "2026-07-03-independent-ai-opportunity-brief-validation.md"
  );
  fs.mkdirSync(path.dirname(existingPath), { recursive: true });
  fs.writeFileSync(existingPath, "existing validation pack");

  assert.throws(
    () => generateOpportunityValidationPack({ rootDir: fixture.rootDir, date: "2026-07-03" }),
    /Validation pack already exists/
  );
  assert.equal(fs.readFileSync(existingPath, "utf8"), "existing validation pack");

  generateOpportunityValidationPack({ rootDir: fixture.rootDir, date: "2026-07-03", force: true });
  assert.notEqual(fs.readFileSync(existingPath, "utf8"), "existing validation pack");
});

test("generateOpportunityValidationPack can target a specific opportunity and refuses non-validate items", () => {
  const fixture = createFixture();

  const targeted = generateOpportunityValidationPack({
    rootDir: fixture.rootDir,
    date: "2026-07-03",
    opportunityName: "Independent AI opportunity brief MVP"
  });
  assert.equal(targeted.opportunity.opportunityName, "Independent AI opportunity brief MVP");

  assert.throws(
    () =>
      generateOpportunityValidationPack({
        rootDir: fixture.rootDir,
        date: "2026-07-03",
        opportunityName: "Opportunity scoring quality gate",
        force: true
      }),
    /No validate\/accepted opportunity found/
  );
});
