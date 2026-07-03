const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { askStrategyOs, classifyQuestion } = require("../scripts/ask-strategy-os");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ask-"));
  const date = "2026-07-03";
  fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "daily-command"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "context", "context.md"), "EricChan 当前优先个人可用、中文输出、机会发现。");
  writeJson(path.join(rootDir, "config", "recommended-questions.json"), [
    "今天适合做什么？",
    "当前项目哪个最值得推进？",
    "我现在该不该开新项目？",
    "我看到一个好项目，帮我体检一下。",
    "帮我生成项目开工包。",
    "这件事该交给哪个智能体？",
    "我是不是把事情搞复杂了？"
  ]);
  writeJson(path.join(rootDir, "data", "reports", `${date}.json`), {
    date,
    mode: "mock",
    warnings: [],
    opportunities: [],
    recommendedActions: [{ action: "把 Independent AI opportunity brief 压成一个样例。", stageFit: "now" }]
  });
  writeJson(path.join(rootDir, "data", "opportunities", "opportunity-pool.json"), {
    version: 1,
    opportunities: [
      {
        id: "opp-brief",
        status: "validate",
        humanDecision: "accepted",
        opportunityName: "Independent AI opportunity brief MVP",
        firstValidationAction: "写一份样例 brief"
      },
      {
        id: "opp-quality",
        status: "watch",
        humanDecision: "watching",
        opportunityName: "Opportunity scoring quality gate"
      }
    ]
  });
  writeJson(path.join(rootDir, "data", "daily-command", `${date}.json`), {
    date,
    sourceMode: "mock",
    oneLineJudgment: "今天最重要的是把最强机会压成一个可验证的小动作。",
    topOpportunities: [{ opportunityName: "Independent AI opportunity brief MVP" }],
    recommendedActions: [
      {
        action: "推进 Independent AI opportunity brief MVP 的个人可用验证",
        expectedOutput: "一份样例 brief",
        timebox: "45-60 min"
      }
    ],
    newProjectDecision: {
      decision: "not-yet",
      reason: "先验证个人可用价值。",
      requiredConfirmation: "完成一个样例 brief。"
    }
  });
  fs.writeFileSync(path.join(rootDir, "daily-command", `${date}.md`), "# EricChan·战略OS Daily Command\n\n今天最重要的是保持轻量。");
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");

  return {
    rootDir,
    date,
    reportPath: path.join(rootDir, "data", "reports", `${date}.json`),
    poolPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    commandPath: path.join(rootDir, "daily-command", `${date}.md`)
  };
}

test("no question prints Chinese recommended questions", () => {
  const fixture = createFixture();
  const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date });

  assert.equal(result.type, "general-strategy-question");
  assert.ok(result.answer.includes("# 推荐问题"));
  assert.ok(result.answer.includes("今天适合做什么？"));
  assert.ok(result.answer.includes("我是不是把事情搞复杂了？"));
});

test("classifies supported question types", () => {
  assert.equal(classifyQuestion("今天适合做什么？"), "today-action");
  assert.equal(classifyQuestion("我看到一个好项目，帮我体检一下。"), "project-checkup");
  assert.equal(classifyQuestion("帮我生成项目开工包。"), "kickoff-package");
  assert.equal(classifyQuestion("这件事该交给哪个智能体？"), "agent-dispatch");
  assert.equal(classifyQuestion("我是不是把事情搞复杂了？"), "complexity-check");
});

test("today action answers in Chinese and uses current Daily Command", () => {
  const fixture = createFixture();
  const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date, question: "今天适合做什么？" });

  assert.equal(result.type, "today-action");
  assert.ok(result.answer.includes("# 今天适合做什么"));
  assert.ok(result.answer.includes("今天最重要的是把最强机会压成一个可验证的小动作"));
  assert.ok(result.answer.includes("今天不要做"));
});

test("CLI accepts a question argument", () => {
  const fixture = createFixture();
  const output = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "ask-strategy-os.js"), "今天适合做什么？"], {
    cwd: fixture.rootDir,
    encoding: "utf8"
  });

  assert.ok(output.includes("# 今天适合做什么"));
  assert.equal(output.includes("# 推荐问题"), false);
});

test("project checkup contains required Chinese sections", () => {
  const fixture = createFixture();
  const result = askStrategyOs({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "我看到一个 ESP32 墨水屏日历项目，帮我体检一下。"
  });

  assert.equal(result.type, "project-checkup");
  assert.ok(result.answer.includes("# 项目体检"));
  assert.ok(result.answer.includes("## 2. 值不值得做"));
  assert.ok(result.answer.includes("## 6. 最小可验证效果"));
  assert.ok(result.answer.includes("生成开工包"));
  assert.equal(result.answer.includes("直接交给 Codex 开工"), false);
});

test("kickoff package is for GPT 5.5 Thinking control, not direct Codex execution", () => {
  const fixture = createFixture();
  const result = askStrategyOs({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "帮我生成这个项目的开工包：ESP32 墨水屏日历项目。"
  });

  assert.equal(result.type, "kickoff-package");
  assert.ok(result.answer.includes("# 项目开工包：交给 GPT 5.5 Thinking 总控"));
  assert.ok(result.answer.includes("是否需要 Codex 做工程 MVP？"));
  assert.ok(result.answer.includes("GPT 5.5 Thinking：战略判断"));
  assert.equal(result.answer.includes("直接交给 Codex 开工"), false);
});

test("recommended questions config is Chinese", () => {
  const fixture = createFixture();
  const questions = JSON.parse(fs.readFileSync(path.join(fixture.rootDir, "config", "recommended-questions.json"), "utf8"));

  assert.ok(questions.length >= 7);
  assert.ok(questions.every((item) => /[\u4e00-\u9fa5]/.test(item)));
});

test("ask mode does not read .env or modify user generated files", () => {
  const fixture = createFixture();
  const before = {
    report: fs.readFileSync(fixture.reportPath, "utf8"),
    pool: fs.readFileSync(fixture.poolPath, "utf8"),
    command: fs.readFileSync(fixture.commandPath, "utf8")
  };
  const originalRead = fs.readFileSync;

  try {
    fs.readFileSync = function patchedRead(filePath, ...args) {
      if (String(filePath).endsWith(".env")) throw new Error(".env should not be read");
      return originalRead.call(this, filePath, ...args);
    };
    const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date, question: "这件事该交给哪个智能体？" });
    assert.ok(result.answer.includes("GPT 5.5 Thinking"));
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.equal(fs.readFileSync(fixture.reportPath, "utf8"), before.report);
  assert.equal(fs.readFileSync(fixture.poolPath, "utf8"), before.pool);
  assert.equal(fs.readFileSync(fixture.commandPath, "utf8"), before.command);
});
