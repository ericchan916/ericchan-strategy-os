const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  generateReport,
  renderMarkdown,
  createMockAnalysis,
  normalizeReportForDailyUse,
  validateReportQuality
} = require("../scripts/generate-report");

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
  assert.ok(result.report.trends.every((item) => item.classification));
  assert.ok(result.report.trends.every((item) => item.opportunityReason));
  assert.ok(result.report.opportunities.every((item) => item.stageFit));
  assert.ok(result.report.opportunities.every((item) => item.opportunityName));
  assert.ok(result.report.opportunities.every((item) => item.monetizationPotential));
  assert.ok(result.report.opportunities.every((item) => item.ericChanFit));
  assert.ok(result.report.opportunities.every((item) => item.mvpForm));
  assert.ok(result.report.opportunities.every((item) => item.firstValidationAction));
  assert.ok(result.report.opportunities.every((item) => typeof item.enterOpportunityPool === "boolean"));
  assert.ok(result.report.opportunities.every((item) => typeof item.needsHumanConfirmation === "boolean"));
  assert.ok(result.report.opportunities.every((item) => typeof item.shouldIgnore === "boolean"));
  assert.ok(result.report.opportunities.every((item) => SCORE_KEYS.every((key) => Number.isInteger(item.scores?.[key]))));
  assert.ok(result.report.recommendedActions.every((item) => item.stageFit));
  assert.ok(result.report.recommendedActions.every((item) => item.actionType));
  assert.equal(result.report.humanFeedbackRequired, true);
  assert.ok(result.report.opportunities.every((item) => item.humanFeedback?.decision === "pending"));
  assert.ok(result.report.recommendedActions.every((item) => item.humanFeedback?.decision === "pending"));
  assert.equal(result.report.qualityChecklist.evidenceBacked, true);
  assert.equal(result.report.qualityChecklist.stageAppropriate, true);
  assert.equal(result.report.qualityChecklist.noPlaceholderAsTrend, true);
  assert.equal(result.report.qualityChecklist.avoidsPrematureBuild, true);
  assert.equal(result.report.qualityChecklist.opportunityFirst, true);
  assert.equal(result.report.qualityChecklist.avoidsLegacyOptimization, true);
  assert.equal(result.report.qualityChecklist.hasMonetizationAssessment, true);
  assert.equal(result.report.qualityChecklist.hasMvpValidationPath, true);
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
    opportunities: [{}],
    recommendedActions: [{ action: "" }],
    humanFeedbackRequired: undefined,
    qualityChecklist: {
      boundToProjects: false,
      hasExecutableAction: false,
      avoidsGenericSummary: false,
      evidenceBacked: false,
      stageAppropriate: false,
      noPlaceholderAsTrend: false,
      avoidsPrematureBuild: false,
      opportunityFirst: false,
      avoidsLegacyOptimization: false,
      hasMonetizationAssessment: false,
      hasMvpValidationPath: false
    }
  });

  assert.equal(weakResult.ok, false);
  assert.ok(weakResult.failures.includes("trends do not include Placeholder items"));
  assert.ok(weakResult.failures.includes("dataGaps exists"));
  assert.ok(weakResult.failures.includes("recommendedActions has at least one executable action"));
  assert.ok(weakResult.failures.includes("humanFeedbackRequired exists"));
  assert.ok(weakResult.failures.includes("qualityChecklist.boundToProjects is true"));
  assert.ok(weakResult.failures.includes("qualityChecklist.evidenceBacked is true"));
  assert.ok(weakResult.failures.includes("trends include valid classification"));
  assert.ok(weakResult.failures.includes("opportunities include scoring fields"));
  assert.ok(weakResult.failures.includes("qualityChecklist.opportunityFirst is true"));
});

test("opportunities can be empty without failing the daily-use quality gate", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality(
    normalizeReportForDailyUse({
      ...report,
      opportunities: [],
      qualityChecklist: {
        ...report.qualityChecklist,
        hasMonetizationAssessment: false,
        hasMvpValidationPath: false
      }
    })
  );

  assert.equal(result.ok, true);
});

test("opportunities no longer require relatedProject after opportunity-first schema", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality({
    ...report,
    trends: report.trends.map(({ relatedProject, ...item }) => item),
    opportunities: report.opportunities.map(({ relatedProject, ...item }) => item)
  });

  assert.equal(result.ok, true);
});

