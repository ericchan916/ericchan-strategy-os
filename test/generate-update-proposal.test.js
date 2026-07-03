const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { generateUpdateProposal } = require("../scripts/generate-update-proposal");

function createProposalFixture({ withReview = true } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-proposal-"));
  const date = "2026-06-30";

  fs.mkdirSync(path.join(rootDir, "data", "reviews"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "reviews"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");

  if (withReview) {
    fs.writeFileSync(path.join(rootDir, "reviews", `${date}-review.md`), "# EricChan Strategy OS Daily Review\n");
    fs.writeFileSync(
      path.join(rootDir, "data", "reviews", `${date}-review.json`),
      JSON.stringify(
        {
          date,
          contextUpdateSuggestions: ["Add that Strategy OS is in seven-day observation."],
          promptUpdateSuggestions: ["Ask the model to reduce generic tool mentions."],
          noiseParts: ["Too many generic tool mentions."],
          rejectedSuggestions: ["Do not build Dashboard yet."],
          nextReportInstructions: [
            "Context candidate: Add that Strategy OS is in seven-day observation.",
            "Prompt candidate: Ask the model to reduce generic tool mentions.",
            "Reduce noise: Too many generic tool mentions."
          ]
        },
        null,
        2
      )
    );
  }

  return { rootDir, date };
}

test("generateUpdateProposal reads review and writes proposal markdown", () => {
  const { rootDir, date } = createProposalFixture();

  const result = generateUpdateProposal({ rootDir, date });

  assert.equal(result.proposal.date, date);
  assert.equal(result.proposal.reviewRead, true);
  assert.equal(result.proposal.contextUpdates.length, 1);
  assert.equal(result.proposal.promptUpdates.length, 1);
  assert.ok(result.markdown.includes("# EricChan·战略OS Update Proposal - 2026-06-30"));
  assert.ok(result.markdown.includes("## 1. Context Updates Candidate"));
  assert.ok(result.markdown.includes("## 2. Prompt Updates Candidate"));
  assert.ok(result.markdown.includes("## 5. Human Approval Checklist"));
  assert.ok(result.markdown.includes("- [ ] Approve context updates"));
  assert.ok(fs.existsSync(result.proposalPath));
});

test("generateUpdateProposal fails clearly when review is missing", () => {
  const { rootDir, date } = createProposalFixture({ withReview: false });

  assert.throws(
    () => generateUpdateProposal({ rootDir, date }),
    /Review JSON not found/
  );
});

test("generateUpdateProposal does not overwrite existing proposal unless forced", () => {
  const { rootDir, date } = createProposalFixture();
  const proposalsDir = path.join(rootDir, "proposals");
  fs.mkdirSync(proposalsDir, { recursive: true });
  const proposalPath = path.join(proposalsDir, `${date}-update-proposal.md`);
  fs.writeFileSync(proposalPath, "USER PROPOSAL NOTES\n");

  assert.throws(
    () => generateUpdateProposal({ rootDir, date }),
    /Proposal already exists/
  );
  assert.equal(fs.readFileSync(proposalPath, "utf8"), "USER PROPOSAL NOTES\n");

  const result = generateUpdateProposal({ rootDir, date, force: true });
  assert.ok(result.markdown.includes("Update Proposal"));
});

test("generateUpdateProposal output does not leak env content", () => {
  const { rootDir, date } = createProposalFixture();

  const result = generateUpdateProposal({ rootDir, date });
  const markdown = fs.readFileSync(result.proposalPath, "utf8");

  assert.equal(markdown.includes("do-not-read-this"), false);
});
