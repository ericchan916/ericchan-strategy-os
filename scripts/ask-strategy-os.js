#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");
const { readConfig, isConfigured, callChatCompletion, LlmError } = require("./llm-client");
const { searchWeb, toPublicSearchMeta, shouldUseWebSearch } = require("./search-client");
require("./load-env"); // 静默补全 STRATEGY_OS_LLM_* / LLM_*；shell 优先。

const LLM_FALLBACK_WARNING = "LLM 动态回答暂时不可用，已回退到本地规则回答。";
const ASK_MODE_SYSTEM_PROMPT_PATH = path.join(__dirname, "..", "prompts", "ask-mode-system-prompt.md");
const ASK_MODE_SYSTEM_PROMPT_FALLBACK =
  "你是 EricChan·战略OS 的战略总控问答模块。请只用中文回答：你是中文战略助手，**不是模板填空器**。不要每次都机械输出\u201C结论 / 理由 / 行动 / 今天不要做\u201D四段式。请先判断问题类型（决策型 vs 自然回答型），再选择最合适的回答形式。决策型问题（今天适合做什么、是否开新项目、当前项目优先级、是否过度复杂、智能体分工）按需精简保留结构，但**不强求每次都有四项**；其它场景（概念解释、界面使用、体验反馈、能力确认、闲聊式提问、为什么、比较工具、提示词请求、技术排查）直接自然回答，不必强行使用结论 / 理由 / 行动 / 今天不要做。项目体检与项目开工包仍保留各自结构化骨架。不要默认建议更新旧项目（iPortfolio、小Chan、节律 App 等只作为学习材料）；项目开工包必须先交给 GPT 5.5 Thinking 总控判断，再决定是否派发 Codex / WorkBuddy / OpenDesign / MiniMax。不得输出任何英文句子（技术名词如 GPT 5.5 Thinking、Codex、OpenDesign、MiniMax、WorkBuddy、API、MVP、OPC、LLM 例外），不得输出 思 标签、Analysis/Reasoning/Thought/Chain of thought/CoT/Internal reasoning 段落，不得出现 We need to / Let's analyze / The user asks 等英文元说明，不得输出 validate / accepted / watch / local-fallback / source / trigger / stageFit 等内部状态词。所有理由必须是简短结论，不要展示逐步推理。";;

const DEFAULT_QUESTIONS = [
  "今天适合做什么？",
  "当前项目哪个最值得推进？",
  "我现在该不该开新项目？",
  "我看到一个好项目，帮我体检一下。",
  "帮我生成项目开工包。",
  "这件事该交给哪个智能体？",
  "我是不是把事情搞复杂了？"
];

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function askPaths(rootDir, date) {
  return {
    contextPath: path.join(rootDir, "context", "context.md"),
    reportPath: path.join(rootDir, "data", "reports", `${date}.json`),
    poolPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    dailyCommandMarkdownPath: path.join(rootDir, "daily-command", `${date}.md`),
    dailyCommandJsonPath: path.join(rootDir, "data", "daily-command", `${date}.json`),
    feedbackPath: path.join(rootDir, "feedback", `${date}.md`),
    reviewPath: path.join(rootDir, "reviews", `${date}-review.md`),
    proposalPath: path.join(rootDir, "proposals", `${date}-update-proposal.md`),
    recommendedQuestionsPath: path.join(rootDir, "config", "recommended-questions.json")
  };
}

function loadAskContext({ rootDir = process.cwd(), date = getDateString() } = {}) {
  const paths = askPaths(rootDir, date);
  return {
    date,
    paths,
    contextText: readText(paths.contextPath),
    report: readJson(paths.reportPath, null),
    opportunityPool: readJson(paths.poolPath, null),
    dailyCommand: readJson(paths.dailyCommandJsonPath, null),
    dailyCommandMarkdown: readText(paths.dailyCommandMarkdownPath),
    feedbackText: readText(paths.feedbackPath),
    reviewText: readText(paths.reviewPath),
    proposalText: readText(paths.proposalPath),
    recommendedQuestions: readJson(paths.recommendedQuestionsPath, DEFAULT_QUESTIONS)
  };
}

