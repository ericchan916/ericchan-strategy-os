#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { generateReport, getDateString, validateReportQuality } = require("./generate-report");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function createDailyFeedback({ rootDir = process.cwd(), date = getDateString(), markdownPath, jsonPath, mode, warnings = [], qualityScore }) {
  const feedbackDir = path.join(rootDir, "feedback");
  const feedbackPath = path.join(feedbackDir, `${date}.md`);
  ensureDir(feedbackDir);

  if (fs.existsSync(feedbackPath)) {
    return { feedbackPath, created: false };
  }

  const templatePath = path.join(rootDir, "templates", "daily-feedback-template.md");
  const template = readText(
    templatePath,
    "# Daily Strategy Feedback\n\n## Report Date\n\n## Accepted Suggestions\n\n## Watched Suggestions\n\n## Rejected Suggestions\n\n## Actions Actually Taken\n\n## What Was Useful\n\n## What Was Noise\n\n## Context Updates Needed\n\n## Prompt Updates Needed\n"
  );
  const metadata = [
    `Date: ${date}`,
    `Report Markdown: ${markdownPath || ""}`,
    `Report JSON: ${jsonPath || ""}`,
    `Quality score: ${qualityScore || "not available"}`,
    `Mode: ${mode || "unknown"}`,
    `Warnings: ${warnings.length ? warnings.join("; ") : "[]"}`
  ].join("\n");

  fs.writeFileSync(feedbackPath, `${template.trim()}\n\n## Daily Run Metadata\n\n${metadata}\n`);
  return { feedbackPath, created: true };
}

function reportPaths(rootDir, date) {
  return {
    markdownPath: path.join(rootDir, "reports", `${date}.md`),
    jsonPath: path.join(rootDir, "data", "reports", `${date}.json`)
  };
}

function createFeedbackOnly({ rootDir = process.cwd(), date = getDateString() } = {}) {
  const paths = reportPaths(rootDir, date);
  const report = readJson(paths.jsonPath, {});
  const score =
    report?.qualityValidation?.score !== undefined && report?.qualityValidation?.maxScore !== undefined
      ? `${report.qualityValidation.score}/${report.qualityValidation.maxScore}`
      : "not available";

  return {
    mode: report?.mode || "unknown",
    warnings: report?.warnings || [],
    qualityScore: score,
    ...paths,
    feedback: createDailyFeedback({
      rootDir,
      date,
      ...paths,
      mode: report?.mode,
      warnings: report?.warnings || [],
      qualityScore: score
    })
  };
}

async function runDailyReport({ rootDir = process.cwd(), date = getDateString(), mock = false } = {}) {
  const generated = await generateReport({ rootDir, date, mock });
  const validation = validateReportQuality(generated.report);
  const qualityScore = `${validation.score}/${validation.maxScore}`;
  const feedback = createDailyFeedback({
    rootDir,
    date,
    markdownPath: generated.markdownPath,
    jsonPath: generated.jsonPath,
    mode: generated.report.mode,
    warnings: generated.report.warnings || [],
    qualityScore
  });

  const result = {
    date,
    mode: generated.report.mode,
    warnings: generated.report.warnings || [],
    qualityScore,
    validation,
    markdownPath: generated.markdownPath,
    jsonPath: generated.jsonPath,
    rawPath: generated.rawPath,
    feedback
  };

  if (!validation.ok) {
    const error = new Error(`Report quality validation failed: ${validation.failures.join("; ")}`);
    error.result = result;
    throw error;
  }

  return result;
}

function printSummary(result) {
  console.log("Daily report summary");
  console.log(`Mode: ${result.mode}`);
  console.log(`Quality score: ${result.qualityScore}`);
  console.log(`Warnings: ${result.warnings.length ? result.warnings.join("; ") : "[]"}`);
  console.log(`Markdown report: ${result.markdownPath}`);
  console.log(`JSON report: ${result.jsonPath}`);
  if (result.rawPath) console.log(`Raw snapshot: ${result.rawPath}`);
  console.log(`Feedback file: ${result.feedback.feedbackPath}`);
  console.log(`Feedback created: ${result.feedback.created ? "yes" : "no, existing file preserved"}`);
}

async function main() {
  const args = process.argv.slice(2);
  const rootDir = process.cwd();
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  if (args.includes("--feedback-only")) {
    printSummary(createFeedbackOnly({ rootDir, date }));
    return;
  }

  try {
    printSummary(await runDailyReport({ rootDir, date, mock: args.includes("--mock") }));
  } catch (error) {
    if (error.result) printSummary(error.result);
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  createDailyFeedback,
  createFeedbackOnly,
  runDailyReport
};
