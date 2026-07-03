const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { generateReview } = require("../scripts/generate-review");

function createReviewFixture({ withFeedback = true } = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-review-"));
  const date = "2026-06-30";

  fs.mkdirSync(path.join(rootDir, "reports"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "data", "reports"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "feedback"), { recursive: true });

  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");
  fs.writeFileSync(path.join(rootDir, "reports", `${date}.md`), "# EricChan Strategy OS Daily Brief\n");
  fs.writeFileSync(
    path.join(rootDir, "data", "reports", `${date}.json`),
    JSON.stringify(
      {
        date,
        mode: "live",
        warnings: [],
        qualityValidation: { ok: true, score: 29, maxScore: 29 },
        qualityChecklist: { bestSuggestion: "Keep source quality focused.", suggestionToIgnore: "Build Dashboard now." }
      },
      null,
      2
    )
  );

  if (withFeedback) {
    fs.writeFileSync(
      path.join(rootDir, "feedback", `${date}.md`),
      `# Daily Strategy Feedback

## Report Date
${date}

## Accepted Suggestions
- Keep source quality focused.

## Watched Suggestions
- Continue OPC data gap tracking.

## Rejected Suggestions
- Do not build Dashboard yet.

## Actions Actually Taken
- Updated one source note manually.

## What Was Useful
- Project binding was concrete.

## What Was Noise
- Too many generic tool mentions.

## Context Updates Needed
- Add that Strategy OS is in seven-day observation.

## Prompt Updates Needed
- Ask the model to reduce generic tool mentions.
`
    );
  }

  return { rootDir, date };
}

test("generateReview reads feedback and writes markdown/json review", () => {
  const { rootDir, date } = createReviewFixture();

  const result = generateReview({ rootDir, date });

  assert.equal(result.review.date, date);
  assert.equal(result.review.feedbackRead, true);
  assert.deepEqual(result.review.acceptedSuggestions, ["Keep source quality focused."]);
  assert.deepEqual(result.review.watchedSuggestions, ["Continue OPC data gap tracking."]);
  assert.deepEqual(result.review.rejectedSuggestions, ["Do not build Dashboard yet."]);
  assert.deepEqual(result.review.actionsActuallyTaken, ["Updated one source note manually."]);
  assert.deepEqual(result.review.usefulParts, ["Project binding was concrete."]);
  assert.deepEqual(result.review.noiseParts, ["Too many generic tool mentions."]);
  assert.deepEqual(result.review.contextUpdateSuggestions, ["Add that Strategy OS is in seven-day observation."]);
  assert.deepEqual(result.review.promptUpdateSuggestions, ["Ask the model to reduce generic tool mentions."]);
  assert.ok(result.review.nextReportInstructions.length > 0);
  assert.equal(result.review.nextStageRecommendation.status, "not-yet");
  assert.ok(fs.existsSync(result.markdownPath));
  assert.ok(fs.existsSync(result.jsonPath));
  assert.ok(result.markdown.includes("## 7. context.md 更新建议"));
});

test("generateReview fails clearly when feedback is missing", () => {
  const { rootDir, date } = createReviewFixture({ withFeedback: false });

  assert.throws(
    () => generateReview({ rootDir, date }),
    /Feedback file not found/
  );
});

test("generateReview does not overwrite existing review unless forced", () => {
  const { rootDir, date } = createReviewFixture();
  const reviewsDir = path.join(rootDir, "reviews");
  fs.mkdirSync(reviewsDir, { recursive: true });
  const reviewPath = path.join(reviewsDir, `${date}-review.md`);
  fs.writeFileSync(reviewPath, "USER REVIEW NOTES\n");

  assert.throws(
    () => generateReview({ rootDir, date }),
    /Review already exists/
  );
  assert.equal(fs.readFileSync(reviewPath, "utf8"), "USER REVIEW NOTES\n");

  const result = generateReview({ rootDir, date, force: true });
  assert.equal(result.created, true);
  assert.ok(fs.readFileSync(result.markdownPath, "utf8").includes("Daily Review"));
});

test("generateReview output does not leak env content", () => {
  const { rootDir, date } = createReviewFixture();

  const result = generateReview({ rootDir, date });
  const json = fs.readFileSync(result.jsonPath, "utf8");
  const markdown = fs.readFileSync(result.markdownPath, "utf8");

  assert.equal(json.includes("do-not-read-this"), false);
  assert.equal(markdown.includes("do-not-read-this"), false);
});
