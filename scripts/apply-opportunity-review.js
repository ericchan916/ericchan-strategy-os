#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");
const { HUMAN_DECISIONS, STATUSES, renderOpportunityPoolMarkdown } = require("./update-opportunity-pool");

const BLOCKED_INTERNAL_STATUSES = new Set(["mvp-spec", "building"]);
const VALIDATE_DECISIONS = new Set(["accepted", "watching"]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function pathsFor(rootDir, date) {
  return {
    reviewPath: path.join(rootDir, "opportunities", "reviews", `${date}-opportunity-review.md`),
    poolJsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    poolMarkdownPath: path.join(rootDir, "opportunities", "opportunity-pool.md")
  };
}

function parseChoice(value) {
  const text = String(value || "").trim();
  if (!text || text.includes("/")) return null;
  return text;
}

function parseOpportunityReview(markdown) {
  const sections = markdown.split(/^## Opportunity:\s+/m).slice(1);
  return sections.map((section) => {
    const firstBreak = section.search(/\r?\n/);
    const opportunityName = firstBreak >= 0 ? section.slice(0, firstBreak).trim() : section.trim();
    const block = firstBreak >= 0 ? section.slice(firstBreak + 1) : "";
    return parseOpportunityBlock(opportunityName, block);
  });
}

function parseOpportunityBlock(opportunityName, block) {
  const humanReviewMatch = block.match(/### Human Review\r?\n([\s\S]*)$/m);
  if (!humanReviewMatch) {
    return {
      opportunityName,
      hasHumanReview: false
    };
  }

  const review = {};
  for (const line of humanReviewMatch[1].split(/\r?\n/)) {
    const bullet = line.match(/^-\s+(.+?)(?:\?|:)\s*(.*)$/);
    if (!bullet) continue;
    review[bullet[1].trim()] = bullet[2].trim();
  }

  return {
    opportunityName,
    hasHumanReview: true,
    isInternalSystemImprovement: parseChoice(review["Is this only an internal system improvement"]),
    suggestedStatus: parseChoice(review["Suggested status"]),
    suggestedHumanDecision: parseChoice(review["Suggested humanDecision"]),
    reviewReason: review["Reason"] || "",
    reviewNextAction: review["Next action"] || ""
  };
}

function validateParsedReview(entry) {
  if (!entry.hasHumanReview || (!entry.suggestedStatus && !entry.suggestedHumanDecision)) return;
  if (!entry.suggestedStatus || !STATUSES.has(entry.suggestedStatus)) {
    throw new Error(`Invalid suggested status for "${entry.opportunityName}": ${entry.suggestedStatus || "missing"}`);
  }
  if (!entry.suggestedHumanDecision || !HUMAN_DECISIONS.has(entry.suggestedHumanDecision)) {
    throw new Error(`Invalid suggested humanDecision for "${entry.opportunityName}": ${entry.suggestedHumanDecision || "missing"}`);
  }
  if (entry.isInternalSystemImprovement === "yes" && BLOCKED_INTERNAL_STATUSES.has(entry.suggestedStatus)) {
    throw new Error(`Internal system improvement cannot move directly to mvp-spec or building: ${entry.opportunityName}`);
  }
  if (entry.suggestedStatus === "validate" && !VALIDATE_DECISIONS.has(entry.suggestedHumanDecision)) {
    throw new Error(`status=validate requires humanDecision accepted or watching: ${entry.opportunityName}`);
  }
  if (entry.suggestedStatus === "rejected" && entry.suggestedHumanDecision !== "rejected") {
    throw new Error(`status=rejected requires humanDecision rejected: ${entry.opportunityName}`);
  }
}

function applyOpportunityReview({ rootDir = process.cwd(), date = getDateString() } = {}) {
  const paths = pathsFor(rootDir, date);
  const reviewMarkdown = readRequired(paths.reviewPath, "Opportunity review");
  const pool = JSON.parse(readRequired(paths.poolJsonPath, "Opportunity pool JSON"));
  const entries = parseOpportunityReview(reviewMarkdown);
  const warnings = [];
  const candidates = [];

  for (const entry of entries) {
    validateParsedReview(entry);
    if (!entry.hasHumanReview || (!entry.suggestedStatus && !entry.suggestedHumanDecision)) continue;

    const match = (pool.opportunities || []).find((item) => normalize(item.opportunityName) === normalize(entry.opportunityName));
    if (!match) {
      warnings.push(`No pool match for review opportunity: ${entry.opportunityName}`);
      continue;
    }

    candidates.push({ entry, id: match.id });
  }

  let updatedCount = 0;
  const updates = [];
  for (const candidate of candidates) {
    const index = pool.opportunities.findIndex((item) => item.id === candidate.id);
    if (index < 0) continue;

    const existing = pool.opportunities[index];
    const updated = {
      ...existing,
      status: candidate.entry.suggestedStatus,
      humanDecision: candidate.entry.suggestedHumanDecision,
      reviewReason: candidate.entry.reviewReason || existing.reviewReason || "",
      reviewNextAction: candidate.entry.reviewNextAction || existing.reviewNextAction || "",
      reviewInternalSystemImprovement: candidate.entry.isInternalSystemImprovement === "yes",
      updatedAt: new Date().toISOString()
    };

    pool.opportunities[index] = updated;
    updatedCount += 1;
    updates.push({
      opportunityName: updated.opportunityName,
      status: updated.status,
      humanDecision: updated.humanDecision
    });
  }

  if (updatedCount > 0) {
    pool.updatedAt = new Date().toISOString();
    fs.writeFileSync(paths.poolJsonPath, JSON.stringify(pool, null, 2));
    fs.writeFileSync(paths.poolMarkdownPath, renderOpportunityPoolMarkdown(pool));
  }

  return {
    date,
    reviewPath: paths.reviewPath,
    poolJsonPath: paths.poolJsonPath,
    poolMarkdownPath: paths.poolMarkdownPath,
    updatedCount,
    updates,
    warnings
  };
}

function printSummary(result) {
  console.log("Opportunity review apply summary");
  console.log(`Date: ${result.date}`);
  console.log(`Review markdown: ${result.reviewPath}`);
  console.log(`Updated opportunities: ${result.updatedCount}`);
  for (const item of result.updates) {
    console.log(`- ${item.opportunityName}: ${item.status} / ${item.humanDecision}`);
  }
  if (result.warnings.length) {
    console.log("Warnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
  console.log(`Pool JSON: ${result.poolJsonPath}`);
  console.log(`Pool markdown: ${result.poolMarkdownPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(applyOpportunityReview({ rootDir: process.cwd(), date }));
  } catch (error) {
    console.error(`Opportunity review apply failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applyOpportunityReview,
  parseOpportunityReview
};