test("normalization infers missing or invalid trend classification", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const normalized = normalizeReportForDailyUse({
    ...report,
    trends: [
      {
        title: "Solo builder paid AI opportunity",
        summary: "A new MVP opportunity with monetization potential.",
        evidence: "A new MVP opportunity with monetization potential."
      },
      {
        title: "Update iPortfolio visual language",
        summary: "Useful only as legacy project learning material.",
        evidence: "Useful only as legacy project learning material.",
        classification: "old-project-update"
      }
    ]
  });

  assert.equal(normalized.trends[0].classification, "new-project-opportunity");
  assert.equal(normalized.trends[1].classification, "legacy-learning-material");
  assert.ok(normalized.trends.every((item) => item.opportunityReason));
  assert.ok(normalized.warnings.some((item) => item.includes("Trend classification inferred")));
  assert.equal(validateReportQuality(normalized).ok, true);
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

test("feedback quality gate requires pending feedback and limits report-regeneration actions", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality({
    ...report,
    humanFeedbackRequired: true,
    opportunities: report.opportunities.map((item, index) => ({
      ...item,
      humanFeedback: index === 0 ? undefined : item.humanFeedback
    })),
    recommendedActions: [
      {
        action: "Generate another live report for agentic AI.",
        owner: "GPT 5.5 Thinking",
        urgency: "today",
        stageFit: "now",
        humanFeedback: { decision: "pending", reason: "", followUp: "" }
      },
      {
        action: "Generate another live report for coding models.",
        owner: "GPT 5.5 Thinking",
        urgency: "today",
        stageFit: "now",
        humanFeedback: { decision: "pending", reason: "", followUp: "" }
      },
      {
        action: "Request human feedback on the latest report.",
        owner: "EricChan",
        urgency: "today",
        stageFit: "now",
        humanFeedback: { decision: "accept", reason: "", followUp: "" }
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("opportunities include pending humanFeedback"));
  assert.ok(result.failures.includes("recommendedActions start with pending humanFeedback"));
  assert.ok(result.failures.includes("generate another live report actions stay under one third"));
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

test("opportunity-first gate blocks legacy project optimization actions", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const result = validateReportQuality({
    ...report,
    trends: report.trends.map((item, index) => ({
      ...item,
      classification: index === 0 ? "legacy-learning-material" : item.classification,
      relatedProject: index === 0 ? "iPortfolio" : item.relatedProject
    })),
    recommendedActions: [
      {
        action: "Update iPortfolio based on the latest AI design trend.",
        actionType: "dispatch-codex-mvp",
        owner: "Codex",
        urgency: "today",
        stageFit: "now",
        humanFeedback: { decision: "pending", reason: "", followUp: "" }
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("recommendedActions avoid legacy project optimization"));
  assert.ok(result.failures.includes("legacy-learning-material trends do not become actions"));
});

test("opportunity-first gate requires valid classifications and complete opportunity scores", () => {
  const report = createMockAnalysis({
    date: "2026-06-30",
    rawItems: [],
    contextText: "iPortfolio XiaoChan OPC Codex Obsidian",
    warnings: []
  });

  const invalidReport = {
    ...report,
    trends: report.trends.map((item, index) => ({
      ...item,
      classification: index === 0 ? "old-project-update" : item.classification
    })),
    opportunities: report.opportunities.map((item, index) =>
      index === 0
        ? {
            ...item,
            monetizationPotential: undefined,
            ericChanFit: undefined,
            mvpForm: undefined,
            firstValidationAction: undefined,
            scores: { monetizationPotential: 1, ericChanFit: 1 }
          }
        : item
    )
  };

  const result = validateReportQuality(invalidReport);

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("trends include valid classification"));
  assert.ok(result.failures.includes("opportunities include monetization and MVP fields"));
  assert.ok(result.failures.includes("opportunities include scoring fields"));
});

test("opportunity-first gate blocks weak fit opportunities and high-risk now actions", () => {
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
        ...report.opportunities[0],
        monetizationPotential: "low",
        ericChanFit: "low",
        shouldIgnore: false,
        status: "test",
        stageFit: "now",
        scores: {
          monetizationPotential: 2,
          ericChanFit: 2,
          mvpSpeed: 3,
          aiLeverage: 3,
          opcFit: 2,
          contentAssetPotential: 2,
          longTermCompounding: 2,
          complexityRisk: 4,
          currentStageFit: 3
        }
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("low monetization and low fit opportunities are ignored or watched"));
  assert.ok(result.failures.includes("high complexity opportunities are not stageFit now"));
});
