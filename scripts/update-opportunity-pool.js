#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

const STATUSES = new Set(["inbox", "watch", "validate", "mvp-spec", "building", "archived", "rejected"]);
const HUMAN_DECISIONS = new Set(["pending", "accepted", "watching", "rejected", "done"]);
const SCORE_KEYS = [
  "monetizationPotential",
  "ericChanFit",
  "mvpSpeed",
  "aiLeverage",
  "opcFit",
  "contentAssetPotential",
  "longTermCompounding",
  "complexityRisk",
  "currentStageFit"
];
const ACTIVE_STATUSES = new Set(["validate", "mvp-spec", "building"]);
const LEGACY_OPTIMIZATION_PATTERN = /update\s+iportfolio|update.*personal (biography )?site|rebuild\s+xiaochan|deploy.*legacy|legacy.*deploy|redesign.*personal website|expand.*节律|add features.*节律|优化.*旧项目|重构.*小chan|更新.*iportfolio|部署.*旧项目|扩展.*节律/i;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stableOpportunityId(opportunity) {
  const base = normalize(`${opportunity.opportunityName || opportunity.title} ${opportunity.sourceTrend || opportunity.relatedTrend}`);
  const slug = base
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const hash = crypto.createHash("sha1").update(base).digest("hex").slice(0, 8);
  return `opp-${slug || "opportunity"}-${hash}`;
}

function poolPaths(rootDir) {
  return {
    markdownPath: path.join(rootDir, "opportunities", "opportunity-pool.md"),
    jsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json")
  };
}

function emptyPool() {
  return { version: 1, updatedAt: new Date().toISOString(), opportunities: [] };
}

function textOfOpportunity(item) {
  return [
    item.opportunityName,
    item.title,
    item.sourceTrend,
    item.relatedTrend,
    item.relatedProject,
    item.whyItMatters,
    item.mvpForm,
    item.firstValidationAction
  ]
    .filter(Boolean)
    .join(" ");
}

function isLegacyOptimization(item) {
  return LEGACY_OPTIMIZATION_PATTERN.test(textOfOpportunity(item));
}

function shouldImportOpportunity(item) {
  return item?.enterOpportunityPool === true && item?.shouldIgnore === false && !isLegacyOptimization(item);
}

function createPoolOpportunity(item, reportDate) {
  const now = new Date().toISOString();
  const sourceUrls = Array.isArray(item.sourceUrls) ? item.sourceUrls : [];
  return {
    id: stableOpportunityId(item),
    createdAt: now,
    updatedAt: now,
    status: item.status === "watch" ? "watch" : "inbox",
    opportunityName: item.opportunityName || item.title || "",
    sourceTrend: item.sourceTrend || item.relatedTrend || "",
    sourceReportDate: reportDate,
    sourceReportDates: [reportDate],
    classification: item.classification || "new-project-opportunity",
    whyItMatters: item.whyItMatters || "",
    monetizationPotential: item.monetizationPotential || "",
    ericChanFit: item.ericChanFit || "",
    mvpForm: item.mvpForm || "",
    firstValidationAction: item.firstValidationAction || "",
    recommendedAgent: item.recommendedAgent || "",
    enterOpportunityPool: item.enterOpportunityPool === true,
    needsHumanConfirmation: item.needsHumanConfirmation !== false,
    shouldIgnore: item.shouldIgnore === true,
    scores: item.scores || {},
    tags: Array.isArray(item.tags) ? item.tags : [],
    evidence: item.evidence || item.whyItMatters || "",
    sourceUrls,
    notes: "",
    humanDecision: "pending"
  };
}

function mergeOpportunity(existing, incoming, reportDate) {
  return {
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    status: existing.status || incoming.status,
    sourceReportDate: reportDate,
    sourceReportDates: [...new Set([...(existing.sourceReportDates || [existing.sourceReportDate].filter(Boolean)), reportDate])],
    evidence: [...new Set([existing.evidence, incoming.evidence].filter(Boolean))].join("\n"),
    sourceUrls: [...new Set([...(existing.sourceUrls || []), ...(incoming.sourceUrls || [])])],
    notes: existing.notes || "",
    humanDecision: existing.humanDecision || "pending"
  };
}

