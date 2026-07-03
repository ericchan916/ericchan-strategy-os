#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function readOptional(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonRequired(filePath, label) {
  return JSON.parse(readRequired(filePath, label));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function commandPaths(rootDir, date) {
  return {
    reportJsonPath: path.join(rootDir, "data", "reports", `${date}.json`),
    poolJsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    feedbackPath: path.join(rootDir, "feedback", `${date}.md`),
    reviewPath: path.join(rootDir, "reviews", `${date}-review.md`),
    proposalPath: path.join(rootDir, "proposals", `${date}-update-proposal.md`),
    markdownPath: path.join(rootDir, "daily-command", `${date}.md`),
    jsonPath: path.join(rootDir, "data", "daily-command", `${date}.json`)
  };
}

function poolSummary(pool) {
  const opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];
  const byStatus = (status) => opportunities.filter((item) => item.status === status);
  return {
    validate: byStatus("validate").map(summarizePoolOpportunity),
    watch: byStatus("watch").map(summarizePoolOpportunity),
    rejectedCount: byStatus("rejected").length,
    needsHumanProcessing: byStatus("inbox").length > 0 || byStatus("validate").some((item) => item.humanDecision === "pending")
  };
}

function summarizePoolOpportunity(item) {
  return {
    opportunityName: item.opportunityName,
    status: item.status,
    humanDecision: item.humanDecision,
    whyItMatters: item.whyItMatters || "",
    ericChanFit: item.ericChanFit || "",
    recommendedAgent: item.recommendedAgent || "",
    nextAction: item.reviewNextAction || item.firstValidationAction || ""
  };
}

