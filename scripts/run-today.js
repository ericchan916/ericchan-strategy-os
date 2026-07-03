#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");
const { runDailyReport } = require("./run-daily-report");
const { updateOpportunityPool } = require("./update-opportunity-pool");
const { validateOpportunityPool } = require("./validate-opportunity-pool");
const { generateDailyCommand } = require("./generate-daily-command");

function validateOpportunityPoolFile({ rootDir = process.cwd() } = {}) {
  const poolPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const pool = JSON.parse(fs.readFileSync(poolPath, "utf8"));
  return validateOpportunityPool(pool);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readExistingDailyCommandState({ rootDir, date }) {
  const dailyCommandJsonPath = path.join(rootDir, "data", "daily-command", `${date}.json`);
  const reportJsonPath = path.join(rootDir, "data", "reports", `${date}.json`);
  const dailyCommand = readJsonIfExists(dailyCommandJsonPath);
  const report = dailyCommand ? null : readJsonIfExists(reportJsonPath);
  const sourceMode = dailyCommand?.sourceMode || report?.mode || "unknown";
  const recommendedActionCount = Array.isArray(dailyCommand?.recommendedActions)
    ? dailyCommand.recommendedActions.length
    : Array.isArray(report?.recommendedActions)
      ? report.recommendedActions.length
      : 0;

  return {
    sourceMode,
    recommendedActionCount,
    dailyCommandJsonPath
  };
}

async function runToday({
  rootDir = process.cwd(),
  date = getDateString(),
  force = false,
  impl = {}
} = {}) {
  const runDaily = impl.runDailyReport || runDailyReport;
  const updatePool = impl.updateOpportunityPool || updateOpportunityPool;
  const validatePool = impl.validateOpportunityPoolFile || validateOpportunityPoolFile;
  const generateCommand = impl.generateDailyCommand || generateDailyCommand;

  let dailyResult;
  try {
    dailyResult = await runDaily({ rootDir, date });
  } catch (error) {
    throw new Error(`Daily run failed: ${error.message}`);
  }

  let poolUpdate;
  try {
    poolUpdate = updatePool({ rootDir, date });
  } catch (error) {
    throw new Error(`Opportunity pool update failed: ${error.message}`);
  }

  const validation = validatePool({ rootDir, date });
  if (!validation.ok) {
    throw new Error(`Opportunity pool validation failed: ${validation.failures.join("; ")}`);
  }

  let commandResult;
  try {
    commandResult = generateCommand({ rootDir, date, force });
  } catch (error) {
    if (/Daily Command already exists/i.test(error.message)) {
      const existing = readExistingDailyCommandState({ rootDir, date });
      return {
        date,
        reportGenerated: true,
        opportunityPoolUpdated: true,
        dailyCommandGenerated: false,
        dailyCommandAlreadyExists: true,
        dailyCommandPreserved: true,
        opportunitiesImported: poolUpdate.imported || 0,
        noNewOpportunitiesToday: (poolUpdate.imported || 0) === 0,
        sourceMode: existing.sourceMode,
        recommendedActionCount: existing.recommendedActionCount,
        dailyCommandPath: path.join(rootDir, "daily-command", `${date}.md`),
        dailyCommandJsonPath: existing.dailyCommandJsonPath,
        dailyCommandHint: "npm run today -- --force",
        mockFallback: existing.sourceMode === "mock",
        dailyResult,
        poolUpdate,
        validation,
        commandResult: null
      };
    }
    throw new Error(`Daily Command generation failed: ${error.message}`);
  }

  return {
    date,
    reportGenerated: true,
    opportunityPoolUpdated: true,
    dailyCommandGenerated: true,
    dailyCommandAlreadyExists: false,
    dailyCommandPreserved: false,
    opportunitiesImported: poolUpdate.imported || 0,
    noNewOpportunitiesToday: (poolUpdate.imported || 0) === 0,
    sourceMode: commandResult.command.sourceMode,
    recommendedActionCount: commandResult.command.recommendedActions.length,
    dailyCommandPath: commandResult.markdownPath,
    dailyCommandJsonPath: commandResult.jsonPath,
    dailyCommandHint: "npm run today -- --force",
    mockFallback: commandResult.command.sourceMode === "mock",
    dailyResult,
    poolUpdate,
    validation,
    commandResult
  };
}

function printSummary(result) {
  console.log("Today summary");
  console.log(`Report generated: ${result.reportGenerated ? "yes" : "no"}`);
  console.log(`Opportunity pool updated: ${result.opportunityPoolUpdated ? "yes" : "no"}`);
  console.log(`Opportunities imported: ${result.opportunitiesImported}`);
  if (result.noNewOpportunitiesToday) console.log("No new opportunities today: yes");
  console.log(`Daily Command generated: ${result.dailyCommandGenerated ? "yes" : "no"}`);
  console.log(`Daily Command already exists: ${result.dailyCommandAlreadyExists ? "yes" : "no"}`);
  console.log(`Preserved existing file: ${result.dailyCommandPreserved ? "yes" : "no"}`);
  console.log(`sourceMode: ${result.sourceMode}`);
  console.log(`Today's action count: ${result.recommendedActionCount}`);
  console.log(`Daily Command: ${result.dailyCommandPath}`);
  console.log(`Hint: ${result.dailyCommandHint || "npm run today -- --force"}`);
  if (result.mockFallback) {
    console.log("Mock fallback: yes - today's command came from a mock-mode report.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(await runToday({ rootDir: process.cwd(), date, force: args.includes("--force") }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runToday,
  validateOpportunityPoolFile
};
