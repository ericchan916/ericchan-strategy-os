const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  generateReport,
  renderMarkdown,
  createMockAnalysis,
  validateReportQuality
} = require("../scripts/generate-report");

test("mock report binds trends to EricChan projects and writes markdown/json", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-"));

  fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "prompts"), { recursive: true });

  fs.writeFileSync(
    path.join(rootDir, "context", "context.md"),
    "# EricChan Context\n\nProjects: iPortfolio, XiaoChan AI Persona, OPC, EricChan Strategy OS, Codex.\n"
  );
  fs.writeFileSync(
    path.join(rootDir, "config", "sources.config.json"),
    JSON.stringify({
      sources: [
        {
          id: "manual",
          name: "Manual Placeholder",
          category: "ai-agents",
          type: "manual-placeholder",
          enabled: true,
          priority: 1,
          notes: "Test source"
        }
      ]
    })
  );
  fs.writeFileSync(path.join(rootDir, "prompts", "analysis-prompt.md"), "Analyze with context.");

  const result = await generateReport({ rootDir, mock: true, date: "2026-06-30" });

  assert.equal(result.report.date, "2026-06-30");
  assert.ok(result.report.trends.length >= 1);
  assert.ok(result.report.projectImpacts.some((item) => item.project.includes("XiaoChan")));
  assert.ok(result.report.opportunities.some((item) => item.status === "test"));
  assert.ok(result.report.agentDispatchSuggestions.some((item) => item.agent.includes("Codex")));
  assert.ok(Array.isArray(result.report.dataGaps));
  assert.ok(result.report.trends.every((item) => !/placeholder/i.test(item.title)));
  assert.ok(result.report.trends.every((item) => item.sourceIds?.length || item.sourceUrls?.length || item.evidence));
  assert.ok(result.report.opportunities.every((item) => item.stageFit));
  assert.ok(result.report.recommendedActions.every((item) => item.stageFit));
  assert.equal(result.report.qualityChecklist.evidenceBacked, true);
  assert.equal(result.report.qualityChecklist.stageAppropriate, true);
  assert.equal(result.report.qualityChecklist.noPlaceholderAsTrend, true);
  assert.equal(result.report.qualityChecklist.avoidsPrematureBuild, true);
  assert.ok(result.markdown.includes("## 5. 今日机会收件箱"));
  assert.ok(result.markdown.includes("## 7. 推荐智能体派发"));
  assert.ok(fs.existsSync(path.join(rootDir, "reports", "2026-06-30.md")));
  assert.ok(fs.existsSync(path.join(rootDir, "data", "reports", "2026-06-30.json")));
});

test("markdown includes required strategy sections", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });
  const markdown = renderMarkdown(report);

  [
    "## 1. 今日关键 AI 趋势",
    "## 3. 与 EricChan 当前项目的关系",
    "## 5. 今日机会收件箱",
    "## 6. 推荐下一步行动",
    "## 7. 推荐智能体派发",
    "## 8. 建议进入 Obsidian 的内容"
  ].forEach((section) => assert.ok(markdown.includes(section), section));
});

test("report quality validation catches missing strategic substance", () => {
  const goodReport = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });
  const goodResult = validateReportQuality(goodReport);

  assert.equal(goodResult.ok, true);
  assert.equal(goodResult.score, goodResult.checks.length);

  const weakResult = validateReportQuality({
    ...goodReport,
    trends: [{ title: "Placeholder: Generic AI news" }],
    dataGaps: undefined,
    opportunities: [],
    recommendedActions: [{ action: "" }],
    qualityChecklist: {
      boundToProjects: false,
      hasExecutableAction: false,
      avoidsGenericSummary: false,
      evidenceBacked: false,
      stageAppropriate: false,
      noPlaceholderAsTrend: false,
      avoidsPrematureBuild: false
    }
  });

  assert.equal(weakResult.ok, false);
  assert.ok(weakResult.failures.includes("trends has at least one relatedProject"));
  assert.ok(weakResult.failures.includes("trends do not include Placeholder items"));
  assert.ok(weakResult.failures.includes("dataGaps exists"));
  assert.ok(weakResult.failures.includes("opportunities exists"));
  assert.ok(weakResult.failures.includes("recommendedActions has at least one executable action"));
  assert.ok(weakResult.failures.includes("qualityChecklist.boundToProjects is true"));
  assert.ok(weakResult.failures.includes("qualityChecklist.evidenceBacked is true"));
});

test("strategic quality gate blocks premature now-stage build recommendations", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality({
    ...report,
    opportunities: [
      {
        title: "Static OS baseline deployment on Vercel",
        relatedTrend: "Cloud deployment",
        relatedProject: "EricChan Strategy OS",
        priority: "high",
        status: "build",
        stageFit: "now"
      }
    ],
    recommendedActions: [
      {
        action: "Build Dashboard and start multi-agent execution today",
        owner: "Codex",
        urgency: "today",
        stageFit: "now"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("premature build/deployment suggestions are not stageFit now"));
});

test("strategic quality gate blocks deployment-on-vercel wording", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality({
    ...report,
    opportunities: [
      {
        title: "Static OS baseline deployment on Vercel",
        relatedTrend: "Vercel platform update",
        relatedProject: "EricChan Strategy OS",
        priority: "high",
        status: "build",
        stageFit: "now"
      }
    ],
    recommendedActions: [
      {
        action: "Generate and manually review one more live report.",
        owner: "EricChan",
        urgency: "today",
        stageFit: "now"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("premature build/deployment suggestions are not stageFit now"));
});
