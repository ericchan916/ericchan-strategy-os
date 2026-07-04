const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildPatch,
  loadOpportunityPool,
  normalizeOpportunity,
  saveOpportunityPool,
  updateOpportunity
} = require("../scripts/opportunity-store");

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-store-"));
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-07-03T00:00:00.000Z",
        opportunities: [
          {
            id: "opp-1",
            opportunityName: "Independent AI opportunity brief MVP",
            status: "validate",
            humanDecision: "accepted",
            notes: "old",
            tags: ["ai"],
            unknownField: "keep"
          }
        ]
      },
      null,
      2
    )
  );
  return { rootDir, jsonPath };
}

test("loadOpportunityPool reads JSON and normalizes Chinese status labels", () => {
  const { rootDir } = fixture();
  const result = loadOpportunityPool({ rootDir });

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].statusLabel, "待验证");
  assert.equal(result.opportunities[0].humanDecisionLabel, "已确认");
  assert.equal(result.stats.total, 1);
  assert.equal(result.stats.validate, 1);
});

test("normalizeOpportunity preserves unknown fields while adding UI labels", () => {
  const item = normalizeOpportunity({ id: "x", status: "watch", humanDecision: "watching", unknown: "keep" });

  assert.equal(item.statusLabel, "观察中");
  assert.equal(item.humanDecisionLabel, "观察中");
  assert.equal(item.unknown, "keep");
});

test("updateOpportunity only applies whitelisted fields and preserves unknown fields", () => {
  const { rootDir, jsonPath } = fixture();
  const result = updateOpportunity({
    rootDir,
    id: "opp-1",
    patch: {
      status: "watch",
      notes: "new note",
      tags: "agent, brief",
      opportunityName: "should not change",
      filePath: "bad"
    }
  });
  const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  assert.equal(result.opportunity.status, "watch");
  assert.equal(result.opportunity.notes, "new note");
  assert.deepEqual(result.opportunity.tags, ["agent", "brief"]);
  assert.equal(saved.opportunities[0].opportunityName, "Independent AI opportunity brief MVP");
  assert.equal(saved.opportunities[0].unknownField, "keep");
  assert.equal(saved.opportunities[0].statusLabel, undefined);
  assert.equal(saved.opportunities[0].humanDecisionLabel, undefined);
});

test("updateOpportunity returns Chinese error when id is missing", () => {
  const { rootDir } = fixture();

  assert.throws(
    () => updateOpportunity({ rootDir, id: "missing", patch: { status: "watch" } }),
    /没有找到这个机会/
  );
});

test("saveOpportunityPool writes pretty JSON and Markdown", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-save-"));
  const pool = saveOpportunityPool(
    {
      version: 1,
      opportunities: [{ id: "opp-1", opportunityName: "A", status: "inbox", humanDecision: "pending" }]
    },
    { rootDir }
  );
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const mdPath = path.join(rootDir, "opportunities", "opportunity-pool.md");
  const json = fs.readFileSync(jsonPath, "utf8");

  assert.equal(pool.opportunities.length, 1);
  assert.ok(json.includes("\n  \"version\""));
  assert.ok(fs.readFileSync(mdPath, "utf8").includes("EricChan·战略OS Opportunity Pool"));
});

test("buildPatch rejects invalid status and ignores arbitrary path fields", () => {
  assert.throws(() => buildPatch({ status: "bad" }), /状态不合法/);
  assert.deepEqual(buildPatch({ status: "watch", path: "x" }), { status: "watch" });
});
