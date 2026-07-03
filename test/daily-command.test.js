const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { generateDailyCommand } = require("../scripts/generate-daily-command");

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-command-"));
  const date = "2026-07-03";
  const reportPath = path.join(rootDir, "data", "reports", `${date}.json`);
  const poolPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const report = {
    date,
    mode: "mock",
    warnings: ["fetch failed; fallback mock analysis mode used."],
    qualityChecklist: {
      bestSuggestion: "验证独立创作者 AI 机会发现小报 MVP。",
      suggestionToIgnore: "不要因为趋势表面相关就优化旧项目。"
    },
    trends: [
      {
        title: "Agentic planning and tool use",
        classification: "new-project-opportunity",
        relatedProject: "EricChan·战略OS"
      }
    ],
    opportunities: [
      {
        opportunityName: "Independent AI opportunity brief MVP",
        whyItMatters: "把趋势翻译成可验证、可变现的新项目机会。",
        ericChanFit: "high",
        firstValidationAction: "Pick one niche audience and produce one sample brief.",
        recommendedAgent: "GPT 5.5 Thinking + Codex"
      }
    ],
    recommendedActions: [
      {
        action: "Validate one sample opportunity brief with one target user.",
        owner: "EricChan",
        stageFit: "now"
      },
      {
        action: "Archive old project signals as learning material.",
        owner: "Obsidian + Claudian",
        stageFit: "later"
      },
      {
        action: "Refine tomorrow's report prompt if the command feels generic.",
        owner: "GPT 5.5 Thinking",
        stageFit: "now"
      },
      {
        action: "Do not include this fourth action.",
        owner: "Codex",
        stageFit: "now"
      }
    ]
  };
  const pool = {
    version: 1,
    opportunities: [
      {
        id: "opp-brief",
        status: "validate",
        humanDecision: "accepted",
        opportunityName: "Independent AI opportunity brief MVP",
        sourceTrend: "Agentic planning and tool use",
        whyItMatters: "把趋势翻译成可验证、可变现的新项目机会。",
        ericChanFit: "high",
        firstValidationAction: "Generate one sample brief.",
        recommendedAgent: "GPT 5.5 Thinking + Codex",
        reviewNextAction: "先定义一个具体目标用户群。",
        scores: { ericChanFit: 5 }
      },
      {
        id: "opp-quality",
        status: "watch",
        humanDecision: "watching",
        opportunityName: "Opportunity scoring quality gate",
        whyItMatters: "Internal quality gate."
      },
      {
        id: "opp-rejected",
        status: "rejected",
        humanDecision: "rejected",
        opportunityName: "Rejected old project tweak"
      }
    ]
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(poolPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(poolPath, JSON.stringify(pool, null, 2));
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");

  return {
    rootDir,
    date,
    reportPath,
    poolPath,
    poolContent: fs.readFileSync(poolPath, "utf8")
  };
}

test("generateDailyCommand creates markdown and json from report plus opportunity pool", () => {
  const fixture = createFixture();

  const result = generateDailyCommand({ rootDir: fixture.rootDir, date: fixture.date });
  const markdown = fs.readFileSync(result.markdownPath, "utf8");
  const json = JSON.parse(fs.readFileSync(result.jsonPath, "utf8"));

  assert.equal(result.reportRead, true);
  assert.equal(result.opportunityPoolRead, true);
  assert.equal(json.sourceMode, "mock");
  assert.equal(json.recommendedActions.length, 3);
  assert.ok(markdown.includes("# EricChan·战略OS Daily Command - 2026-07-03"));
  assert.ok(markdown.includes("## 1. 今日一句话判断"));
  assert.ok(markdown.includes("## 4. 今日行动建议"));
  assert.ok(markdown.includes("## 7. 今日不要做什么"));
  assert.ok(markdown.includes("Independent AI opportunity brief MVP"));
  assert.ok(markdown.includes("sourceMode: mock"));
  assert.equal(markdown.includes("Do not include this fourth action"), false);
  assert.equal(markdown.includes("do-not-read-this"), false);
  assert.equal(json.topOpportunities.some((item) => item.opportunityName === "Opportunity scoring quality gate"), false);
  assert.equal(fs.readFileSync(fixture.poolPath, "utf8"), fixture.poolContent);
});

test("generateDailyCommand fails clearly when opportunity pool is missing", () => {
  const fixture = createFixture();
  fs.unlinkSync(fixture.poolPath);

  assert.throws(
    () => generateDailyCommand({ rootDir: fixture.rootDir, date: fixture.date }),
    /Opportunity pool JSON not found/
  );
});

test("generateDailyCommand does not overwrite existing files unless forced", () => {
  const fixture = createFixture();
  const markdownPath = path.join(fixture.rootDir, "daily-command", `${fixture.date}.md`);
  const jsonPath = path.join(fixture.rootDir, "data", "daily-command", `${fixture.date}.json`);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(markdownPath, "existing command");
  fs.writeFileSync(jsonPath, "{}");

  assert.throws(
    () => generateDailyCommand({ rootDir: fixture.rootDir, date: fixture.date }),
    /Daily Command already exists/
  );
  assert.equal(fs.readFileSync(markdownPath, "utf8"), "existing command");

  generateDailyCommand({ rootDir: fixture.rootDir, date: fixture.date, force: true });
  assert.notEqual(fs.readFileSync(markdownPath, "utf8"), "existing command");
});