function classifyQuestion(question) {
  const text = String(question || "").toLowerCase();
  if (/开工包|kickoff/.test(text)) return "kickoff-package";
  if (/体检|适不适合|值不值得|好项目|项目.*判断/.test(text)) return "project-checkup";
  if (/今天|现在.*做|适合做什么|该做什么/.test(text)) return "today-action";
  if (/哪个.*推进|优先级|最值得推进|当前项目/.test(text)) return "project-priority";
  if (/该不该开新项目|是否.*开新项目|要不要开新项目/.test(text)) return "new-project-decision";
  if (/交给哪个智能体|派发|分工|agent|智能体/.test(text)) return "agent-dispatch";
  if (/复杂|搞复杂|过度|太重|太复杂/.test(text)) return "complexity-check";
  return "general-strategy-question";
}

function listRecommendedQuestions(questions = DEFAULT_QUESTIONS) {
  return `# 推荐问题

${questions.map((item) => `- ${item}`).join("\n")}
`;
}

function projectNameFrom(question) {
  const text = String(question || "").trim();
  const colon = text.match(/[:：]\s*(.+)$/);
  if (colon) return cleanupProjectName(colon[1]);
  return cleanupProjectName(
    text
      .replace(/我看到一个/g, "")
      .replace(/帮我生成这个项目的开工包/g, "")
      .replace(/帮我生成项目开工包/g, "")
      .replace(/帮我体检一下/g, "")
      .replace(/帮我判断适不适合我做/g, "")
      .replace(/项目/g, "项目")
  );
}

function cleanupProjectName(value) {
  return String(value || "")
    .replace(/帮我.*$/g, "")
    .replace(/[，,。？?！!：:；;、\s]+$/g, "")
    .trim() || "这个项目";
}

function trimSentenceEnd(value) {
  return String(value || "").replace(/[。.!！\s]+$/g, "");
}

function poolItems(context, status) {
  return (context.opportunityPool?.opportunities || []).filter((item) => item.status === status);
}

function firstAction(context) {
  return context.dailyCommand?.recommendedActions?.[0];
}

function dataNotice(context) {
  if (context.dailyCommand || context.dailyCommandMarkdown) return "";
  return "\n\n提示：今天还没有生成 Daily Command。你可以先运行 `npm run today`。";
}

function renderTodayAction(context) {
  const action = firstAction(context);
  const top = context.dailyCommand?.topOpportunities?.[0];
  const line = context.dailyCommand?.oneLineJudgment || "今天先保持轻量，不开复杂新流程。";
  const actionText = action
    ? `${trimSentenceEnd(action.action)}。产出：${trimSentenceEnd(action.expectedOutput || "一个可检查的小结果")}。时间盒：${trimSentenceEnd(action.timebox || "30-60 分钟")}。`
    : "先运行 `npm run today`，再根据 Daily Command 选一件最小动作。";

  return `# 今天适合做什么

结论：${line}

理由：
- 当前最值得看的机会：${top?.opportunityName || "今天没有明确的新机会需要推进"}。
- 今天的目标是减少决策负担，不是扩展系统。
- 如果 sourceMode 是 mock，就只把它当方向提示，不当最终判断。

行动：
- ${actionText}
- 把今天明显不该做的事写进 Obsidian。
- 如果感觉建议泛泛，就追问：“这件事为什么今天做？”

今天不要做：
- 不做 Dashboard。
- 不部署。
- 不修改旧项目。${dataNotice(context)}
`;
}

function renderProjectPriority(context) {
  const validate = poolItems(context, "validate")[0];
  const watch = poolItems(context, "watch")[0];
  return `# 当前项目优先级

结论：优先推进 ${validate?.opportunityName || "已经验证过且还没变复杂的个人可用机会"}。

理由：
- validate 状态比 watch 状态更接近行动。
- 当前阶段优先个人可用，不优先做对外产品化。
- 内部质量类机会可以观察，但不要抢走主线。

行动：
- 今天只推进一个最小验证动作。
- watch 项目只记录，不开工。
- 没有 validate 机会时，先运行 \`npm run today\` 更新上下文。

今天不要做：
- 不同时推进多个机会。
- 不把内部系统改进包装成新产品。
- 不让旧项目优化占据主线。

参考 watch：${watch?.opportunityName || "暂无"}。${dataNotice(context)}
`;
}

