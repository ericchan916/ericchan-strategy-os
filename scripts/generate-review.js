#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

const FEEDBACK_SECTIONS = {
  "Accepted Suggestions": "acceptedSuggestions",
  "Watched Suggestions": "watchedSuggestions",
  "Rejected Suggestions": "rejectedSuggestions",
  "Actions Actually Taken": "actionsActuallyTaken",
  "What Was Useful": "usefulParts",
  "What Was Noise": "noiseParts",
  "Context Updates Needed": "contextUpdateSuggestions",
  "Prompt Updates Needed": "promptUpdateSuggestions"
};

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

function parseFeedbackSections(feedbackText) {
  const sections = {};
  let current = null;

  for (const line of feedbackText.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  return Object.fromEntries(
    Object.entries(FEEDBACK_SECTIONS).map(([heading, key]) => [
      key,
      normalizeFeedbackLines(sections[heading] || [])
    ])
  );
}

function normalizeFeedbackLines(lines) {
  return lines
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line && !/^TODO$/i.test(line) && !/^N\/A$/i.test(line));
}

function buildNextReportInstructions(feedback) {
  const instructions = [];

  for (const item of feedback.contextUpdateSuggestions) {
    instructions.push(`Context candidate: ${item}`);
  }
  for (const item of feedback.promptUpdateSuggestions) {
    instructions.push(`Prompt candidate: ${item}`);
  }
  for (const item of feedback.noiseParts) {
    instructions.push(`Reduce noise: ${item}`);
  }
  for (const item of feedback.rejectedSuggestions) {
    instructions.push(`Avoid repeating rejected suggestion: ${item}`);
  }
  for (const item of feedback.acceptedSuggestions) {
    instructions.push(`Preserve useful direction: ${item}`);
  }

  return instructions.length
    ? instructions
    : ["No concrete human feedback captured yet; keep the next report tightly bound to EricChan projects and ask for explicit accept/watch/reject feedback."];
}

function assessUsefulness(feedback, reportJson) {
  if (feedback.acceptedSuggestions.length || feedback.actionsActuallyTaken.length || feedback.usefulParts.length) {
    return "useful";
  }
  if (feedback.rejectedSuggestions.length || feedback.noiseParts.length) {
    return "mixed";
  }
  if (reportJson.qualityValidation?.ok) {
    return "structurally valid, awaiting human judgment";
  }
  return "needs review";
}

function recommendNextStage(feedback) {
  const hasSignal =
    feedback.acceptedSuggestions.length ||
    feedback.watchedSuggestions.length ||
    feedback.rejectedSuggestions.length ||
    feedback.actionsActuallyTaken.length ||
    feedback.usefulParts.length ||
    feedback.noiseParts.length;

  return {
    status: "not-yet",
    reason: hasSignal
      ? "Use this feedback to manually update context/prompt first; Stage 1B Dashboard should wait for repeated review patterns."
      : "Feedback exists but has no concrete judgment yet; continue Stage 1A before considering the next stage."
  };
}

function reviewPaths(rootDir, date) {
  return {
    reportPath: path.join(rootDir, "reports", `${date}.md`),
    reportJsonPath: path.join(rootDir, "data", "reports", `${date}.json`),
    feedbackPath: path.join(rootDir, "feedback", `${date}.md`),
    markdownPath: path.join(rootDir, "reviews", `${date}-review.md`),
    jsonPath: path.join(rootDir, "data", "reviews", `${date}-review.json`)
  };
}

function renderReviewMarkdown(review) {
  return `# EricChan·战略OS Daily Review - ${review.date}

## 1. 今日报告是否有用

${review.usefulnessAssessment}

## 2. 被接受的建议

${renderList(review.acceptedSuggestions)}

## 3. 被观察的建议

${renderList(review.watchedSuggestions)}

## 4. 被拒绝的建议

${renderList(review.rejectedSuggestions)}

## 5. 实际采取的行动

${renderList(review.actionsActuallyTaken)}

## 6. 噪声与误判

${renderList(review.noiseParts)}

## 7. context.md 更新建议

${renderList(review.contextUpdateSuggestions)}

## 8. prompt 更新建议

${renderList(review.promptUpdateSuggestions)}

## 9. 明日生成报告应注意什么

${renderList(review.nextReportInstructions)}

## 10. 是否建议进入下一阶段

- 状态：${review.nextStageRecommendation.status}
- 理由：${review.nextStageRecommendation.reason}
`;
}

function renderList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- 暂无";
}

function generateReview({ rootDir = process.cwd(), date = getDateString(), force = false } = {}) {
  const paths = reviewPaths(rootDir, date);
  const reportMarkdown = readRequired(paths.reportPath, "Markdown report");
  const reportJson = readJsonRequired(paths.reportJsonPath, "JSON report");
  const feedbackText = readRequired(paths.feedbackPath, "Feedback file");

  if (!force && (fs.existsSync(paths.markdownPath) || fs.existsSync(paths.jsonPath))) {
    throw new Error(`Review already exists for ${date}. Use --force to overwrite.`);
  }

  const feedback = parseFeedbackSections(feedbackText);
  const review = {
    date,
    generatedAt: new Date().toISOString(),
    feedbackRead: true,
    reportPath: paths.reportPath,
    reportJsonPath: paths.reportJsonPath,
    feedbackPath: paths.feedbackPath,
    reportMode: reportJson.mode || "unknown",
    reportQualityScore:
      reportJson.qualityValidation?.score !== undefined && reportJson.qualityValidation?.maxScore !== undefined
        ? `${reportJson.qualityValidation.score}/${reportJson.qualityValidation.maxScore}`
        : "not available",
    reportWarnings: reportJson.warnings || [],
    reportMarkdownBytes: Buffer.byteLength(reportMarkdown),
    ...feedback,
    usefulnessAssessment: assessUsefulness(feedback, reportJson),
    nextReportInstructions: buildNextReportInstructions(feedback),
    nextStageRecommendation: recommendNextStage(feedback)
  };
  const markdown = renderReviewMarkdown(review);

  ensureDir(path.dirname(paths.markdownPath));
  ensureDir(path.dirname(paths.jsonPath));
  fs.writeFileSync(paths.markdownPath, markdown);
  fs.writeFileSync(paths.jsonPath, JSON.stringify(review, null, 2));

  return {
    review,
    markdown,
    markdownPath: paths.markdownPath,
    jsonPath: paths.jsonPath,
    feedbackPath: paths.feedbackPath,
    created: true
  };
}

function printSummary(result) {
  console.log("Daily review summary");
  console.log(`Date: ${result.review.date}`);
  console.log(`Feedback read: ${result.review.feedbackRead ? "yes" : "no"}`);
  console.log(`Report mode: ${result.review.reportMode}`);
  console.log(`Report quality score: ${result.review.reportQualityScore}`);
  console.log(`Review markdown: ${result.markdownPath}`);
  console.log(`Review JSON: ${result.jsonPath}`);
  console.log(`Next stage: ${result.review.nextStageRecommendation.status}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(generateReview({ rootDir: process.cwd(), date, force: args.includes("--force") }));
  } catch (error) {
    console.error(`Daily review failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateReview,
  parseFeedbackSections,
  renderReviewMarkdown
};
