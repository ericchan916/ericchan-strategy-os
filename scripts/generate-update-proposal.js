#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJsonRequired(filePath, label) {
  return JSON.parse(readRequired(filePath, label));
}

function proposalPaths(rootDir, date) {
  return {
    reviewJsonPath: path.join(rootDir, "data", "reviews", `${date}-review.json`),
    reviewMarkdownPath: path.join(rootDir, "reviews", `${date}-review.md`),
    proposalPath: path.join(rootDir, "proposals", `${date}-update-proposal.md`)
  };
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function classifyCandidate(text, kind) {
  const lower = text.toLowerCase();
  const isNoise = /generic|noise|too many|过多|泛泛|dashboard|vercel|deploy|push|telegram|wechat/.test(lower);
  const isStable = /strategy os|stage 1a|seven-day|7-day|observation|context|prompt|source quality|data gap/i.test(text);

  return {
    source: kind,
    text,
    reason: isNoise
      ? "This points to a recurring report-quality correction and should be reviewed before becoming a standing rule."
      : "This came from human feedback after a Daily Review and may improve future report quality.",
    stability: isStable ? "stable" : "tentative",
    recommendedAction: isNoise ? "watch" : "apply"
  };
}

function createCandidates(items, sourcePrefix) {
  return items.map((item, index) => classifyCandidate(item, `${sourcePrefix}[${index}]`));
}

function renderCandidate(candidate) {
  return [
    `- ${candidate.text}`,
    `  - source: ${candidate.source}`,
    `  - reason: ${candidate.reason}`,
    `  - stability: ${candidate.stability}`,
    `  - recommendedAction: ${candidate.recommendedAction}`
  ].join("\n");
}

function renderList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderSuggestedPatch(title, candidates) {
  const applied = candidates.filter((item) => item.recommendedAction === "apply");
  if (!applied.length) return `${title}\n\nNo direct patch suggested yet; keep watching signals.`;

  return `${title}\n\n${applied.map((item) => `- ${item.text}`).join("\n")}`;
}

function renderProposalMarkdown(proposal) {
  return `# EricChan·战略OS Update Proposal - ${proposal.date}

## 1. Context Updates Candidate

${proposal.contextUpdates.length ? proposal.contextUpdates.map(renderCandidate).join("\n\n") : "- None"}

## 2. Prompt Updates Candidate

${proposal.promptUpdates.length ? proposal.promptUpdates.map(renderCandidate).join("\n\n") : "- None"}

## 3. Rejected / Noise Signals

${renderList(proposal.rejectedAndNoiseSignals)}

## 4. Suggested Manual Patch

### context.md suggested patch

${renderSuggestedPatch("Add or revise:", proposal.contextUpdates)}

### analysis-prompt.md suggested patch

${renderSuggestedPatch("Add or revise:", proposal.promptUpdates)}

## 5. Human Approval Checklist

- [ ] Approve context updates
- [ ] Approve prompt updates
- [ ] Reject one-off noise
- [ ] Apply manually or ask Codex to apply
`;
}

function generateUpdateProposal({ rootDir = process.cwd(), date = getDateString(), force = false } = {}) {
  const paths = proposalPaths(rootDir, date);
  const review = readJsonRequired(paths.reviewJsonPath, "Review JSON");
  readRequired(paths.reviewMarkdownPath, "Review Markdown");

  if (!force && fs.existsSync(paths.proposalPath)) {
    throw new Error(`Proposal already exists for ${date}. Use --force to overwrite.`);
  }

  const contextUpdates = createCandidates(normalizeList(review.contextUpdateSuggestions), "contextUpdateSuggestions");
  const promptUpdates = createCandidates(normalizeList(review.promptUpdateSuggestions), "promptUpdateSuggestions");
  const noiseParts = normalizeList(review.noiseParts);
  const rejectedSuggestions = normalizeList(review.rejectedSuggestions);
  const nextReportInstructions = normalizeList(review.nextReportInstructions);
  const proposal = {
    date,
    generatedAt: new Date().toISOString(),
    reviewRead: true,
    reviewJsonPath: paths.reviewJsonPath,
    reviewMarkdownPath: paths.reviewMarkdownPath,
    contextUpdates,
    promptUpdates,
    rejectedAndNoiseSignals: [...rejectedSuggestions, ...noiseParts],
    nextReportInstructions
  };
  const markdown = renderProposalMarkdown(proposal);

  ensureDir(path.dirname(paths.proposalPath));
  fs.writeFileSync(paths.proposalPath, markdown);

  return {
    proposal,
    markdown,
    proposalPath: paths.proposalPath,
    created: true
  };
}

function printSummary(result) {
  console.log("Update proposal summary");
  console.log(`Date: ${result.proposal.date}`);
  console.log(`Review read: ${result.proposal.reviewRead ? "yes" : "no"}`);
  console.log(`Context candidates: ${result.proposal.contextUpdates.length}`);
  console.log(`Prompt candidates: ${result.proposal.promptUpdates.length}`);
  console.log(`Rejected/noise signals: ${result.proposal.rejectedAndNoiseSignals.length}`);
  console.log(`Proposal markdown: ${result.proposalPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(generateUpdateProposal({ rootDir: process.cwd(), date, force: args.includes("--force") }));
  } catch (error) {
    console.error(`Update proposal failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateUpdateProposal,
  renderProposalMarkdown
};