function renderNewProjectDecision(context) {
  const decision = context.dailyCommand?.newProjectDecision;
  return `# 是否应该开新项目

结论：${decision?.decision === "yes" ? "可以进入下一步确认" : decision?.decision === "no" ? "今天不建议开新项目" : "还不到正式开新项目的时候"}。

理由：
- ${decision?.reason || "当前更适合先做小验证，而不是创建完整项目。"}
- 需要先看机会是否有明确用户、MVP 形态和第一轮验证动作。
- 如果还需要大量想象才能成立，就先放进 watch。

行动：
- 先写一句话项目假设。
- 再写一个 30-60 分钟能完成的验证动作。
- 通过后再生成项目开工包交给 GPT 5.5 Thinking 总控判断。

今天不要做：
- 不直接开 repo。
- 不直接派给 Codex。
- 不做复杂商业化流程。${dataNotice(context)}
`;
}

function renderAgentDispatch(context) {
  return `# 智能体分工建议

结论：先交给 GPT 5.5 Thinking 做战略判断，只有判断通过后再考虑派发。

建议：
- GPT 5.5 Thinking：判断是否适合当前阶段、是否进机会池、今天是否该动。
- WorkBuddy + DeepSeek：只有需要外部调研、市场验证、竞品信息时再用。
- Codex：只有出现明确工程 MVP 和验收标准时再用。
- OpenDesign / MiniMax：只有需要视觉原型、动效或传播内容时再进场。
- Obsidian + Claudian：归档判断、版本和复盘。

今天不要做：
- 不把“看起来有趣”直接变成工程任务。
- 不让 Codex 接一个还没被总控判断过的项目。
- 不为了派发而派发。${dataNotice(context)}
`;
}

function renderComplexityCheck(context) {
  return `# 复杂度检查

结论：如果一个想法今天不能压成一句话假设和一个小验证动作，就先降级。

理由：
- 当前系统目标是服务 EricChan 当天判断，不是制造流程。
- Dashboard、部署、自动多智能体都不是今天的默认动作。
- 好项目应该先变清楚，再变大。

行动：
- 写一句话：这个项目解决谁的什么问题。
- 写一个最小效果：30-60 分钟能看到什么。
- 写一个停止条件：什么信号出现就先不做。

今天不要做：
- 不补复杂 UI。
- 不开多个并行项目。
- 不把工具链升级当成进展。${dataNotice(context)}
`;
}

function renderGeneral(context, question) {
  return `# 战略回答

结论：先把问题压成“今天是否需要行动”，再决定是否进入机会池或开工包。

理由：
- 你的问题是：${question || "未提供问题"}。
- 当前 Strategy OS 更适合主动问答，而不是自动推着你做事。
- 任何新项目都先由 GPT 5.5 Thinking 总控判断。

行动：
- 如果是今天动作，问：“今天适合做什么？”
- 如果是新项目，问：“帮我体检一下这个项目。”
- 如果准备推进，问：“帮我生成项目开工包。”

今天不要做：
- 不直接改旧项目。
- 不直接开复杂工程。
- 不跳过战略判断。${dataNotice(context)}
`;
}

function renderProjectCheckup(context, question) {
  const name = projectNameFrom(question);
  return `# 项目体检

## 1. 项目一句话

${name}：把一个可感知的小场景做成可展示、可验证的个人项目。

## 2. 值不值得做

- 判断：可以试试

## 3. 适合 EricChan 的原因

- 它适合做成小而克制的作品，不必一开始商业化。
- 它能沉淀审美、产品判断和执行风格。
- 如果能连接 OPC、AI 工具或内容资产，会更值得进入机会池。

## 4. 不适合或风险

- 容易从“小效果”膨胀成完整产品。
- 如果硬件、供应链或长期维护太重，会拖慢主线。
- 如果没有明确用户或内容资产价值，可能只是兴趣项目。

## 5. 难度判断

- 难度：3/5
- 解释：第一轮效果可以很小，但完整项目可能涉及设计、工程、材料和长期维护。

## 6. 最小可验证效果

先做一张静态效果图、一段交互说明或一个纸面流程，不直接做完整项目。

## 7. 先准备什么

- 一句话目标用户。
- 一张参考图或参考项目链接。
- 一个 30-60 分钟内能完成的最小效果。

## 8. 可能卡在哪里

- 目标用户不清楚。
- 视觉效果有趣，但使用频率不足。
- 第一版范围太大。

## 9. 推荐智能体

- GPT 5.5 Thinking：先判断是否适合当前阶段。
- WorkBuddy + DeepSeek：需要外部案例或市场信号时再调研。
- OpenDesign / MiniMax：需要视觉探索时再进场。
- Codex：只有总控确认工程 MVP 后再进入。

## 10. 下一步建议

- 建议：生成开工包
- 说明：先把它交给 GPT 5.5 Thinking 总控判断，不直接进入工程开工。${dataNotice(context)}
`;
}