function topOpportunitiesFrom(pool, report) {
  const opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];
  const validateItems = opportunities.filter((item) => item.status === "validate" && ["accepted", "watching"].includes(item.humanDecision));
  const blockedPoolNames = new Set(
    opportunities
      .filter((item) => item.status !== "validate" || !["accepted", "watching"].includes(item.humanDecision))
      .map((item) => normalize(item.opportunityName))
  );
  const reportItems = Array.isArray(report.opportunities) ? report.opportunities : [];
  const fallback = reportItems.filter(
    (item) =>
      item.shouldIgnore !== true &&
      item.enterOpportunityPool !== false &&
      !blockedPoolNames.has(normalize(item.opportunityName || item.title))
  );
  const seen = new Set();
  return [...validateItems, ...fallback]
    .filter(Boolean)
    .filter((item) => {
      const key = normalize(item.opportunityName || item.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((item) => ({
      opportunityName: item.opportunityName || item.title || "Untitled opportunity",
      whyEricChanFit: item.ericChanFit || item.whyItMatters || "Fits EricChan only if it can become a small, concrete personal strategy experiment.",
      actToday: item.status === "validate" || item.stageFit === "now",
      recommendedNextStep: item.reviewNextAction || item.firstValidationAction || item.suggestedExperiment || "Clarify one small validation action.",
      recommendedAgent: item.recommendedAgent || "GPT 5.5 Thinking"
    }));
}

function recommendedActionsFrom(report, pool) {
  const summary = poolSummary(pool);
  const firstValidate = summary.validate[0];
  const actions = [];

  if (firstValidate) {
    actions.push({
      action: `推进 ${firstValidate.opportunityName} 的个人可用验证`,
      whyNow: "它已经在机会池中处于 validate / accepted，是今天最接近实际推进的机会。",
      owner: "EricChan",
      expectedOutput: "一段可拿去给目标用户看的样例 brief 或一条明确访谈邀约。",
      timebox: "45-60 min"
    });
  }

  const reportAction = (report.recommendedActions || []).find((item) => item.stageFit === "now" && item.action);
  if (reportAction) {
    actions.push({
      action: reportAction.action,
      whyNow: "它来自今天报告中的 now 阶段建议，但要保持轻量，不扩展成新流程。",
      owner: reportAction.owner || "EricChan",
      expectedOutput: "一个可检查的文字产物或一次完成的小动作。",
      timebox: "30 min"
    });
  }

  actions.push({
    action: "归档今天的判断，并记录哪些建议不值得继续追",
    whyNow: "Daily Use Mode 的价值在于减少噪声，而不是增加待办。",
    owner: "Obsidian + Claudian",
    expectedOutput: "今日判断、忽略项、明日观察点各一条。",
    timebox: "10-15 min"
  });

  return dedupeByAction(actions).slice(0, 3);
}

function dedupeByAction(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    const key = item.action.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDailyCommand({ date, report, pool, optionalReads }) {
  const summary = poolSummary(pool);
  const topOpportunities = topOpportunitiesFrom(pool, report);
  const recommendedActions = recommendedActionsFrom(report, pool);
  const sourceMode = report.mode || "unknown";
  const firstOpportunity = topOpportunities[0];

  return {
    date,
    generatedAt: new Date().toISOString(),
    sourceMode,
    sourceWarnings: Array.isArray(report.warnings) ? report.warnings : [],
    optionalContextRead: optionalReads,
    oneLineJudgment: firstOpportunity
      ? `今天最重要的是把 ${firstOpportunity.opportunityName} 压成一个可验证的小动作，而不是扩展系统形态。`
      : "今天先降低噪声：没有足够强的新机会时，不开新项目、不做 Dashboard、不碰旧项目。",
    topOpportunities,
    ignoredNoise: [
      "旧项目优化：iPortfolio / XiaoChan / 节律 App 今天只作为学习材料，不作为行动对象。",
      "过早 Dashboard / 部署：当前先让 Daily Command 每天可用。",
      "过早商业化和复杂 MVP Spec：先验证个人使用价值，再决定是否产品化。"
    ],
    recommendedActions,
    opportunityPoolSummary: summary,
    agentDispatchSuggestions: buildAgentDispatchSuggestions(topOpportunities, recommendedActions),
    doNotDoToday: [
      "不要做 Dashboard。",
      "不要部署或统一 Vercel 架构。",
      "不要推进 watch 状态的内部质量门到 MVP。",
      "不要修改旧项目。"
    ],
    newProjectDecision: {
      decision: firstOpportunity ? "not-yet" : "no",
      reason: firstOpportunity
        ? "存在 validate 机会，但今天目标是个人可用验证，不是立刻开完整新项目。"
        : "今天没有足够强的 validate 机会。",
      requiredConfirmation: firstOpportunity
        ? "至少完成一个样例 brief 或一次目标用户反馈，再判断是否开新项目。"
        : "等待新的 validate / accepted 机会。"
    },
    tomorrowWatchItems: [
      "今天的 Daily Command 是否真的减少决策负担。",
      "Independent AI opportunity brief 是否能形成一个可展示样例。",
      "日报里是否继续出现旧项目优化或过早产品化噪声。"
    ]
  };
}

function buildAgentDispatchSuggestions(topOpportunities, actions) {
  const suggestions = [
    {
      agent: "GPT 5.5 Thinking",
      task: "把今天最强机会压成一段可给目标用户看的 brief 初稿。"
    },
    {
      agent: "Obsidian + Claudian",
      task: "归档今日判断、忽略项和明日观察点。"
    }
  ];

  if (actions.some((item) => /script|test|工程|代码|Codex/i.test(item.action))) {
    suggestions.push({ agent: "Codex", task: "只有出现明确工程改动时再维护脚本和测试。" });
  }
  if (topOpportunities.some((item) => /调研|market|用户|访谈|audience/i.test(item.recommendedNextStep))) {
    suggestions.push({ agent: "WorkBuddy + DeepSeek", task: "只在需要外部验证或用户样本时做轻量调研。" });
  }

  return suggestions;
}

function renderList(items, renderer = (item) => `- ${item}`) {
  return items.length ? items.map(renderer).join("\n") : "- None";
}

function renderDailyCommandMarkdown(command) {
  return `# EricChan·战略OS Daily Command - ${command.date}

sourceMode: ${command.sourceMode}
warnings: ${command.sourceWarnings.length ? command.sourceWarnings.join("; ") : "[]"}

## 1. 今日一句话判断

${command.oneLineJudgment}

## 2. 今日最值得关注的新机会

${renderList(
  command.topOpportunities,
  (item) => `### ${item.opportunityName}

- 为什么适合 EricChan: ${item.whyEricChanFit}
- 今天是否要行动: ${item.actToday ? "yes" : "no"}
- 推荐下一步: ${item.recommendedNextStep}
- 推荐智能体: ${item.recommendedAgent}`
)}

## 3. 今日可以忽略的噪声

${renderList(command.ignoredNoise)}

## 4. 今日行动建议

${renderList(
  command.recommendedActions,
  (item) => `### ${item.action}

- why now: ${item.whyNow}
- owner: ${item.owner}
- expected output: ${item.expectedOutput}
- timebox: ${item.timebox}`
)}

## 5. Opportunity Pool 状态

- validate 机会: ${command.opportunityPoolSummary.validate.map((item) => item.opportunityName).join(", ") || "None"}
- watch 机会: ${command.opportunityPoolSummary.watch.map((item) => item.opportunityName).join(", ") || "None"}
- rejected 机会数量: ${command.opportunityPoolSummary.rejectedCount}
- 今天是否需要人工处理: ${command.opportunityPoolSummary.needsHumanProcessing ? "yes" : "no"}

## 6. 智能体派发建议

${renderList(command.agentDispatchSuggestions, (item) => `- ${item.agent}: ${item.task}`)}

## 7. 今日不要做什么

${renderList(command.doNotDoToday)}

## 8. 是否需要开新项目

- decision: ${command.newProjectDecision.decision}
- reason: ${command.newProjectDecision.reason}
- required confirmation: ${command.newProjectDecision.requiredConfirmation}

## 9. 明天要观察什么

${renderList(command.tomorrowWatchItems)}
`;
}

function generateDailyCommand({ rootDir = process.cwd(), date = getDateString(), force = false } = {}) {
  const paths = commandPaths(rootDir, date);
  const report = readJsonRequired(paths.reportJsonPath, "Report JSON");
  const pool = readJsonRequired(paths.poolJsonPath, "Opportunity pool JSON");

  if (!force && (fs.existsSync(paths.markdownPath) || fs.existsSync(paths.jsonPath))) {
    throw new Error(`Daily Command already exists for ${date}. Use --force to overwrite.`);
  }

  const optionalReads = {
    feedback: Boolean(readOptional(paths.feedbackPath)),
    review: Boolean(readOptional(paths.reviewPath)),
    proposal: Boolean(readOptional(paths.proposalPath))
  };
  const command = buildDailyCommand({ date, report, pool, optionalReads });
  const markdown = renderDailyCommandMarkdown(command);

  ensureDir(path.dirname(paths.markdownPath));
  ensureDir(path.dirname(paths.jsonPath));
  fs.writeFileSync(paths.markdownPath, markdown);
  fs.writeFileSync(paths.jsonPath, JSON.stringify(command, null, 2));

  return {
    date,
    reportRead: true,
    opportunityPoolRead: true,
    markdownPath: paths.markdownPath,
    jsonPath: paths.jsonPath,
    command,
    markdown
  };
}

function printSummary(result) {
  console.log("Daily Command summary");
  console.log(`Date: ${result.date}`);
  console.log(`sourceMode: ${result.command.sourceMode}`);
  console.log(`Recommended actions: ${result.command.recommendedActions.length}`);
  console.log(`Report read: ${result.reportRead ? "yes" : "no"}`);
  console.log(`Opportunity pool read: ${result.opportunityPoolRead ? "yes" : "no"}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSON: ${result.jsonPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();

  try {
    printSummary(generateDailyCommand({ rootDir: process.cwd(), date, force: args.includes("--force") }));
  } catch (error) {
    console.error(`Daily Command failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDailyCommand,
  generateDailyCommand,
  renderDailyCommandMarkdown
};
