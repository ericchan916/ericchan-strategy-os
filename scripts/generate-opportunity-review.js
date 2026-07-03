#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function reviewPaths(rootDir, date) {
  return {
    poolJsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    reviewPath: path.join(rootDir, "opportunities", "reviews", `${date}-opportunity-review.md`)
  };
}

function renderValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (value === undefined || value === null || value === "") return "None";
  return String(value);
}

function renderOpportunity(item) {
  const scores = item.scores || {};
  return `## Opportunity: ${renderValue(item.opportunityName)}

- Current status: ${renderValue(item.status)}
- Human decision: ${renderValue(item.humanDecision)}
- Source trend: ${renderValue(item.sourceTrend)}
- Classification: ${renderValue(item.classification)}
- Monetization potential: ${renderValue(item.monetizationPotential)}
- EricChan fit: ${renderValue(item.ericChanFit)}
- MVP speed: ${renderValue(scores.mvpSpeed)}
- AI leverage: ${renderValue(scores.aiLeverage)}
- OPC fit: ${renderValue(scores.opcFit)}
- Content asset potential: ${renderValue(scores.contentAssetPotential)}
- Long-term compounding: ${renderValue(scores.longTermCompounding)}
- Complexity risk: ${renderValue(scores.complexityRisk)}
- Current stage fit: ${renderValue(scores.currentStageFit)}
- MVP form: ${renderValue(item.mvpForm)}
- First validation action: ${renderValue(item.firstValidationAction)}
- Recommended agent: ${renderValue(item.recommendedAgent)}
- Evidence: ${renderValue(item.evidence)}
- Source URLs: ${renderValue(item.sourceUrls)}

### Human Review

- Is this a real new project opportunity? yes / no / unsure
- Is this only an internal system improvement? yes / no / unsure
- Should enter validate? yes / no / watch
- Suggested status: inbox / watch / validate / rejected
- Suggested humanDecision: pending / accepted / watching / rejected
- Reason:
- Next action:`;
}

function renderOpportunityReviewMarkdown({ date, generatedAt, pool }) {
  const opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];
  return `# EricChan·战略OS Opportunity Review - ${date}

Generated: ${generatedAt}
Opportunities read: ${opportunities.length}

${opportunities.length ? opportunities.map(renderOpportunity).join("\n\n") : "- No opportunities found."}
`;
}

function generateOpportunityReview({ rootDir = process.cwd(), date = getDateString(), force = false } = {}) {
  const paths = reviewPaths(rootDir, date);
  const pool = readJsonRequired(paths.poolJsonPath, "Opportunity pool JSON");

  if (!force && fs.existsSync(paths.reviewPath)) {
    throw new Error(`Opportunity review already exists for ${date}. Use --force to overwrite.`);
  }

  const markdown = renderOpportunityReviewMarkdown({
    date,
    generatedAt: new Date().toISOString(),
    pool
  });

  ensureDir(path.dirname(paths.reviewPath));
  fs.writeFileSync(paths.reviewPath, markdown);

  return {
    date,
    poolJsonPath: paths.poolJsonPath,
    reviewPath: paths.reviewPath,
    opportunityCount: Array.isArray(pool.opportunities) ? pool.opportunities.length : 0,
    markdown
  };
}

function printSummary(result) {
  console.log("Opportunity review summary");
  console.log(`Date: ${result.date}`);
  console.log(`Opportunities read: ${result.opportunityCount}`);
  console.log(`Opportunity pool JSON: ${result.poolJsonPath}`);
  console.log(`Review markdown: ${result.reviewPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(generateOpportunityReview({ rootDir: process.cwd(), date, force: args.includes("--force") }));
  } catch (error) {
    console.error(`Opportunity review failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateOpportunityReview,
  renderOpportunityReviewMarkdown
};