function renderKickoffPackage(context, question) {
  const name = projectNameFrom(question);
  return `# 项目开工包：交给 GPT 5.5 Thinking 总控

## 1. 项目背景

项目名称：${name}。当前只做战略判断，不做工程开工。

## 2. 用户为什么感兴趣

EricChan 可能被它的作品感、可展示性、个人使用价值或新机会潜力吸引。

## 3. 项目可能解决的问题

- 帮用户把一个具体场景变得更清晰、更好用或更有表达感。
- 形成一个可以展示的能力样本。
- 可能沉淀成内容资产、产品原型或机会池候选。

## 4. 目标用户假设

- EricChan 自己。
- 独立开发者或 OPC 探索者。
- 喜欢小而美工具或 AI 工作流的人。

## 5. 与 EricChan 的匹配度

初步判断：中高。前提是它能保持轻量、克制，并有明确的第一轮验证效果。

## 6. 当前阶段判断

现在适合做战略总控判断，不适合直接工程化。

## 7. 最小 MVP 假设

先做一页项目说明、一个静态样例或一个可讲清楚的使用流程，验证“别人是否觉得它有用或值得看”。

## 8. 风险与不确定性

- 是否只是视觉上有趣。
- 是否有真实使用频率。
- 是否会牵出过重的硬件、部署或长期维护。
- 是否能变成内容资产或变现线索。

## 9. 建议先问 GPT 总控的问题

- 这个项目是否适合 EricChan 当前阶段？
- 是否有变现或内容资产价值？
- 是否应该进入机会池？
- 是否需要 WorkBuddy 调研？
- 是否需要 OpenDesign / MiniMax 做视觉探索？
- 是否需要 Codex 做工程 MVP？
- 今天是否应该开工？

## 10. 如果总控同意，下一步可能派发给谁

- GPT 5.5 Thinking：战略判断。
- WorkBuddy + DeepSeek：调研。
- Codex：工程实现。
- OpenDesign：视觉原型。
- MiniMax：视觉挑战 / 动效 / 传播内容。
- Obsidian + Claudian：归档。

今天不要做：
- 不直接创建工程任务。
- 不跳过 GPT 总控。
- 不把旧项目改造当成这个项目的默认路径。${dataNotice(context)}
`;
}

function renderAnswer({ context, question }) {
  const type = classifyQuestion(question);
  if (!question) return listRecommendedQuestions(context.recommendedQuestions);
  if (type === "today-action") return renderTodayAction(context);
  if (type === "project-priority") return renderProjectPriority(context);
  if (type === "new-project-decision") return renderNewProjectDecision(context);
  if (type === "project-checkup") return renderProjectCheckup(context, question);
  if (type === "kickoff-package") return renderKickoffPackage(context, question);
  if (type === "agent-dispatch") return renderAgentDispatch(context);
  if (type === "complexity-check") return renderComplexityCheck(context);
  return renderGeneral(context, question);
}

function appendSearchSources(answer, search) {
  if (!search || !Array.isArray(search.results) || !search.results.length) return answer;
  const lines = search.results.slice(0, 5).map((item, index) => `${index + 1}. ${item.title} — ${item.source || item.url}`);
  return `${String(answer || "").trim()}

参考来源：
${lines.join("\n")}
`;
}

async function resolveSearch({ question, env, deps = {} }) {
  const fn = deps.searchWeb || searchWeb;
  try {
    return await fn({
      query: question,
      env,
      fetchImpl: deps.searchFetch || deps.fetch,
      abortImpl: deps.AbortController
    });
  } catch {
    return {
      provider: "",
      query: String(question || ""),
      results: [],
      warning: "联网搜索暂时不可用，已使用本地上下文回答。",
      errorCode: "unknown"
    };
  }
}

function askStrategyOs({ rootDir = process.cwd(), date = getDateString(), question = "", env = process.env } = {}) {
  // 同步入口：不调用 LLM，始终返回本地规则回答。
  // 服务端 /api/ask 应改用 askStrategyOsAsync 以启用 LLM 动态回答。
  const context = loadAskContext({ rootDir, date });
  return {
    type: classifyQuestion(question),
    answer: renderAnswer({ context, question }),
    source: "local",
    llmEnabled: isConfigured(readConfig(env)),
    warning: null,
    search: toPublicSearchMeta(null),
    context
  };
}