function renderOpportunityPoolMarkdown(pool) {
  const sections = [
    ["Inbox", "inbox"],
    ["Watch", "watch"],
    ["Validate", "validate"],
    ["MVP Spec", "mvp-spec"],
    ["Building", "building"],
    ["Archived", "archived"],
    ["Rejected", "rejected"]
  ];

  return `# EricChan·战略OS Opportunity Pool

Updated: ${pool.updatedAt}

${sections.map(([title, status]) => `## ${title}\n\n${renderStatusItems(pool.opportunities.filter((item) => item.status === status))}`).join("\n\n")}
`;
}

function renderStatusItems(items) {
  if (!items.length) return "- None";
  return items
    .map(
      (item) => `### ${item.opportunityName}

- id: ${item.id}
- status: ${item.status}
- monetizationPotential: ${item.monetizationPotential}
- ericChanFit: ${item.ericChanFit}
- mvpSpeed: ${item.scores?.mvpSpeed ?? ""}
- aiLeverage: ${item.scores?.aiLeverage ?? ""}
- opcFit: ${item.scores?.opcFit ?? ""}
- complexityRisk: ${item.scores?.complexityRisk ?? ""}
- mvpForm: ${item.mvpForm}
- firstValidationAction: ${item.firstValidationAction}
- recommendedAgent: ${item.recommendedAgent}
- sourceReportDate: ${(item.sourceReportDates || [item.sourceReportDate]).join(", ")}
- humanDecision: ${item.humanDecision}`
    )
    .join("\n\n");
}

function updateOpportunityPool({ rootDir = process.cwd(), date = getDateString() } = {}) {
  const reportPath = path.join(rootDir, "data", "reports", `${date}.json`);
  if (!fs.existsSync(reportPath)) throw new Error(`Report JSON not found: ${reportPath}`);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const paths = poolPaths(rootDir);
  const pool = readJson(paths.jsonPath, emptyPool());
  pool.version = pool.version || 1;
  pool.opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of report.opportunities || []) {
    if (!shouldImportOpportunity(item)) {
      skipped += 1;
      continue;
    }

    const incoming = createPoolOpportunity(item, report.date || date);
    const existingIndex = pool.opportunities.findIndex((existing) => existing.id === incoming.id);
    if (existingIndex >= 0) {
      pool.opportunities[existingIndex] = mergeOpportunity(pool.opportunities[existingIndex], incoming, report.date || date);
      updated += 1;
    } else {
      pool.opportunities.push(incoming);
      imported += 1;
    }
  }

  pool.updatedAt = new Date().toISOString();
  const markdown = renderOpportunityPoolMarkdown(pool);
  ensureDir(path.dirname(paths.markdownPath));
  ensureDir(path.dirname(paths.jsonPath));
  fs.writeFileSync(paths.markdownPath, markdown);
  fs.writeFileSync(paths.jsonPath, JSON.stringify(pool, null, 2));

  return { pool, markdown, imported, updated, skipped, ...paths };
}

function printSummary(result) {
  console.log("Opportunity pool update summary");
  console.log(`Imported: ${result.imported}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Pool markdown: ${result.markdownPath}`);
  console.log(`Pool JSON: ${result.jsonPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();
  try {
    printSummary(updateOpportunityPool({ rootDir: process.cwd(), date }));
  } catch (error) {
    console.error(`Opportunity pool update failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ACTIVE_STATUSES,
  HUMAN_DECISIONS,
  LEGACY_OPTIMIZATION_PATTERN,
  SCORE_KEYS,
  STATUSES,
  isLegacyOptimization,
  renderOpportunityPoolMarkdown,
  stableOpportunityId,
  updateOpportunityPool
};
