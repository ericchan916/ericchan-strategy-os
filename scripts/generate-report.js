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
  const items = rawItems.length ? rawItems : mockRawItems(date);
  const contextHint = contextText.includes("OPC") ? "OPC" : "EricChan Strategy OS";

  return {
    date,
    generatedAt: new Date().toISOString(),
    mode: "mock",
    sourcesUsed: [...new Set(items.map((item) => item.source))],
    warnings,
    trends: items.slice(0, 5).map((item, index) => ({
      title: item.title,
      summary: item.summary,
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
        relationship: "Agent 和长上下文趋势可转化为人格记忆、语气稳定性和可验证对话实验。"
      },
      {
        project: "个人传记网站 / iPortfolio",
        relationship: "设计工具变化可用于升级信息架构和作品表达，但不应污染当前战略引擎上下文。"
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
        project: "XiaoChan AI Persona",
        impact: "可设计一组 persona 回答稳定性评测，验证上下文压缩与记忆策略。",
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
        title: "把日报行动项转成智能体派发队列",
        relatedTrend: "Agentic planning and tool use",
        relatedProject: "EricChan·战略OS",
        whyItMatters: "它让日报从信息消费变成项目推进入口。",
        suggestedExperiment: "连续 3 天生成日报，统计每日报告是否能产生至少 1 个可执行任务。",
        recommendedAgent: "GPT 5.5 Thinking + Codex",
        priority: "high",
        status: "test"
      },
      {
        title: "小Chan Persona 记忆稳定性检查",
        relatedTrend: "Long-context model workflows",
        relatedProject: "小Chan AI Persona",
        whyItMatters: "Persona 项目需要避免每次对话都重新解释身份或风格。",
        suggestedExperiment: "准备 5 个重复问题，比较回答是否保持第一人称、幽默和事实一致。",
        recommendedAgent: "Codex",
        priority: "medium",
        status: "test"
      },
      {
        title: "iPortfolio 信息架构审美升级观察",
        relatedTrend: "Editable generated design systems",
        relatedProject: "个人传记网站 / iPortfolio",
        whyItMatters: "设计工具可以辅助表达升级，但 Stage 0.5 不应切到 UI 重构。",
        suggestedExperiment: "只收集参考，不进入本阶段构建。",
        recommendedAgent: "OpenDesign",
        priority: "low",
        status: "watch"
      }
    ],
    recommendedActions: [
      {
        action: "先跑通 3 天 mock/真实混合报告，观察建议是否持续绑定具体项目。",
        owner: "EricChan",
        urgency: "today"
      },
      {
        action: "把最高优先级 opportunity 手动转成 Obsidian 任务卡。",
        owner: "Obsidian + Claudian",
        urgency: "today"
      },
      {
        action: "只在报告质量稳定后再做 Dashboard。",
        owner: "GPT 5.5 Thinking",
        urgency: "watch"
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
      bestSuggestion: "把日报行动项转成智能体派发队列。",
      suggestionToIgnore: "现在就做完整 Dashboard。"
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

async function analyzeWithLlm({ rootDir, date, rawItems, contextText, promptText, warnings, mock }) {
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
          content: JSON.stringify({ date, ericChanContext: contextText, rawItems, requiredAgents: AGENTS }, null, 2)
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

- 相关趋势：${item.relatedTrend}
- 相关项目：${item.relatedProject}
- 为什么重要：${item.whyItMatters}
- 建议实验：${item.suggestedExperiment}
- 推荐智能体：${item.recommendedAgent}
- 优先级：${item.priority}
- 状态：${item.status}`
  )
  .join("\n\n")}

## 6. 推荐下一步行动

${bullet(actions.map((item) => `${item.action} 负责人：${item.owner}；紧急度：${item.urgency}`))}

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
- 最值得执行：${checklist.bestSuggestion || ""}
- 应该忽略：${checklist.suggestionToIgnore || ""}

## Sources Used

${bullet((report.sourcesUsed || []).map(String))}

${report.warnings?.length ? `## Warnings\n\n${bullet(report.warnings)}` : ""}
`;
}

async function generateReport({ rootDir = process.cwd(), mock = false, date = getDateString() } = {}) {
  const warnings = [];
  const contextText = readText(path.join(rootDir, "context", "context.md"));
  const promptText = readText(path.join(rootDir, "prompts", "analysis-prompt.md"));
  const rawItems = await collectRawItems({ rootDir, date, mock, warnings });

  writeRawSnapshot(rootDir, date, rawItems, warnings);

  let report;
  try {
    report = await analyzeWithLlm({ rootDir, date, rawItems, contextText, promptText, warnings, mock });
  } catch (error) {
    warnings.push(`${error.message}; fallback mock analysis mode used.`);
    report = createMockAnalysis({ date, rawItems, contextText, warnings });
  }

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
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  cleanGenerated,
  createMockAnalysis,
  generateReport,
  getDateString,
  renderMarkdown
};