async function askStrategyOsAsync({ rootDir = process.cwd(), date = getDateString(), question = "", env = process.env, useSearch = false, deps = {} } = {}) {
  const context = loadAskContext({ rootDir, date });
  const type = classifyQuestion(question);
  const explicitSearch = useSearch === true;
  const searchResult = explicitSearch ? await resolveSearch({ question, env, deps }) : null;
  const searchMeta = toPublicSearchMeta(searchResult);
  const localAnswer = appendSearchSources(renderAnswer({ context, question }), searchResult);

  const llmConfig = readConfig(env);
  const llmEnabled = isConfigured(llmConfig);

  if (!llmEnabled) {
    return {
      type,
      answer: localAnswer,
      source: "local",
      llmEnabled: false,
      warning: null,
      search: searchMeta,
      context
    };
  }

  try {
    const answer = await callChatCompletion({
      config: llmConfig,
      systemPrompt: readSystemPrompt(),
      userPrompt: buildLlmUserPrompt({ context, type, question, search: searchResult }),
      fetchImpl: deps.fetch,
      abortImpl: deps.AbortController
    });
    if (answer) {
      return {
        type,
        answer,
        source: "llm",
        llmEnabled: true,
        warning: null,
        search: searchMeta,
        context
      };
    }
  } catch (error) {
    logLlmError(error);
  }

  return {
    type,
    answer: localAnswer,
    source: "local-fallback",
    llmEnabled: true,
    warning: LLM_FALLBACK_WARNING,
    search: searchMeta,
    context
  };
}

function readSystemPrompt() {
  return readText(ASK_MODE_SYSTEM_PROMPT_PATH) || ASK_MODE_SYSTEM_PROMPT_FALLBACK;
}

