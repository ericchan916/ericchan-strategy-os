#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const AGENTS = [
  "GPT 5.5 Thinking",
  "Codex",
  "OpenDesign",
  "MiniMax",
  "WorkBuddy + DeepSeek",
  "Obsidian + Claudian",
  "Hermes"
];

const PREMATURE_NOW_PATTERN = /vercel.*deploy|deploy.*vercel|unified vercel|dashboard|multi[- ]?agent.*execution|cloud.*deploy|deploy.*cloud|wechat|telegram|微信|推送|云端架构|统一部署/i;
const FEEDBACK_DECISIONS = new Set(["pending", "accept", "watch", "reject", "done"]);
const TREND_CLASSIFICATIONS = new Set([
  "new-project-opportunity",
  "current-project-improvement",
  "legacy-learning-material",
  "watch-only",
  "ignore"
]);
const ACTION_TYPES = new Set([
  "validate-new-opportunity",
  "research-market",
  "create-mvp-spec",
  "dispatch-codex-mvp",
  "dispatch-opendesign-prototype",
  "dispatch-workbuddy-validation",
  "archive-opportunity",
  "update-context",
  "ignore-trend"
]);
const OPPORTUNITY_SCORE_KEYS = [
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
const LEGACY_ACTION_PATTERN = /update\s+iportfolio|update.*personal (biography )?site|rebuild\s+xiaochan|rebuild.*persona|deploy.*legacy|legacy.*deploy|redesign.*personal website|expand.*节律|add features.*节律|优化.*旧项目|重构.*小chan|更新.*iportfolio|部署.*旧项目|扩展.*节律/i;
const LEGACY_PROJECT_PATTERN = /iportfolio|personal biography|personal website|xiaochan|小chan|节律/i;

function pendingFeedback() {
  return { decision: "pending", reason: "", followUp: "" };
}

function withPendingFeedback(item) {
  return {
    ...item,
    humanFeedback: item.humanFeedback || pendingFeedback()
  };
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function loadEnv(rootDir) {
  try {
    require("dotenv").config({ path: path.join(rootDir, ".env") });
  } catch {
    // dotenv is installed by npm install; missing dependency still leaves mock mode usable after tests scaffold.
  }
}

function mockRawItems(date) {
  return [
    {
      source: "mock-frontier-models",
      title: "Frontier models move toward longer-context planning and tool use",
      summary: "Model providers keep pushing agentic planning, tool calls, and longer context windows as product primitives.",
      url: "mock://frontier-models/planning-tool-use",
      publishedAt: `${date}T08:00:00+08:00`,
      category: "frontier-models"
    },
    {
      source: "mock-ai-coding",
      title: "AI coding tools emphasize local validation loops",
      summary: "Coding agents are becoming more useful when they can run tests, inspect files, and produce reproducible local artifacts.",
      url: "mock://ai-coding/local-validation",
      publishedAt: `${date}T09:00:00+08:00`,
      category: "ai-coding"
    },
    {
      source: "mock-design-tools",
      title: "Design tools shift from static mockups to editable generated systems",
      summary: "AI design tooling is moving toward structured design systems, reusable components, and handoff-ready artifacts.",
      url: "mock://design-tools/editable-systems",
      publishedAt: `${date}T10:00:00+08:00`,
      category: "design-tools"
    }
  ];
}

function manualPlaceholderItem(source, date) {
  return {
    source: source.id,
    title: source.name,
    summary: source.notes || "Manual placeholder source for future trend input.",
    url: source.url || `manual://${source.id}`,
    publishedAt: `${date}T00:00:00+08:00`,
    category: source.category || "manual"
  };
}

function isManualPlaceholderItem(item) {
  return item?.url?.startsWith("manual://") || item?.source?.startsWith("manual-") || /manual placeholder/i.test(item?.title || "");
}

function createDataGaps(rawItems = [], warnings = []) {
  const manualGaps = rawItems.filter(isManualPlaceholderItem).map((item) => ({
    category: item.category || "manual",
    source: item.source,
    reason: "manual-placeholder",
    note: item.summary || item.title || "Manual placeholder source needs real validation before becoming a trend."
  }));

  const warningGaps = warnings.map((warning) => ({
    category: "source-warning",
    source: "",
    reason: "source-warning",
    note: warning
  }));

  return [...manualGaps, ...warningGaps];
}

function evidenceForItem(item) {
  const summary = item.summary || item.title || "";
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

function opportunityScores(overrides = {}) {
  return {
    monetizationPotential: 4,
    ericChanFit: 5,
    mvpSpeed: 4,
    aiLeverage: 4,
    opcFit: 3,
    contentAssetPotential: 4,
    longTermCompounding: 4,
    complexityRisk: 2,
    currentStageFit: 4,
    ...overrides
  };
}

async function fetchRssSource(source) {
  const Parser = require("rss-parser");
  const parser = new Parser({ timeout: 10000 });
  const feed = await parser.parseURL(source.url);
  return (feed.items || []).slice(0, 8).map((item) => ({
    source: source.id,
    title: item.title || "(untitled)",
    summary: item.contentSnippet || item.content || item.summary || "",
    url: item.link || source.url,
    publishedAt: item.isoDate || item.pubDate || null,
    category: source.category
  }));
}

async function fetchWebpageSource(source) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "EricChan-Strategy-OS/0.1" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || source.name;
  const description =
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] ||
    source.notes ||
    "";

  return [
    {
      source: source.id,
      title: title.trim(),
      summary: description.trim(),
      url: source.url,
      publishedAt: null,
      category: source.category
    }
  ];
}

async function collectRawItems({ rootDir, date, mock, warnings }) {
  if (mock) {
    return mockRawItems(date);
  }

  const config = readJson(path.join(rootDir, "config", "sources.config.json"), { sources: [] });
  const enabledSources = (config.sources || []).filter((source) => source.enabled);
  const items = [];

  for (const source of enabledSources) {
    try {
      if (source.type === "manual-placeholder") {
        items.push(manualPlaceholderItem(source, date));
      } else if (source.type === "rss") {
        items.push(...(await fetchRssSource(source)));
      } else if (source.type === "webpage") {
        items.push(...(await fetchWebpageSource(source)));
      } else {
        warnings.push(`Skipped ${source.id}: unsupported source type ${source.type}`);
      }
    } catch (error) {
      warnings.push(`Skipped ${source.id}: ${error.message}`);
    }
  }

  if (items.length === 0) {
    warnings.push("No live source items collected; fallback mock trend set used.");
    return mockRawItems(date);
  }

  return items;
}

function writeRawSnapshot(rootDir, date, rawItems, warnings) {
  const rawDir = path.join(rootDir, "data", "raw");
  ensureDir(rawDir);
  fs.writeFileSync(
    path.join(rawDir, `${date}.json`),
    JSON.stringify({ date, generatedAt: new Date().toISOString(), warnings, items: rawItems }, null, 2)
  );
}

function createMockAnalysis({ date, rawItems, contextText, warnings }) {
  const sourceItems = rawItems.length ? rawItems : mockRawItems(date);
  const items = sourceItems.filter((item) => !isManualPlaceholderItem(item));
  const dataGaps = createDataGaps(sourceItems, warnings);
  const contextHint = contextText.includes("OPC") ? "OPC" : "EricChan Strategy OS";

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode: "mock",
    humanFeedbackRequired: true,
    sourcesUsed: [...new Set(sourceItems.map((item) => item.source))],
    warnings,
    dataGaps,
    trends: items.slice(0, 5).map((item, index) => ({
      title: item.title,
      summary: item.summary,
      classification:
        index === 0
          ? "new-project-opportunity"
          : index === 1
            ? "current-project-improvement"
            : "legacy-learning-material",
      opportunityReason:
        index === 0
          ? "Long-context planning and tool use can become a small paid opportunity discovery workflow for independent operators."
          : index === 1
            ? "Local validation loops improve the current Strategy OS report engine and proposal workflow."
            : "Editable design-system trends help infer EricChan's taste from legacy projects, but they should not trigger old-project redesign.",
      sourceIds: [item.source].filter(Boolean),
      sourceUrls: item.url ? [item.url] : [],
      evidence: evidenceForItem(item),
      confidence: item.url && item.summary ? "high" : "medium",
      whyItMatters:
        index === 0
          ? "趋势正在把大模型从回答工具推向可规划、可派发、可验证的工作系统。"
          : "它会影响 EricChan 对工具链、实验节奏和项目优先级的判断。",
      relatedProject:
        index === 0 ? "EricChan·战略OS" : index === 1 ? "智能体开发链路 / Codex" : "个人传记网站 / iPortfolio",
      suggestedNextStep:
        index === 0
          ? "把战略报告中的行动建议拆成可派发任务，而不是只保留摘要。"
          : "用一次小实验验证它是否能提升当前项目推进效率。",
      recommendedAgent: index === 1 ? "Codex" : index === 2 ? "OpenDesign" : "GPT 5.5 Thinking",
      experimentCandidate: true
    })),
    toolChanges: [
      {
        tool: "Codex",
        change: "本地文件读写、测试、Git 提交流程适合作为 Stage 0.5 的验证闭环。",
        implication: "战略OS 的第一版应优先输出可复现 artifact，而不是追求完整 Dashboard。"
      },
      {
        tool: "Obsidian",
        change: "Markdown 报告可以直接进入长期知识库。",
        implication: "日报需要保留结构化 JSON，方便后续 Dashboard 和复盘索引。"
      }
    ],
    projectRelations: [
      {
        project: "EricChan·战略OS",
        relationship: "这是所有外部趋势进入个人战略判断的总控入口。"
      },
      {
        project: "小Chan AI Persona",
        relationship: "作为旧项目学习材料，用来理解 EricChan 对 AI Persona、一致性和互动体验的兴趣，不默认触发重构。"
      },
      {
        project: "个人传记网站 / iPortfolio",
        relationship: "作为旧项目学习材料，用来理解 EricChan 的个人表达、视觉偏好和叙事方式，不默认触发 redesign。"
      },
      {
        project: contextHint,
        relationship: "可作为独立实验方向进入机会收件箱，先观察再小规模测试。"
      }
    ],
    projectImpacts: [
      {
        project: "EricChan·战略OS",
        impact: "需要把趋势转译为行动、智能体派发和 Obsidian 归档，而不是新闻列表。",
        priority: "high"
      },
      {
        project: "Legacy projects / XiaoChan / iPortfolio / 节律 App",
        impact: "旧项目只提供能力、审美和迭代偏好样本；除非出现明确新机会或用户指定，不进入行动建议。",
        priority: "medium"
      },
      {
        project: "智能体开发链路",
        impact: "Codex 负责工程闭环，WorkBuddy + DeepSeek 负责外部验证，GPT 负责总控评审。",
        priority: "high"
      }
    ],
    opportunities: [
      {
        title: "独立创作者 AI 机会发现小报 MVP",
        opportunityName: "Independent AI opportunity brief MVP",
        relatedTrend: "Agentic planning and tool use",
        sourceTrend: "Agentic planning and tool use",
        relatedProject: "EricChan·战略OS",
        whyItMatters: "把趋势翻译成可验证、可变现的新项目机会，符合 Strategy OS 的新定位。",
        suggestedExperiment: "用 3 个垂直人群手动生成机会简报，验证是否有人愿意持续阅读或付费咨询。",
        monetizationPotential: "medium-high: niche paid brief, consulting intake, or productized research workflow",
        ericChanFit: "high: uses EricChan's synthesis taste, AI workflow fluency, and restrained product judgment",
        mvpForm: "Markdown-based weekly opportunity brief plus manual scoring table",
        firstValidationAction: "Pick one niche audience and produce one paid-style sample brief for human review.",
        recommendedAgent: "GPT 5.5 Thinking + Codex",
        enterOpportunityPool: true,
        needsHumanConfirmation: true,
        shouldIgnore: false,
        scores: opportunityScores(),
        priority: "high",
        status: "test",
        stageFit: "now",
        humanFeedback: pendingFeedback()
      },
      {
        title: "Strategy OS 机会评分质量门增强",
        opportunityName: "Opportunity scoring quality gate",
        relatedTrend: "Long-context model workflows",
        sourceTrend: "Long-context model workflows",
        relatedProject: "EricChan·战略OS",
        whyItMatters: "当前新项目需要把人工反馈沉淀成机会判断，而不是旧项目任务。",
        suggestedExperiment: "对连续 3 份报告统计机会评分是否能过滤低变现、低适配建议。",
        monetizationPotential: "medium: internal tool first, later productized as opportunity OS template",
        ericChanFit: "high: strengthens EricChan's strategic review loop",
        mvpForm: "JSON schema plus validator checks",
        firstValidationAction: "Run mock and one live report, confirm old-project optimization is blocked.",
        recommendedAgent: "Codex",
        enterOpportunityPool: true,
        needsHumanConfirmation: true,
        shouldIgnore: false,
        scores: opportunityScores({ monetizationPotential: 3, opcFit: 2, complexityRisk: 2, currentStageFit: 5 }),
        priority: "high",
        status: "test",
        stageFit: "now",
        humanFeedback: pendingFeedback()
      },
      {
        title: "旧项目审美样本库观察",
        opportunityName: "Legacy project taste corpus",
        relatedTrend: "Editable generated design systems",
        sourceTrend: "Editable generated design systems",
        relatedProject: "Legacy projects as learning materials",
        whyItMatters: "iPortfolio、XiaoChan、节律 App 可帮助 AI 学习 EricChan 的审美和执行偏好，但不应默认优化旧项目。",
        suggestedExperiment: "暂不构建，只在人工审查中判断是否值得作为未来机会画像材料。",
        monetizationPotential: "low: indirect learning asset, not a standalone offer yet",
        ericChanFit: "medium: useful for taste inference but not an action target",
        mvpForm: "No MVP yet; watch as learning material",
        firstValidationAction: "Archive as legacy-learning-material and do not create old-project tasks.",
        recommendedAgent: "Obsidian + Claudian",
        enterOpportunityPool: false,
        needsHumanConfirmation: true,
        shouldIgnore: false,
        scores: opportunityScores({
          monetizationPotential: 2,
          ericChanFit: 3,
          mvpSpeed: 2,
          aiLeverage: 3,
          opcFit: 1,
          contentAssetPotential: 3,
          longTermCompounding: 3,
          complexityRisk: 3,
          currentStageFit: 2
        }),
        priority: "low",
        status: "watch",
        stageFit: "later",
        humanFeedback: pendingFeedback()
      }
    ],
    recommendedActions: [
      {
        action: "Validate the strongest new-project opportunity with one niche audience and one sample paid-style brief.",
        actionType: "validate-new-opportunity",
        owner: "EricChan",
        urgency: "today",
        stageFit: "now",
        humanFeedback: pendingFeedback()
      },
      {
        action: "Create a one-page MVP spec for the opportunity scoring workflow before any build.",
        actionType: "create-mvp-spec",
        owner: "Codex",
        urgency: "today",
        stageFit: "now",
        humanFeedback: pendingFeedback()
      },
      {
        action: "Archive legacy project signals as learning material only; do not turn them into iPortfolio, XiaoChan, or 节律 App tasks.",
        actionType: "archive-opportunity",
        owner: "Obsidian + Claudian",
        urgency: "watch",
        stageFit: "later",
        humanFeedback: pendingFeedback()
      }
    ],
    agentDispatchSuggestions: [
      {
        agent: "GPT 5.5 Thinking",
        dispatch: "总控评审：判断日报是否真的形成战略动作，而不是趋势摘要。"
      },
      {
        agent: "Codex",
        dispatch: "工程实现：维护报告脚本、README、测试和本地验证。"
      },
      {
        agent: "OpenDesign",
        dispatch: "后续 Stage 1：设计 Dashboard 信息架构与视觉秩序。"
      },
      {
        agent: "MiniMax",
        dispatch: "后续视觉挑战版：探索更强视觉表达，不进入 Stage 0.5。"
      },
      {
        agent: "WorkBuddy + DeepSeek",
        dispatch: "趋势调研与外部验证：补充真实来源和中文生态观察。"
      },
      {
        agent: "Obsidian + Claudian",
        dispatch: "长期档案：沉淀日报、行动项、实验结果和版本记录。"
      },
      {
        agent: "Hermes",
        dispatch: "移动端语音记录：捕捉临时想法，后续进入 context.md。"
      }
    ],
    obsidianExport: {
      title: `EricChan·战略OS Daily Brief - ${date}`,
      tags: ["strategy-os", "daily-brief", "ai-trends", "agent-dispatch"],
      summary: "今日报告强调：趋势只有绑定到 EricChan 当前项目、行动和智能体派发时才有价值。",
      archiveNote: "建议归档到 Obsidian 的 Strategy OS/Daily Briefs 目录。"
    },
    qualityChecklist: {
      boundToProjects: true,
      hasExecutableAction: true,
      avoidsGenericSummary: true,
      evidenceBacked: true,
      stageAppropriate: true,
      noPlaceholderAsTrend: true,
      avoidsPrematureBuild: true,
      opportunityFirst: true,
      avoidsLegacyOptimization: true,
      hasMonetizationAssessment: true,
      hasMvpValidationPath: true,
      bestSuggestion: "验证独立创作者 AI 机会发现小报 MVP。",
      suggestionToIgnore: "因为趋势表面相关就更新 iPortfolio、重构 XiaoChan 或扩展节律 App。"
    }
  };
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

function applyHumanFeedbackDefaults(report) {
  report.humanFeedbackRequired = report.humanFeedbackRequired === undefined ? true : report.humanFeedbackRequired;
  report.opportunities = (report.opportunities || []).map(withPendingFeedback);
  report.recommendedActions = (report.recommendedActions || []).map(withPendingFeedback);
  return report;
}

async function analyzeWithLlm({ rootDir, date, rawItems, dataGaps, contextText, promptText, warnings, mock }) {
  loadEnv(rootDir);

  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (process.env.LLM_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  if (mock || !apiKey) {
    if (!apiKey && !mock) warnings.push("LLM_API_KEY not set; mock analysis mode used.");
    return createMockAnalysis({ date, rawItems, contextText, warnings });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: promptText
        },
        {
          role: "user",
          content: JSON.stringify({ date, ericChanContext: contextText, verifiedRawItems: rawItems, dataGaps, requiredAgents: AGENTS }, null, 2)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API failed: HTTP ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM API returned no message content.");
  return { ...extractJson(content), date, generatedAt: new Date().toISOString(), mode: "live", warnings };
}

function bullet(lines) {
  return lines.map((line) => `- ${line}`).join("\n");
}

function renderMarkdown(report) {
  const trends = report.trends || [];
  const toolChanges = report.toolChanges || [];
  const relations = report.projectRelations || [];
  const impacts = report.projectImpacts || [];
  const opportunities = report.opportunities || [];
  const actions = report.recommendedActions || [];
  const dispatches = report.agentDispatchSuggestions || [];
  const checklist = report.qualityChecklist || {};

  return `# EricChan·战略OS Daily Brief - ${report.date}

生成时间：${report.generatedAt}
模式：${report.mode || "live"}

## 1. 今日关键 AI 趋势

${trends
  .map(
    (item, index) => `### ${index + 1}. ${item.title}

- 趋势是什么：${item.summary}
- 分类：${item.classification || ""}
- 机会理由：${item.opportunityReason || ""}
- 证据：${item.evidence || ""}
- 来源：${(item.sourceUrls || []).join(", ") || (item.sourceIds || []).join(", ")}
- 置信度：${item.confidence || "unknown"}
- 为什么重要：${item.whyItMatters}
- 相关项目：${item.relatedProject}
- 下一步：${item.suggestedNextStep}
- 推荐智能体：${item.recommendedAgent}
- 是否值得转成实验：${item.experimentCandidate ? "是" : "否"}`
  )
  .join("\n\n")}

## 2. 今日关键工具 / Agent 变化

${bullet(toolChanges.map((item) => `${item.tool}：${item.change} 影响：${item.implication}`))}

## 3. 与 EricChan 当前项目的关系

${bullet(relations.map((item) => `${item.project}：${item.relationship}`))}

## 4. 项目影响地图

${bullet(impacts.map((item) => `${item.project}（${item.priority}）：${item.impact}`))}

## 5. 今日机会收件箱

${opportunities
  .map(
    (item) => `### ${item.title}

- 机会名称：${item.opportunityName || ""}
- 相关趋势：${item.relatedTrend}
- 来源趋势：${item.sourceTrend || ""}
- 相关项目：${item.relatedProject}
- 为什么重要：${item.whyItMatters}
- 建议实验：${item.suggestedExperiment}
- 变现潜力：${item.monetizationPotential || ""}
- EricChan 适配：${item.ericChanFit || ""}
- MVP 形式：${item.mvpForm || ""}
- 第一轮验证动作：${item.firstValidationAction || ""}
- 推荐智能体：${item.recommendedAgent}
- 进入机会池：${item.enterOpportunityPool ? "是" : "否"}
- 需要人工确认：${item.needsHumanConfirmation ? "是" : "否"}
- 应忽略：${item.shouldIgnore ? "是" : "否"}
- 评分：${item.scores ? Object.entries(item.scores).map(([key, value]) => `${key}=${value}`).join(", ") : ""}
- 优先级：${item.priority}
- 状态：${item.status}
- 阶段适配：${item.stageFit || ""}
- 人工反馈：${item.humanFeedback?.decision || ""}`
  )
  .join("\n\n")}

## 6. 推荐下一步行动

${bullet(actions.map((item) => `${item.action} 类型：${item.actionType || ""}；负责人：${item.owner}；紧急度：${item.urgency}；阶段适配：${item.stageFit || ""}；人工反馈：${item.humanFeedback?.decision || ""}`))}

## 7. 推荐智能体派发

${bullet(dispatches.map((item) => `${item.agent}：${item.dispatch}`))}

## 8. 建议进入 Obsidian 的内容

- 标题：${report.obsidianExport?.title || `EricChan·战略OS Daily Brief - ${report.date}`}
- 标签：${(report.obsidianExport?.tags || []).join(", ")}
- 摘要：${report.obsidianExport?.summary || ""}
- 归档建议：${report.obsidianExport?.archiveNote || ""}

## 9. 有用性自评

- [${checklist.boundToProjects ? "x" : " "}] 今日报告是否绑定到了具体项目？
- [${checklist.hasExecutableAction ? "x" : " "}] 是否产生了至少一个可执行动作？
- [${checklist.avoidsGenericSummary ? "x" : " "}] 是否避免了泛泛而谈？
- [${checklist.evidenceBacked ? "x" : " "}] 是否有证据追踪？
- [${checklist.stageAppropriate ? "x" : " "}] 是否符合当前阶段？
- [${checklist.noPlaceholderAsTrend ? "x" : " "}] 是否避免把 placeholder 当趋势？
- [${checklist.avoidsPrematureBuild ? "x" : " "}] 是否避免过早 build / deployment？
- [${checklist.opportunityFirst ? "x" : " "}] 是否优先发现新机会？
- [${checklist.avoidsLegacyOptimization ? "x" : " "}] 是否避免默认优化旧项目？
- [${checklist.hasMonetizationAssessment ? "x" : " "}] 是否评估变现潜力？
- [${checklist.hasMvpValidationPath ? "x" : " "}] 是否给出 MVP 验证路径？
- 质量评分：${report.qualityValidation ? `${report.qualityValidation.score}/${report.qualityValidation.maxScore}` : "未运行"}
- 最值得执行：${checklist.bestSuggestion || ""}
- 应该忽略：${checklist.suggestionToIgnore || ""}

## Data Gaps

${bullet((report.dataGaps || []).map((item) => `${item.reason || "gap"}：${item.source || item.category || ""} ${item.note || ""}`))}

## Sources Used

${bullet((report.sourcesUsed || []).map(String))}

${report.warnings?.length ? `## Warnings\n\n${bullet(report.warnings)}` : ""}
`;
}

function validateReportQuality(report) {
  const trendHasEvidence = (item) =>
    item?.sourceIds?.length || item?.sourceUrls?.length || (typeof item?.evidence === "string" && item.evidence.trim());
  const validStageFit = (item) => ["now", "later", "not-yet", "blocked"].includes(item?.stageFit);
  const textOf = (item) =>
    [
      item?.title,
      item?.opportunityName,
      item?.action,
      item?.actionType,
      item?.relatedProject,
      item?.suggestedExperiment,
      item?.mvpForm,
      item?.firstValidationAction,
      item?.whyItMatters
    ]
      .filter(Boolean)
      .join(" ");
  const isPrematureNow = (item) => item?.stageFit === "now" && PREMATURE_NOW_PATTERN.test(textOf(item)) && !item.explicitOverrideReason;
  const hasPendingFeedback = (item) =>
    item?.humanFeedback?.decision === "pending" &&
    typeof item.humanFeedback.reason === "string" &&
    typeof item.humanFeedback.followUp === "string";
  const hasValidFeedback = (item) => FEEDBACK_DECISIONS.has(item?.humanFeedback?.decision);
  const reportGenerationActions = (report.recommendedActions || []).filter((item) =>
    /generate (another |a |one more |new |live )*.*report|再生成.*报告|生成.*报告/i.test(item.action || "")
  ).length;
  const validClassification = (item) => TREND_CLASSIFICATIONS.has(item?.classification);
  const hasOpportunityReason = (item) => typeof item?.opportunityReason === "string" && item.opportunityReason.trim();
  const hasOpportunityFields = (item) =>
    ["opportunityName", "sourceTrend", "monetizationPotential", "ericChanFit", "mvpForm", "firstValidationAction"].every(
      (key) => typeof item?.[key] === "string" && item[key].trim()
    ) &&
    typeof item.enterOpportunityPool === "boolean" &&
    typeof item.needsHumanConfirmation === "boolean" &&
    typeof item.shouldIgnore === "boolean";
  const validScoreValue = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
  const hasCompleteScores = (item) => OPPORTUNITY_SCORE_KEYS.every((key) => validScoreValue(item?.scores?.[key]));
  const hasLegacyOptimizationAction = (item) => LEGACY_ACTION_PATTERN.test(textOf(item));
  const hasValidActionType = (item) => ACTION_TYPES.has(item?.actionType);
  const weakOpportunityIsIgnored = (item) =>
    !(item?.scores?.monetizationPotential <= 2 && item?.scores?.ericChanFit <= 2) ||
    item.shouldIgnore === true ||
    ["watch", "ignore"].includes(item.status);
  const highComplexityIsNotNow = (item) => item?.scores?.complexityRisk < 4 || item.stageFit !== "now" || Boolean(item.explicitOverrideReason);
  const legacyLearningTexts = (report.trends || [])
    .filter((item) => item.classification === "legacy-learning-material" && LEGACY_PROJECT_PATTERN.test(textOf(item)))
    .map((item) => textOf(item));
  const legacyLearningStaysOutOfActions = (action) =>
    !legacyLearningTexts.length || !LEGACY_PROJECT_PATTERN.test(textOf(action)) || !hasLegacyOptimizationAction(action);

  const checks = [
    ["trends exists", () => Array.isArray(report.trends) && report.trends.length > 0],
    ["projectImpacts exists", () => Array.isArray(report.projectImpacts) && report.projectImpacts.length > 0],
    ["opportunities exists", () => Array.isArray(report.opportunities) && report.opportunities.length > 0],
    ["recommendedActions exists", () => Array.isArray(report.recommendedActions) && report.recommendedActions.length > 0],
    [
      "agentDispatchSuggestions exists",
      () => Array.isArray(report.agentDispatchSuggestions) && report.agentDispatchSuggestions.length > 0
    ],
    ["obsidianExport exists", () => Boolean(report.obsidianExport)],
    [
      "trends has at least one relatedProject",
      () => (report.trends || []).some((item) => typeof item.relatedProject === "string" && item.relatedProject.trim())
    ],
    ["trends include valid classification", () => (report.trends || []).every((item) => validClassification(item) && hasOpportunityReason(item))],
    ["each trend has evidence", () => (report.trends || []).every(trendHasEvidence)],
    ["trends do not include Placeholder items", () => (report.trends || []).every((item) => !/placeholder/i.test(item.title || ""))],
    ["dataGaps exists", () => Array.isArray(report.dataGaps)],
    [
      "opportunities has at least one relatedProject",
      () =>
        (report.opportunities || []).some(
          (item) => typeof item.relatedProject === "string" && item.relatedProject.trim()
        )
    ],
    ["opportunities include stageFit", () => (report.opportunities || []).every(validStageFit)],
    ["opportunities include monetization and MVP fields", () => (report.opportunities || []).every(hasOpportunityFields)],
    ["opportunities include scoring fields", () => (report.opportunities || []).every(hasCompleteScores)],
    ["low monetization and low fit opportunities are ignored or watched", () => (report.opportunities || []).every(weakOpportunityIsIgnored)],
    ["high complexity opportunities are not stageFit now", () => (report.opportunities || []).every(highComplexityIsNotNow)],
    ["opportunities include pending humanFeedback", () => (report.opportunities || []).every(hasPendingFeedback)],
    [
      "recommendedActions has at least one executable action",
      () => (report.recommendedActions || []).some((item) => typeof item.action === "string" && item.action.trim())
    ],
    ["recommendedActions include stageFit", () => (report.recommendedActions || []).every(validStageFit)],
    ["recommendedActions include valid actionType", () => (report.recommendedActions || []).every(hasValidActionType)],
    ["recommendedActions avoid legacy project optimization", () => (report.recommendedActions || []).every((item) => !hasLegacyOptimizationAction(item))],
    ["legacy-learning-material trends do not become actions", () => (report.recommendedActions || []).every(legacyLearningStaysOutOfActions)],
    ["recommendedActions start with pending humanFeedback", () => (report.recommendedActions || []).every(hasPendingFeedback)],
    ["humanFeedback decisions are valid", () => [...(report.opportunities || []), ...(report.recommendedActions || [])].every(hasValidFeedback)],
    ["humanFeedbackRequired exists", () => report.humanFeedbackRequired === true],
    [
      "generate another live report actions stay under one third",
      () => !report.recommendedActions?.length || reportGenerationActions <= Math.floor(report.recommendedActions.length / 3)
    ],
    [
      "high priority build opportunities are not blocked",
      () =>
        (report.opportunities || []).every(
          (item) => !(item.priority === "high" && item.status === "build" && ["not-yet", "blocked"].includes(item.stageFit))
        )
    ],
    ["today actions are stageFit now", () => (report.recommendedActions || []).every((item) => item.urgency !== "today" || item.stageFit === "now")],
    [
      "premature build/deployment suggestions are not stageFit now",
      () => [...(report.opportunities || []), ...(report.recommendedActions || [])].every((item) => !isPrematureNow(item))
    ],
    ["qualityChecklist.boundToProjects is true", () => report.qualityChecklist?.boundToProjects === true],
    ["qualityChecklist.hasExecutableAction is true", () => report.qualityChecklist?.hasExecutableAction === true],
    ["qualityChecklist.avoidsGenericSummary is true", () => report.qualityChecklist?.avoidsGenericSummary === true],
    ["qualityChecklist.evidenceBacked is true", () => report.qualityChecklist?.evidenceBacked === true],
    ["qualityChecklist.stageAppropriate is true", () => report.qualityChecklist?.stageAppropriate === true],
    ["qualityChecklist.noPlaceholderAsTrend is true", () => report.qualityChecklist?.noPlaceholderAsTrend === true],
    ["qualityChecklist.avoidsPrematureBuild is true", () => report.qualityChecklist?.avoidsPrematureBuild === true],
    ["qualityChecklist.opportunityFirst is true", () => report.qualityChecklist?.opportunityFirst === true],
    ["qualityChecklist.avoidsLegacyOptimization is true", () => report.qualityChecklist?.avoidsLegacyOptimization === true],
    ["qualityChecklist.hasMonetizationAssessment is true", () => report.qualityChecklist?.hasMonetizationAssessment === true],
    ["qualityChecklist.hasMvpValidationPath is true", () => report.qualityChecklist?.hasMvpValidationPath === true]
  ].map(([name, check]) => ({ name, pass: Boolean(check()) }));

  const failures = checks.filter((item) => !item.pass).map((item) => item.name);
  return {
    ok: failures.length === 0,
    score: checks.length - failures.length,
    maxScore: checks.length,
    checks,
    failures
  };
}

async function generateReport({ rootDir = process.cwd(), mock = false, date = getDateString() } = {}) {
  const warnings = [];
  const contextText = readText(path.join(rootDir, "context", "context.md"));
  const promptText = readText(path.join(rootDir, "prompts", "analysis-prompt.md"));
  const rawItems = await collectRawItems({ rootDir, date, mock, warnings });
  const dataGaps = createDataGaps(rawItems, warnings);
  const verifiedRawItems = rawItems.filter((item) => !isManualPlaceholderItem(item));

  writeRawSnapshot(rootDir, date, rawItems, warnings);

  let report;
  try {
    report = await analyzeWithLlm({ rootDir, date, rawItems: verifiedRawItems, dataGaps, contextText, promptText, warnings, mock });
  } catch (error) {
    warnings.push(`${error.message}; fallback mock analysis mode used.`);
    report = createMockAnalysis({ date, rawItems, contextText, warnings });
  }

  if (!Array.isArray(report.dataGaps)) report.dataGaps = dataGaps;
  applyHumanFeedbackDefaults(report);

  report.qualityValidation = validateReportQuality(report);

  const markdown = renderMarkdown(report);
  const reportsDir = path.join(rootDir, "reports");
  const dataReportsDir = path.join(rootDir, "data", "reports");
  ensureDir(reportsDir);
  ensureDir(dataReportsDir);
  fs.writeFileSync(path.join(reportsDir, `${date}.md`), markdown);
  fs.writeFileSync(path.join(dataReportsDir, `${date}.json`), JSON.stringify(report, null, 2));

  return {
    report,
    markdown,
    markdownPath: path.join(reportsDir, `${date}.md`),
    jsonPath: path.join(dataReportsDir, `${date}.json`),
    rawPath: path.join(rootDir, "data", "raw", `${date}.json`)
  };
}

function cleanGenerated(rootDir) {
  for (const dir of ["reports", path.join("data", "reports"), path.join("data", "raw")]) {
    const absoluteDir = path.join(rootDir, dir);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const entry of fs.readdirSync(absoluteDir)) {
      if (entry === ".gitkeep") continue;
      fs.unlinkSync(path.join(absoluteDir, entry));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootDir = process.cwd();

  if (args.includes("--clean")) {
    cleanGenerated(rootDir);
    console.log("Cleaned generated report files.");
    return;
  }

  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();
  const result = await generateReport({ rootDir, mock: args.includes("--mock"), date });

  console.log(`Markdown report: ${result.markdownPath}`);
  console.log(`JSON report: ${result.jsonPath}`);
  console.log(`Raw snapshot: ${result.rawPath}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  cleanGenerated,
  createMockAnalysis,
  generateReport,
  getDateString,
  renderMarkdown,
  validateReportQuality
};
