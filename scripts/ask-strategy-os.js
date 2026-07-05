#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");
const { readConfig, isConfigured, callChatCompletion, LlmError } = require("./llm-client");
const { redactSecretLikeText } = require("./secret-redact");
const { searchWeb, toPublicSearchMeta, shouldUseWebSearch } = require("./search-client");
const { buildOpportunityContextForPrompt } = require("./opportunity-store");
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
  let answer = "";
  if (type === "today-action") answer = renderTodayAction(context);
  else if (type === "project-priority") answer = renderProjectPriority(context);
  else if (type === "new-project-decision") answer = renderNewProjectDecision(context);
  else if (type === "project-checkup") answer = renderProjectCheckup(context, question);
  else if (type === "kickoff-package") answer = renderKickoffPackage(context, question);
  else if (type === "agent-dispatch") answer = renderAgentDispatch(context);
  else if (type === "complexity-check") answer = renderComplexityCheck(context);
  else answer = renderGeneral(context, question);
  return appendCurrentGoalAnchor(answer, context);
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

function askStrategyOs({ rootDir = process.cwd(), date = getDateString(), question = "", env = process.env, currentGoal = "" } = {}) {
  // 同步入口：不调用 LLM，始终返回本地规则回答。
  // 服务端 /api/ask 应改用 askStrategyOsAsync 以启用 LLM 动态回答。
  const context = loadAskContext({ rootDir, date });
  context.currentGoal = sanitizeCurrentGoal(currentGoal);
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

async function askStrategyOsAsync({ rootDir = process.cwd(), date = getDateString(), question = "", env = process.env, useSearch = false, currentGoal = "", deps = {} } = {}) {
  const context = loadAskContext({ rootDir, date });
  context.currentGoal = sanitizeCurrentGoal(currentGoal);
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
      userPrompt: buildLlmUserPrompt({ context, type, question, search: searchResult, currentGoal: context.currentGoal }),
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

// V0.3.11：从机会卡生成"开工包"
// 输入：opportunity（normalize 后的对象）
// 输出：{ answer, source, warning }
//  - 使用现有 LLM 客户端
//  - 不联网（默认）
//  - 不调用真实 Codex / WorkBuddy / MiniMax
//  - 失败时回退到本地"保守开工包"模板，仍能给出结构化建议
async function generateKickoffPackageForOpportunity({ opportunity, env = process.env, currentGoal = "", deps = {} } = {}) {
  if (!opportunity || typeof opportunity !== "object") {
    const error = new Error("机会数据不完整。");
    error.statusCode = 400;
    throw error;
  }
  const safeCurrentGoal = sanitizeCurrentGoal(currentGoal);
  const name = opportunity.displayTitle || opportunity.opportunityName || "未命名机会";
  const oneLine = String(opportunity.oneLineSummary || "").trim();
  const note = String(opportunity.notes || opportunity.note || "").trim();
  const next = String(opportunity.nextAction || "").trim();
  const tags = Array.isArray(opportunity.tags) ? opportunity.tags.filter(Boolean) : [];
  const sourceQuestion = String(opportunity.sourceQuestion || "").trim();
  const sourceUrls = Array.isArray(opportunity.sourceUrls) ? opportunity.sourceUrls.slice(0, 5) : [];

  // 信息不足时给保守版开工包
  const isSparse = !oneLine && !note && !next && tags.length === 0;
  if (isSparse) {
    return {
      answer: buildSparseKickoff({ name, sourceQuestion, currentGoal: safeCurrentGoal }),
      source: "local",
      warning: "当前机会信息不足，以下是保守版开工包，建议先补充备注或标签。",
      opportunity
    };
  }

  const llmConfig = readConfig(env);
  const llmEnabled = isConfigured(llmConfig);
  if (!llmEnabled) {
    return {
      answer: buildLocalKickoff({ name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal: safeCurrentGoal }),
      source: "local",
      warning: null,
      opportunity
    };
  }
  try {
    const userPrompt = buildKickoffUserPrompt({ name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal: safeCurrentGoal });
    const answer = await callChatCompletion({
      config: llmConfig,
      systemPrompt: readKickoffSystemPrompt(),
      userPrompt,
      fetchImpl: deps.fetch,
      abortImpl: deps.AbortController
    });
    if (answer) {
      return { answer, source: "llm", warning: null, opportunity };
    }
  } catch (error) {
    logLlmError(error);
  }
  return {
    answer: buildLocalKickoff({ name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal: safeCurrentGoal }),
    source: "local-fallback",
    warning: "LLM 动态开工包暂时不可用，已回退到本地规则版开工包。",
    opportunity
  };
}

function buildKickoffUserPrompt({ name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal = "" }) {
  // V0.3.11 安全：脱敏所有可能含 API Key 的字段
  // V0.3.11-hotfix-4：先统一过 redactSecretLikeText（递归脱敏 sk-* 形态）
  const safeInput = redactSecretLikeText({
    name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal
  });
  const sanitize = (s) => String(s || "")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[已脱敏]")
    .replace(/STRATEGY_OS_LLM_API_KEY\s*[=:]\s*\S+/g, "[已脱敏]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "[已脱敏]");
  const safeName = sanitize(safeInput.name);
  const safeOneLine = sanitize(safeInput.oneLine);
  const safeNote = sanitize(safeInput.note);
  const safeNext = sanitize(safeInput.next);
  const safeQuestion = sanitize(safeInput.sourceQuestion);
  const safeTags = Array.isArray(safeInput.tags) ? safeInput.tags.map((t) => sanitize(t)) : [];
  const safeSourceUrls = Array.isArray(safeInput.sourceUrls) ? safeInput.sourceUrls : [];
  const safeCurrentGoal = sanitize(safeInput.currentGoal);
  const lines = [];
  lines.push("请基于下面这个机会卡数据，生成一份结构化开工包。");
  lines.push("");
  lines.push("【机会卡数据】");
  lines.push(`- 机会名称：${safeName}`);
  if (oneLine) lines.push(`- 一句话说明：${safeOneLine}`);
  if (note) lines.push(`- 备注：${safeNote}`);
  if (next) lines.push(`- 下一步：${safeNext}`);
  if (safeTags.length) lines.push(`- 标签：${safeTags.join("、")}`);
  if (safeCurrentGoal) lines.push(`- 当前目标：${safeCurrentGoal}`);
  if (sourceQuestion) lines.push(`- 原始问题：${safeQuestion}`);
  if (safeSourceUrls.length) {
    lines.push(`- 参考来源（最多 5 条）：`);
    for (const u of safeSourceUrls) {
      lines.push(`  - ${sanitize(u.title || "(无标题)")}${u.source ? `（${sanitize(u.source)}）` : ""}${u.url ? ` ${sanitize(u.url)}` : ""}`);
    }
  }
  lines.push("");
  lines.push("【开工包结构 - 请按这些小节输出】");
  lines.push("1. 项目一句话");
  lines.push("2. 为什么值得做");
  lines.push("3. 目标用户");
  lines.push("4. 与当前目标的关系");
  lines.push("5. 最小 MVP");
  lines.push("6. 第一版功能边界");
  lines.push("7. 不要做什么");
  lines.push("8. 推荐执行工具");
  lines.push("9. 第一轮验证路径");
  lines.push("10. 风险与卡点");
  lines.push("11. 下一步提示词草稿");
  lines.push("");
  lines.push("【硬约束 V0.3.11-hotfix】");
  lines.push("- 不要用「信息不足」替代生成。即使信息不完整，也必须输出可执行的保守版开工包。");
  lines.push("- 每个小节必须给出具体内容，可以标注「暂定 / 推断 / 保守判断」，但不允许整节只说「信息不足」。");
  lines.push("- 「风险与卡点」必须主动生成至少 3 条具体风险，不能等用户自己罗列。");
  lines.push("- 「目标用户」、「最小 MVP」、「第一版功能边界」即使信息不足，也要基于机会名/标签/备注做「暂定推断」并写明是推断。");
  lines.push("- 如果给出了当前目标，必须说明这个项目是否服务当前目标；如果不服务，要建议观察或暂缓，而不是强行开工。");
  lines.push("- 内容必须基于上面机会卡数据生成，不要凭空发明数据。");
  lines.push("- 严格中文输出，不调用任何外部智能体，不真的去执行项目。");
  return lines.join("\n");
}

function readKickoffSystemPrompt() {
  // 复用 Ask Mode system prompt 的安全壳：不要真调用 Codex / WorkBuddy / OpenDesign / MiniMax
  // 仅作为"开工包生成"的 system prompt
  return [
    "你是 EricChan·战略OS 的「机会开工包」生成器。",
    "你的任务是基于给定的机会卡数据，输出一份结构化开工包。",
    "约束：",
    "- 严格中文输出。",
    "- 不要真的执行项目、不要模拟调用任何外部 Agent / API。",
    "- V0.3.11-hotfix 硬约束：不要用「信息不足」替代生成。每个小节必须给出具体内容。信息不足时用「暂定 / 推断」给出保守判断。",
    "- 风险与卡点必须主动生成至少 3 条具体风险（基于机会名/标签/类型推断）。",
    "- 目标用户、目标 MVP、目标边界即使不确定，也要基于机会名/标签做暂定推断。",
    "- 不要泄露任何 API Key / 内部配置。",
    "- 不要使用 markdown 标题 # / ##，用 1./2. 数字小节即可。",
    "- 不要把「项目」当成「机会」：开工包针对一个具体可执行项目。",
    "默认不联网，不要主动建议用户开启联网搜索。"
  ].join("\n");
}

function buildLocalKickoff({ name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal = "" }) {
  // V0.3.11 安全：脱敏所有可能含 API Key 的字段
  // V0.3.11-hotfix-4：先统一过 redactSecretLikeText
  const safeInput = redactSecretLikeText({
    name, oneLine, note, next, tags, sourceQuestion, sourceUrls, currentGoal
  });
  const sanitize = (s) => String(s || "")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[已脱敏]")
    .replace(/STRATEGY_OS_LLM_API_KEY\s*[=:]\s*\S+/g, "[已脱敏]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "[已脱敏]");
  const safeName = sanitize(safeInput.name);
  const safeOneLine = sanitize(oneLine);
  const safeNote = sanitize(note);
  const safeNext = sanitize(next);
  const safeQuestion = sanitize(sourceQuestion);
  const safeTags = (tags || []).map(sanitize);
  const safeCurrentGoal = sanitize(safeInput.currentGoal);
  // V0.3.11-hotfix：根据 name + tags + note 推断目标用户、MVP、边界、风险
  const inferred = inferKickoffFields({ name: safeName, oneLine: safeOneLine, note: safeNote, next: safeNext, tags: safeTags });

  const lines = [];
  lines.push(`# 开工包：${safeName}`);
  lines.push("");
  lines.push("1. 项目一句话");
  lines.push(safeOneLine || `基于「${safeName}」机会的最小可执行项目。`);
  lines.push("");
  lines.push("2. 为什么值得做");
  if (safeNote) {
    lines.push(safeNote.slice(0, 300));
  } else {
    lines.push(inferred.why);
  }
  lines.push("");
  lines.push("3. 与当前目标的关系");
  if (safeCurrentGoal) {
    lines.push(`当前目标：${safeCurrentGoal}`);
    lines.push("判断：只有当这个机会能帮助当前目标更快被验证时，才建议进入执行；否则先观察，不要强行开工。");
  } else {
    lines.push("当前未设置 Goal。先按机会本身做保守判断，不强行绑定方向。");
  }
  lines.push("");
  lines.push("4. 目标用户");
  lines.push(inferred.targetUsers);
  lines.push("");
  lines.push("5. 最小 MVP");
  if (safeNext) {
    lines.push(safeNext.slice(0, 200));
  } else {
    lines.push(inferred.mvp);
  }
  lines.push("");
  lines.push("6. 第一版功能边界");
  lines.push(inferred.scope);
  lines.push("");
  lines.push("7. 不要做什么");
  lines.push("- 不做账号系统。");
  lines.push("- 不做完整产品，先做最小验证。");
  lines.push("- 不直接派发外部 Agent / 智能体。");
  lines.push("- 不花时间打磨 UI，先验证假设。");
  lines.push("- 不接入付费数据源，第一版只用免费/已有数据。");
  lines.push("");
  lines.push("8. 推荐执行工具");
  lines.push("GPT 5.5 Thinking（总控判断）+ Codex（代码/脚本）+ 普通浏览器/LibreOffice（人工记录）。");
  lines.push("");
  lines.push("9. 第一轮验证路径");
  lines.push("- Step 1：写一份 1 页验证计划（含假设、动作、判定标准）。");
  lines.push("- Step 2：花 1-2 天执行最小动作。");
  lines.push("- Step 3：收集反馈，决定继续 / 暂停 / 放弃。");
  lines.push("- 判定标准：能不能在 3-5 天内被 EricChan 实际用起来。");
  lines.push("");
  lines.push("10. 风险与卡点");
  if (safeQuestion) {
    lines.push(`- 原始问题方向：${safeQuestion.slice(0, 120)}`);
  }
  for (const r of inferred.risks) {
    lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("11. 下一步提示词草稿");
  if (safeQuestion) {
    lines.push(`基于"${safeName}"这个机会，帮我做：${safeQuestion.slice(0, 100)}`);
  } else {
    lines.push(`帮我把"${safeName}"拆成 3 个可执行的下一步动作。`);
  }
  return lines.join("\n");
}

// V0.3.11-hotfix：基于 name / oneLine / note / tags 主动推断开工包字段
// 策略：每节都给出"暂定 / 推断"的具体内容，绝不写"信息不足"占位
function inferKickoffFields({ name = "", oneLine = "", note = "", next = "", tags = [] } = {}) {
  const nm = String(name || "").trim();
  const ol = String(oneLine || "").trim();
  const tagList = Array.isArray(tags) ? tags : [];
  const tagText = tagList.length ? tagList.join("、") : "";
  // ---- 1) 目标用户 ----
  // 根据 name / oneLine 推断
  const userKeywords = [
    { rx: /短视频|选题|口播|博主|创作者|IP|内容/, user: "短视频创作者、个人 IP、内容运营、想做 AI 内容变现的独立创作者" },
    { rx: /写作|博客|文章|笔记/, user: "个人写作者、博客主、知识工作者、想做内容沉淀的独立创作者" },
    { rx: /大模型|LLM|GPT|Claude|Agent|智能体/, user: "AI 开发者、Agent 工具使用者、想把 AI 工作流化的产品 / 运营 / 工程师" },
    { rx: /自动化|workflow|工作流|批处理/, user: "运营、产品、独立开发者，希望把重复任务自动化的人" },
    { rx: /前端|UI|设计|视觉|动效|网站/, user: "前端工程师、设计师、想用 AI 提效视觉/交互产出的人" },
    { rx: /编程|IDE|代码|debug|开发工具/, user: "独立开发者、小团队工程师、想加速开发流程的人" },
    { rx: /个人\s*OS|战略\s*OS|操作系统|个人系统|OPC/, user: "EricChan 本人 + 想做个人 OS / OPC 系统的独立开发者" },
    { rx: /可变现|付费|订阅|商业化|变现/, user: "愿意为小工具付费的早期用户 + 想做小本生意的独立开发者" },
    { rx: /调研|看趋势|方向|趋势|雷达/, user: "产品 / 战略 / 投资方向上需要做信息汇总的人" }
  ];
  let targetUsers = "";
  for (const { rx, user } of userKeywords) {
    if (rx.test(nm) || rx.test(ol) || rx.test(note) || tagList.some((t) => rx.test(String(t || "")))) {
      targetUsers = `暂定目标用户：${user}。在信息不足时，先假设这批人会先尝试，他们的需求代表第一版功能边界。`;
      break;
    }
  }
  if (!targetUsers) {
    targetUsers = `暂定目标用户：与「${nm}」方向最相关的早期独立用户（暂定为想用 AI 提效某重复动作的独立开发者 / 内容创作者 / 小团队成员）。第一版可先服务这 1-2 类用户，跑通后再扩展。`;
  }

  // ---- 2) 最小 MVP ----
  let mvp = "";
  if (next) {
    mvp = `基于 next 描述推断：${next}。MVP 形式：单页表单 / 命令行 / 提示词模板 + 1 个最简输出。第一版不要做完整产品，先把这 1 个动作跑通 + 收集 3-5 个真实用户反馈。`;
  } else {
    mvp = `暂定 MVP：一个最小「输入 → 输出」流程。例如：\n- 输入：用户填 1-2 个字段（方向 / 目标平台 / 个人能力）\n- 输出：5 条候选结果 + 标题 + 简要说明\n- 形式：单页 HTML 表单 + 提示词后端（Node / Python）\n- 验证：3-5 个真实用户用一次，决定继续 / 改方向 / 放弃`;
  }

  // ---- 3) 第一版功能边界 ----
  let scope = "";
  if (tagText) {
    scope = `围绕标签 [${tagText}] 圈定核心功能。第一版只做一件事：把核心 1-2 个动作跑通。`;
  } else {
    scope = "暂定第一版功能：\n- 核心：1 个端到端流程（输入 → 输出 → 用户复制使用）\n- 暂不做：账号系统、付费、用户系统、复杂 UI\n- 第一版不做 V2 的：批量处理、多角色协作、API 化\n- 验证假设：用户愿不愿意复制 / 收藏 / 二次使用这个输出";
  }

  // ---- 4) 风险与卡点（至少 4 条）----
  const baseRisks = [
    `需求过宽，容易做成"什么都能做"的泛工具，迷失焦点`,
    `数据来源 / 搜索质量不稳定，可能导致输出质量波动`,
    `用户是否愿意付费 / 二次使用未知，第一版只能验证"白嫖是否愿意用"`,
    `MVP 容易演变成"内容生成玩具"，需要尽快接到真实工作流`,
    `需要先验证单一场景：哪个具体用户 / 具体痛点是真的`
  ];
  // 拼接 name 相关的额外风险
  const extraRisks = [];
  if (nm) {
    extraRisks.push(`项目名「${nm}」的边界在第一版可能模糊，要先写 1 段"不是 X"的反例，避免范围蔓延`);
  }
  if (/AI|Agent|智能体|工作流|自动化/.test(nm + ol + tagText)) {
    extraRisks.push("AI 输出可能不稳定，要准备「用户反馈兜底 / 退化为模板」的退化方案");
    extraRisks.push("避免一开始做复杂账号系统；先单设备 / 浏览器侧跑通");
  }
  if (/内容|写作|选题|博客/.test(nm + ol + tagText)) {
    extraRisks.push("内容质量主观性强，需要快速收集 3-5 个目标用户的真实反馈");
    extraRisks.push("避免做内容生成玩具：用户可能用一次就走，要接进真实工作流");
  }
  if (/编程|工具|IDE|开发/.test(nm + ol + tagText)) {
    extraRisks.push("开发工具迁移成本高，用户粘性来自「用顺手」，要尽早让 EricChan 自己用上");
  }
  // 取 4-5 条
  const risks = [...baseRisks, ...extraRisks].slice(0, 5);

  // ---- 5) why ----
  let why = "";
  if (note) {
    why = `基于备注推断：${String(note).slice(0, 200)}。暂定判断：当前信息虽不完整，但「${nm}」方向对独立开发者 / 内容创作者是值得先做最小验证的。`;
  } else {
    why = `暂定判断：当前信息有限，但「${nm}」方向属于独立开发者可快速验证的范围。建议先花 1-2 天跑通核心 1 个动作，再决定是否继续投入。`;
  }

  return { targetUsers, mvp, scope, risks, why };
}

function buildSparseKickoff({ name, sourceQuestion, currentGoal = "" }) {
  // V0.3.11-hotfix：信息稀疏时也用 inferKickoffFields 推断每节具体内容
  const inferred = inferKickoffFields({ name, oneLine: "", note: "", next: "", tags: [] });
  const safeCurrentGoal = sanitizeCurrentGoal(currentGoal);
  const lines = [];
  lines.push(`# 开工包：${name}（保守版）`);
  lines.push("");
  lines.push("1. 项目一句话");
  lines.push(`基于「${name}」机会的最小可执行项目。`);
  lines.push("");
  lines.push("2. 为什么值得做");
  lines.push(inferred.why);
  lines.push("");
  lines.push("3. 与当前目标的关系");
  if (safeCurrentGoal) {
    lines.push(`当前目标：${safeCurrentGoal}`);
    lines.push("判断：信息稀疏时先确认它是否真的服务当前目标，再决定是否补充机会卡。");
  } else {
    lines.push("当前未设置 Goal。先补充机会信息，再判断是否值得推进。");
  }
  lines.push("");
  lines.push("4. 目标用户");
  lines.push(inferred.targetUsers);
  lines.push("");
  lines.push("5. 最小 MVP");
  lines.push(inferred.mvp);
  lines.push("");
  lines.push("6. 第一版功能边界");
  lines.push(inferred.scope);
  lines.push("");
  lines.push("7. 不要做什么");
  lines.push("- 不做账号系统。");
  lines.push("- 不做完整产品。");
  lines.push("- 不直接派发 Agent。");
  lines.push("- 不花时间打磨 UI，先验证假设。");
  lines.push("- 不接入付费数据源，第一版只用免费/已有数据。");
  lines.push("");
  lines.push("8. 推荐执行工具");
  lines.push("GPT 5.5 Thinking（总控）+ Codex（执行）+ 浏览器（人工记录）。");
  lines.push("");
  lines.push("9. 第一轮验证路径");
  lines.push("- Step 1：写一份 1 页验证计划。");
  lines.push("- Step 2：花 1-2 天执行最小动作。");
  lines.push("- Step 3：收集 3-5 个真实用户反馈，决定继续 / 暂停 / 放弃。");
  lines.push("");
  lines.push("10. 风险与卡点");
  if (sourceQuestion) lines.push(`- 原始问题方向：${sourceQuestion.slice(0, 120)}`);
  for (const r of inferred.risks) {
    lines.push(`- ${r}`);
  }
  lines.push("");
  lines.push("11. 下一步提示词草稿");
  lines.push(`帮我把"${name}"拆成 3 个可执行的下一步动作。`);
  return lines.join("\n");
}

function readSystemPrompt() {
  return readText(ASK_MODE_SYSTEM_PROMPT_PATH) || ASK_MODE_SYSTEM_PROMPT_FALLBACK;
}

function trimContext(text, max = 600) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function sanitizeCurrentGoal(value) {
  return String(redactSecretLikeText(String(value || "").replace(/\s+/g, " ").trim()))
    .slice(0, 200)
    .trim();
}

function appendCurrentGoalAnchor(answer, context) {
  const goal = sanitizeCurrentGoal(context && context.currentGoal);
  if (!goal) return answer;
  return `${String(answer || "").trim()}

当前目标锚点：${goal}
- 回答会优先判断是否服务这个目标；不相关时，不会强行套进去。
`;
}

function buildLlmUserPrompt({ context, type, question, search = null, currentGoal = "" }) {
  const safeGoal = sanitizeCurrentGoal(currentGoal || (context && context.currentGoal));
  const lines = [];
  lines.push(`当前问题类型：${type}`);
  lines.push(`用户原始问题：${String(question || "").trim() || "（无）"}`);
  if (safeGoal) {
    lines.push("");
    lines.push("【当前目标】");
    lines.push(safeGoal);
    lines.push("请把它作为方向锚点：优先判断回答是否服务当前目标；如果问题与当前目标冲突，要指出冲突；如果无关，要说明是否值得偏离；不要强行把所有问题都套进目标。");
  }
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
    // V0.3.10：使用结构化中文摘要注入机会池上下文，优先：已确认 / 待验证 / 观察中 / 最近更新 / 高潜力。
    const ctx = buildOpportunityContextForPrompt(context.opportunityPool.opportunities, { maxItems: 10 });
    if (ctx) {
      lines.push("");
      lines.push(ctx);
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

async function tryLlmAnswerAsync({ config, context, type, question, currentGoal = "", deps = {} } = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const abortImpl = deps.AbortController || (typeof AbortController !== "undefined" ? AbortController : null);
  const systemPrompt = deps.systemPrompt || readSystemPrompt();
  const userPrompt = buildLlmUserPrompt({ context, type, question, currentGoal });
  return callChatCompletion({ config, systemPrompt, userPrompt, fetchImpl, abortImpl });
}

function logLlmError(error) {
  if (!error) return;
  const code = error instanceof LlmError ? error.code : "unknown";
  // 不输出 API Key；只输出 code 与非敏感的 message。
  const safeMessage = String(error.message || "").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
  console.warn(`[ask-mode] LLM 调用失败（${code}）：${safeMessage}`);
}

// ============== V0.3.11-hotfix-3: 智能机会草稿 ==============
//
// 优先级：LLM（callChatCompletion）→ deriveOpportunityDraftFromAnswer 规则兜底 → fallback
// 始终返回 { opportunityName, oneLineSummary, note, nextAction, status, type,
//           suggestedTags, draftWarning, sourceQuestion, sourceAnswerSummary,
//           sourceUrls, draftSource }
//
// 硬约束：
// - 不调用外部搜索；不保存 raw answer / raw search
// - 不暴露 API Key（用 LlmError + sk-* 脱敏）
// - LLM 输出走 parseLlmDraftJson + pickDraftFields 字段白名单
// - tags 优先 PRESET_TAGS

const OPPORTUNITY_DRAFT_PRESET_TAGS = [
  "AI Agent",
  "大模型应用",
  "独立开发者",
  "小型可变现",
  "内容产品",
  "自动化工作流",
  "编程工具",
  "前端视觉",
  "个人 OS",
  "OPC",
  "需要调研",
  "可快速验证",
  "暂缓",
  "高潜力",
  "噪声较大"
];

const OPPORTUNITY_DRAFT_STATUS_WHITELIST = ["inbox", "watch", "validate", "mvp-spec", "building", "archived", "rejected"];
const OPPORTUNITY_DRAFT_TYPE_WHITELIST = [
  "new-project-opportunity",
  "current-project-improvement",
  "legacy-learning-material",
  "watch-only"
];

function readDraftSystemPrompt() {
  return [
    "你是 EricChan·战略OS 的中文机会卡提炼助手。",
    "任务：基于 user 给的 question / answer，输出一个项目机会草稿。",
    "",
    "硬性约束：",
    "1) opportunityName 必须是产品/项目名（≤ 24 字），绝不能直接复述 user 的问题。",
    "2) status ∈ {inbox, watch, validate, mvp-spec, building, archived, rejected}；type ∈ {new-project-opportunity, current-project-improvement, legacy-learning-material, watch-only}。",
    "3) suggestedTags 优先从以下预设里挑：AI Agent / 大模型应用 / 独立开发者 / 小型可变现 / 内容产品 / 自动化工作流 / 编程工具 / 前端视觉 / 个人 OS / OPC。预设不够用再写自由词；最多 5 个。",
    "4) draftWarning 仅当 opportunityName 真的无法识别时填写。",
    "5) 输出严格 JSON，不要 markdown / 注释 / 解释。",
    "",
    "Schema:",
    "{\"opportunityName\":\"\",\"oneLineSummary\":\"\",\"note\":\"\",\"nextAction\":\"\",\"suggestedTags\":[],\"status\":\"validate\",\"type\":\"new-project-opportunity\",\"draftWarning\":\"\"}"
  ].join("\n");
}

function buildDraftUserPrompt({ question, answer, search } = {}) {
  const q = String(question || "").slice(0, 1000);
  const a = String(answer || "").slice(0, 2000);
  const searchUsed = search && search.used ? "本次已联网搜索" : "未使用联网搜索";
  return `问题：${q}\n回答：${a}\n${searchUsed}\n请按系统提示输出严格 JSON。`;
}

function parseLlmDraftJson(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  // 抓首个 {...} 块
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function pickDraftFields(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const rawTags = Array.isArray(p.suggestedTags)
    ? p.suggestedTags.map((t) => String(t || "").slice(0, 40)).filter(Boolean)
    : [];
  // PRESET 优先，自由词放后面；去重；限 5 个
  const seen = new Set();
  const tags = [];
  for (const t of rawTags) {
    if (tags.length >= 5) break;
    if (seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  const status = OPPORTUNITY_DRAFT_STATUS_WHITELIST.includes(p.status) ? p.status : "validate";
  const type = OPPORTUNITY_DRAFT_TYPE_WHITELIST.includes(p.type) ? p.type : "new-project-opportunity";
  // V0.3.11-hotfix-4：sourceUrls 走脱敏 + 长度限制 + 数量限制
  const safeSourceUrls = Array.isArray(p.sourceUrls)
    ? p.sourceUrls.slice(0, 5).map((u) => ({
        title: String(u && u.title || "").slice(0, 200),
        url: String(u && u.url || "").slice(0, 500),
        source: String(u && u.source || "").slice(0, 80)
      }))
    : [];
  return {
    opportunityName: String(p.opportunityName || "").slice(0, 24),
    oneLineSummary: String(p.oneLineSummary || "").slice(0, 300),
    note: String(p.note || "").slice(0, 500),
    nextAction: String(p.nextAction || "").slice(0, 500),
    suggestedTags: tags,
    status,
    type,
    sourceUrls: safeSourceUrls,
    sourceAnswerSummary: String(p.oneLineSummary || p.note || "").slice(0, 600),
    sourceQuestion: String(p.sourceQuestion || "").slice(0, 1000)
  };
}

function buildDraftByRule({ question, answer, search }) {
  const { deriveOpportunityDraftFromAnswer } = require("./opportunity-store");
  return deriveOpportunityDraftFromAnswer({ question, answer, search });
}

async function generateOpportunityDraft({
  question = "",
  answer = "",
  search = null,
  env = process.env,
  deps = {}
} = {}) {
  const fetchImpl = deps.fetch || (typeof fetch !== "undefined" ? fetch : null);
  const abortImpl = deps.AbortController || (typeof AbortController !== "undefined" ? AbortController : null);
  let llmConfig = null;
  try {
    llmConfig = readConfig(env);
  } catch {
    llmConfig = null;
  }
  if (!isConfigured(llmConfig)) {
    const rule = buildDraftByRule({ question, answer, search }) || {};
    return { ...redactSecretLikeText(rule), draftSource: "fallback" };
  }
  try {
    const userPrompt = buildDraftUserPrompt({ question, answer, search });
    const raw = await callChatCompletion({
      config: llmConfig,
      systemPrompt: readDraftSystemPrompt(),
      userPrompt,
      fetchImpl,
      abortImpl
    });
    const parsed = parseLlmDraftJson(raw);
    if (parsed) {
      const picked = pickDraftFields(parsed);
      // 若 LLM 没给出 opportunityName，回退规则
      if (picked.opportunityName) {
        // V0.3.11-hotfix-4：脱敏 LLM 输出（防御 sk-* 回显）
        return { ...redactSecretLikeText(picked), draftSource: "llm" };
      }
    }
  } catch (error) {
    logLlmError(error);
  }
  const rule = buildDraftByRule({ question, answer, search }) || {};
  return { ...redactSecretLikeText(rule), draftSource: "local-rule" };
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
  sanitizeCurrentGoal,
  buildKickoffUserPrompt,
  generateKickoffPackageForOpportunity,
  buildLocalKickoff,
  buildSparseKickoff,
  shouldUseWebSearch,
  LLM_FALLBACK_WARNING,
  // V0.3.11-hotfix-3
  generateOpportunityDraft,
  readDraftSystemPrompt,
  buildDraftUserPrompt,
  parseLlmDraftJson,
  pickDraftFields,
  OPPORTUNITY_DRAFT_PRESET_TAGS,
  // V0.3.11-hotfix-4
  redactSecretLikeText
};