function trimContext(text, max = 600) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function buildLlmUserPrompt({ context, type, question, search = null }) {
  const lines = [];
  lines.push(`当前问题类型：${type}`);
  lines.push(`用户原始问题：${String(question || "").trim() || "（无）"}`);
  if (context.contextText) {
    lines.push("");
    lines.push("【用户上下文 / context.md】");
    lines.push(trimContext(context.contextText, 600));
  }
  if (context.dailyCommandMarkdown) {
    lines.push("");
    lines.push("【今天 Daily Command / daily-command/*.md】");
    lines.push(trimContext(context.dailyCommandMarkdown, 800));
  } else if (context.dailyCommand) {
    const top = context.dailyCommand.topOpportunities && context.dailyCommand.topOpportunities[0];
    const action = context.dailyCommand.recommendedActions && context.dailyCommand.recommendedActions[0];
    lines.push("");
    lines.push("【今天 Daily Command 摘要】");
    lines.push(`- oneLineJudgment: ${trimContext(context.dailyCommand.oneLineJudgment || "", 200)}`);
    if (top) lines.push(`- topOpportunity: ${top.opportunityName || ""}`);
    if (action) lines.push(`- firstAction: ${trimContext(action.action || "", 200)}`);
  }
  if (Array.isArray(context.opportunityPool && context.opportunityPool.opportunities)) {
    const items = context.opportunityPool.opportunities
      .slice(0, 5)
      .map((item) => `- ${item.opportunityName || item.id || "未命名"}（${item.status || "未知"} / ${item.humanDecision || "pending"}）`)
      .join("\n");
    if (items) {
      lines.push("");
      lines.push("【当前机会池（最多 5 条）】");
      lines.push(items);
    }
  }
  if (context.report) {
    const action = Array.isArray(context.report.recommendedActions) ? context.report.recommendedActions[0] : null;
    if (action && action.action) {
      lines.push("");
      lines.push("【最近 Report 第一建议】");
      lines.push(trimContext(action.action, 200));
    }
  }
  if (search && Array.isArray(search.results) && search.results.length) {
    lines.push("");
    lines.push("【外部搜索结果摘要】");
    lines.push(`原始问题：${trimContext(question, 160)}`);
    lines.push(`搜索意图：${trimContext(search.intent || "general", 80)}`);
    lines.push(`实际搜索词：${trimContext((search.plannedQueries || [search.query || question]).join(" / "), 360)}`);
    if (search.freshness) lines.push(`搜索时间范围：${trimContext(search.freshness, 80)}`);
    if (search.recency) {
      lines.push(`时效性要求：${search.recency.required ? "需要近期结果" : "不强制近期"}；${trimContext(search.recency.reason || "", 180)}`);
      lines.push(`时效性过滤：过旧 ${Number(search.recency.filteredOldCount || 0)} 条，缺少日期 ${Number(search.recency.missingDateCount || 0)} 条。`);
    }
    if (search.filters) {
      lines.push(`相关性过滤：无关财经 ${Number(search.filters.blockedTopicCount || 0)} 条，重复 ${Number(search.filters.duplicateCount || 0)} 条。`);
    }
    if (search.quality) {
      lines.push(`搜索质量摘要：平均 ${Number(search.quality.averageScore || 0)}，最高 ${Number(search.quality.topSourceScore || 0)}，低质来源 ${Number(search.quality.lowQualityCount || 0)} 条。${trimContext(search.quality.weakReason || "", 120)}`);
    }
    for (const item of search.results.slice(0, 5)) {
      lines.push(`- 标题：${trimContext(item.title, 120)}`);
      lines.push(`  URL：${trimContext(item.url, 220)}`);
      lines.push(`  来源：${trimContext(item.source, 80)}`);
      if (item.quality) lines.push(`  质量：${Number(item.quality.overallScore || 0)} / 100`);
      if (item.snippet) lines.push(`  摘要：${trimContext(item.snippet, 280)}`);
    }
    lines.push("");
    lines.push("【使用外部搜索结果的规则】");
    lines.push("- 搜索结果只是参考，不等于结论。");
    lines.push("- 回答必须区分基于本地上下文的判断与基于外部搜索的补充。");
    lines.push("- 不要编造搜索结果没有的信息；信息不足就说不足以判断。");
    lines.push("- 涉及最新信息时提醒它可能随时间变化。");
    lines.push("- 如果外部结果偏向 A股、行情、股票、盘面热点，不要把它当成 EricChan 主方向。");
    lines.push("- 如果外部结果明显过旧，降低权重；如果结果缺少日期，要说明时效性不确定。");
    lines.push("- 如果搜索质量摘要偏弱，不要把外部搜索当成强证据。");
    lines.push("- 优先判断搜索结果是否服务 AI 工具、Agent、独立开发者、小型可变现项目、OPC / 个人 OS、产品机会。");
    lines.push("- 如果外部搜索结果相关性较弱，要明确说明，并回到本地上下文判断。");
    lines.push("- 回答必须中文，不输出英文 reasoning。");
    lines.push("- 末尾最多列 3-5 个关键参考来源，不要堆长链接。");
  }
  return lines.join("\n");
}

async function tryLlmAnswerAsync({ config, context, type, question, deps = {} } = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const abortImpl = deps.AbortController || (typeof AbortController !== "undefined" ? AbortController : null);
  const systemPrompt = deps.systemPrompt || readSystemPrompt();
  const userPrompt = buildLlmUserPrompt({ context, type, question });
  return callChatCompletion({ config, systemPrompt, userPrompt, fetchImpl, abortImpl });
}

function logLlmError(error) {
  if (!error) return;
  const code = error instanceof LlmError ? error.code : "unknown";
  // 不输出 API Key；只输出 code 与非敏感的 message。
  const safeMessage = String(error.message || "").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
  console.warn(`[ask-mode] LLM 调用失败（${code}）：${safeMessage}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();
  const useSearch = args.includes("--search");
  const questionArgs =
    dateArgIndex >= 0 ? args.filter((_, index) => index !== dateArgIndex && index !== dateArgIndex + 1) : args;
  const cleanedQuestionArgs = questionArgs.filter((item) => item !== "--search");
  const question = cleanedQuestionArgs.join(" ").trim();
  askStrategyOsAsync({ rootDir: process.cwd(), date, question, useSearch })
    .then((result) => {
      if (result.search && result.search.warning) console.warn(result.search.warning);
      if (result.warning) console.warn(result.warning);
      console.log(result.answer.trim());
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

if (require.main === module) main();

module.exports = {
  askStrategyOs,
  askStrategyOsAsync,
  classifyQuestion,
  listRecommendedQuestions,
  loadAskContext,
  renderKickoffPackage,
  renderProjectCheckup,
  readSystemPrompt,
  buildLlmUserPrompt,
  shouldUseWebSearch,
  LLM_FALLBACK_WARNING
};
