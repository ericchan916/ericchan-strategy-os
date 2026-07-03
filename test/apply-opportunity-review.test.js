const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { applyOpportunityReview } = require("../scripts/apply-opportunity-review");

function poolOpportunity(overrides = {}) {
  return {
    id: "opp-independent-ai-opportunity-brief-mvp-agentic-pla-040d67ce",
    createdAt: "2026-07-03T08:32:42.278Z",
    updatedAt: "2026-07-03T08:36:11.617Z",
    status: "inbox",
    opportunityName: "Independent AI opportunity brief MVP",
    sourceTrend: "Agentic planning and tool use",
    sourceReportDate: "2026-07-03",
    sourceReportDates: ["2026-07-03"],
    classification: "new-project-opportunity",
    whyItMatters: "Test why it matters.",
    monetizationPotential: "medium-high",
    ericChanFit: "high",
    mvpForm: "Markdown-based weekly opportunity brief",
    firstValidationAction: "Generate one sample brief.",
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
    notes: "Keep my notes.",
    humanDecision: "pending",
    ...overrides
  };
}

function createFixture(reviewMarkdown) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-apply-review-"));
  const poolJsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const reviewPath = path.join(rootDir, "opportunities", "reviews", "2026-07-03-opportunity-review.md");
  const pool = {
    version: 1,
    updatedAt: "2026-07-03T08:36:11.618Z",
    opportunities: [
      poolOpportunity(),
      poolOpportunity({
        id: "opp-opportunity-scoring-quality-gate-long-context-mo-55b44cb3",
        opportunityName: "Opportunity scoring quality gate",
        sourceTrend: "Long-context model workflows",
        classification: "new-project-opportunity",
        notes: "",
        evidence: "Internal improvement evidence."
      })
    ]
  };

  fs.mkdirSync(path.dirname(poolJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  fs.writeFileSync(poolJsonPath, JSON.stringify(pool, null, 2));
  fs.writeFileSync(path.join(rootDir, "opportunities", "opportunity-pool.md"), "pool md placeholder");
  fs.writeFileSync(reviewPath, reviewMarkdown);
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");

  return {
    rootDir,
    poolJsonPath,
    reviewPath
  };
}

function reviewMarkdown(overrides = {}) {
  const first = {
    status: "validate",
    humanDecision: "accepted",
    internal: "no",
    reason: "This is a real external opportunity.",
    nextAction: "Generate one sample brief.",
    ...overrides.first
  };
  const second = {
    status: "watch",
    humanDecision: "watching",
    internal: "yes",
    reason: "This is an internal system improvement.",
    nextAction: "Keep watching quality impact.",
    ...overrides.second
  };
  return `# EricChan·战略OS Opportunity Review - 2026-07-03

## Opportunity: Independent AI opportunity brief MVP

### Human Review

- Is this a real new project opportunity? yes
- Is this only an internal system improvement? ${first.internal}
- Should enter validate? yes
- Suggested status: ${first.status}
- Suggested humanDecision: ${first.humanDecision}
- Reason: ${first.reason}
- Next action: ${first.nextAction}

## Opportunity: Opportunity scoring quality gate

### Human Review

- Is this a real new project opportunity? no
- Is this only an internal system improvement? ${second.internal}
- Should enter validate? watch
- Suggested status: ${second.status}
- Suggested humanDecision: ${second.humanDecision}
- Reason: ${second.reason}
- Next action: ${second.nextAction}
`;
}

test("applyOpportunityReview writes back status and humanDecision without overwriting notes or evidence", () => {
  const fixture = createFixture(reviewMarkdown());

  const result = applyOpportunityReview({ rootDir: fixture.rootDir, date: "2026-07-03" });
  const pool = JSON.parse(fs.readFileSync(fixture.poolJsonPath, "utf8"));
  const first = pool.opportunities[0];
  const second = pool.opportunities[1];
  const markdown = fs.readFileSync(path.join(fixture.rootDir, "opportunities", "opportunity-pool.md"), "utf8");

  assert.equal(result.updatedCount, 2);
  assert.equal(first.status, "validate");
  assert.equal(first.humanDecision, "accepted");
  assert.equal(first.notes, "Keep my notes.");
  assert.equal(first.evidence, "Original evidence must remain.");
  assert.equal(first.reviewReason, "This is a real external opportunity.");
  assert.equal(first.reviewNextAction, "Generate one sample brief.");
  assert.equal(second.status, "watch");
  assert.equal(second.humanDecision, "watching");
  assert.equal(second.reviewReason, "This is an internal system improvement.");
  assert.ok(markdown.includes("### Independent AI opportunity brief MVP"));
  assert.ok(markdown.includes("status: validate"));
  assert.equal(markdown.includes("do-not-read-this"), false);
});

test("applyOpportunityReview fails on invalid status", () => {
  const fixture = createFixture(reviewMarkdown({ first: { status: "ship-it" } }));

  assert.throws(
    () => applyOpportunityReview({ rootDir: fixture.rootDir, date: "2026-07-03" }),
    /Invalid suggested status/
  );
});

test("applyOpportunityReview fails on invalid humanDecision", () => {
  const fixture = createFixture(reviewMarkdown({ first: { humanDecision: "maybe" } }));

  assert.throws(
    () => applyOpportunityReview({ rootDir: fixture.rootDir, date: "2026-07-03" }),
    /Invalid suggested humanDecision/
  );
});

test("applyOpportunityReview leaves opportunities unchanged when Human Review is still the template", () => {
  const fixture = createFixture(`## Opportunity: Independent AI opportunity brief MVP

### Human Review

- Is this a real new project opportunity? yes / no / unsure
- Is this only an internal system improvement? yes / no / unsure
- Should enter validate? yes / no / watch
- Suggested status: inbox / watch / validate / rejected
- Suggested humanDecision: pending / accepted / watching / rejected
- Reason:
- Next action:
`);

  const before = fs.readFileSync(fixture.poolJsonPath, "utf8");
  const result = applyOpportunityReview({ rootDir: fixture.rootDir, date: "2026-07-03" });
  const after = fs.readFileSync(fixture.poolJsonPath, "utf8");

  assert.equal(result.updatedCount, 0);
  assert.equal(after.includes("reviewReason"), false);
  assert.equal(before, after);
});

test("applyOpportunityReview blocks validate plus rejected and rejected plus accepted", () => {
  const invalidValidate = createFixture(reviewMarkdown({ first: { status: "validate", humanDecision: "rejected" } }));
  assert.throws(
    () => applyOpportunityReview({ rootDir: invalidValidate.rootDir, date: "2026-07-03" }),
    /status=validate requires humanDecision accepted or watching/
  );

  const invalidRejected = createFixture(reviewMarkdown({ first: { status: "rejected", humanDecision: "accepted" } }));
  assert.throws(
    () => applyOpportunityReview({ rootDir: invalidRejected.rootDir, date: "2026-07-03" }),
    /status=rejected requires humanDecision rejected/
  );
});

test("applyOpportunityReview blocks internal improvements from entering mvp-spec or building", () => {
  const fixture = createFixture(reviewMarkdown({ second: { status: "building", humanDecision: "accepted" } }));

  assert.throws(
    () => applyOpportunityReview({ rootDir: fixture.rootDir, date: "2026-07-03" }),
    /Internal system improvement cannot move directly to mvp-spec or building/
  );
});
