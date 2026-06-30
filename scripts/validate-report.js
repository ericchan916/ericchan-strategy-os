#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString, validateReportQuality } = require("./generate-report");

const reportPath = process.argv[2] || path.join(process.cwd(), "data", "reports", `${getDateString()}.json`);

try {
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const result = validateReportQuality(report);

  console.log(`Report: ${reportPath}`);
  console.log(`Quality score: ${result.score}/${result.maxScore}`);

  if (result.failures.length) {
    console.log("Failures:");
    for (const failure of result.failures) console.log(`- ${failure}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Report validation failed: ${error.message}`);
  process.exitCode = 1;
}
