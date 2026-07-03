#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  ACTIVE_STATUSES,
  HUMAN_DECISIONS,
  SCORE_KEYS,
  STATUSES,
  isLegacyOptimization
} = require("./update-opportunity-pool");

function validScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function validateOpportunityPool(pool) {
  const opportunities = Array.isArray(pool?.opportunities) ? pool.opportunities : [];
  const ids = opportunities.map((item) => item.id).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const failures = [];

  if (!pool || typeof pool !== "object") failures.push("pool is object");
  if (!Array.isArray(pool?.opportunities)) failures.push("opportunities is array");
  if (opportunities.some((item) => !item.id)) failures.push("each opportunity has id");
  if (duplicateIds.length) failures.push("duplicate id does not exist");
  if (opportunities.some((item) => !STATUSES.has(item.status))) failures.push("status is valid");
  if (opportunities.some((item) => !HUMAN_DECISIONS.has(item.humanDecision))) failures.push("humanDecision is valid");
  if (opportunities.some((item) => !SCORE_KEYS.every((key) => validScore(item.scores?.[key])))) {
    failures.push("scores are complete");
  }
  if (opportunities.some((item) => item.status === "building" && item.scores?.complexityRisk >= 4)) {
    failures.push("high complexity opportunities are not building");
  }
  if (opportunities.some((item) => item.status === "validate" && !["accepted", "watching"].includes(item.humanDecision))) {
    failures.push("validate opportunities require accepted or watching humanDecision");
  }
  if (opportunities.some((item) => item.status === "rejected" && item.humanDecision !== "rejected")) {
    failures.push("rejected opportunities require rejected humanDecision");
  }
  if (
    opportunities.some(
      (item) => item.reviewInternalSystemImprovement === true && ["mvp-spec", "building"].includes(item.status)
    )
  ) {
    failures.push("internal system improvements do not jump directly to mvp-spec or building");
  }
  if (opportunities.some((item) => item.shouldIgnore === true && ACTIVE_STATUSES.has(item.status))) {
    failures.push("ignored opportunities are not active");
  }
  if (opportunities.some((item) => ACTIVE_STATUSES.has(item.status) && isLegacyOptimization(item))) {
    failures.push("legacy optimization opportunities are not active");
  }

  return {
    ok: failures.length === 0,
    failures,
    count: opportunities.length
  };
}

function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const explicitPath = args.find((arg) => arg !== "--list");
  const poolPath = explicitPath || path.join(process.cwd(), "data", "opportunities", "opportunity-pool.json");
  try {
    const pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
    if (listOnly) {
      for (const item of pool.opportunities || []) {
        console.log(`${item.status}\t${item.humanDecision}\t${item.opportunityName}`);
      }
      return;
    }
    const result = validateOpportunityPool(pool);
    console.log(`Opportunity pool: ${poolPath}`);
    console.log(`Opportunities: ${result.count}`);
    console.log(`Validation: ${result.ok ? "ok" : "failed"}`);
    if (result.failures.length) {
      console.log("Failures:");
      for (const failure of result.failures) console.log(`- ${failure}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Opportunity pool validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  validateOpportunityPool
};
