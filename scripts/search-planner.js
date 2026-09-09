const { redactSecretLikeText } = require("./secret-redact");

const FINANCE_TERMS = [
  "A股",
  "股票",
  "股市",
  "基金",
  "行情",
  "大盘",
  "涨停",
  "跌停",
  "板块",
  "盘面",
  "券商",
  "机构买入",
  "缩量上涨",
  "资金流入",
  "概念股",
  "个股",
  "沪深",
  "创业板",
  "港股",
  "美股行情"
];

const RELEVANCE_TERMS = [
  "AI",
  "Agent",
  "大模型",
  "人工智能",
  "工具",
  "产品",
  "创业",
  "开发者",
  "自动化",
  "模型",
  "编程",
  "SaaS",
  "workflow",
  "coding",
  "developer",
  "startup",
  "LLM",
  "智能体",
  "独立开发"
];

function hasAny(text, terms) {
  const value = String(text || "").toLowerCase();
  return terms.some((term) => value.includes(String(term).toLowerCase()));
}

function removeFinanceTerms(text) {
  let value = String(text || "");
  for (const term of FINANCE_TERMS) value = value.replaceAll(term, " ");
  return value;
}

function isFinanceQuestion(question) {
  return hasAny(question, FINANCE_TERMS);
}

function isBroadOpportunityQuestion(question) {
  return /今天有什么趋势|最近有什么机会|有什么值得关注|适合做什么新项目|有什么新项目|AI 有什么新方向|Agent 有什么趋势|大模型.*机会|趋势|机会|新方向/.test(
    String(question || "")
  );
}

function classifySearchIntent(question) {
  const text = String(question || "");
  if (/API 文档|SDK|当前版本|如何接入|怎么接入|接口文档/i.test(text)) return "technical-docs";
  if (/类似产品|竞品|市场上有没有人做|有没有人做|同类产品/i.test(text)) return "competitor-research";
  if (/我看到一个|帮我查这个项目|GitHub 项目|github 项目|值不值得做|这个产品/i.test(text)) return "project-research";
  if (!isFinanceQuestion(text) && isBroadOpportunityQuestion(text)) return "ai-opportunity";
  if (/news|新闻|发布了什么|这两天.*AI|最近.*(Anthropic|OpenAI|Google|Gemini|Claude|模型|AI)/i.test(text)) return "news";
  return "general";
}

function compactQueries(items) {
  const seen = new Set();
  return items
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function planSearchQueries(question, _context = null) {
  const originalQuestion = String(redactSecretLikeText(question || "")).trim();
  const intent = classifySearchIntent(originalQuestion);
  const allowFinance = isFinanceQuestion(originalQuestion);
  const blockedTopics = allowFinance || intent !== "ai-opportunity" ? [] : FINANCE_TERMS.slice();
  const recency = planRecency(originalQuestion, intent, _context);
  let queries = [originalQuestion];

  if (intent === "ai-opportunity") {
    queries = [
      "AI Agent 产品趋势 独立开发者 商业机会 最近",
      "大模型应用 新产品 AI 工具 创业机会 最近",
      "AI coding agent workflow automation product launch recent",
      "personal AI OS agent tools startup opportunities recent"
    ];
  } else if (intent === "news" && /Anthropic/i.test(originalQuestion)) {
    queries = ["Anthropic AI news Claude product launch recent", "Anthropic latest news Claude model release"];
  } else if (intent === "news" && /OpenAI/i.test(originalQuestion)) {
    queries = ["OpenAI recent product launch AI model news", "OpenAI latest news developer tools"];
  } else if (intent === "competitor-research") {
    queries = [`${originalQuestion} AI 产品 竞品 替代方案`, `${originalQuestion} startup competitor product`];
  } else if (intent === "project-research") {
    queries = [`${originalQuestion} GitHub 产品 用户 竞品`, `${originalQuestion} project review alternatives`];
  } else if (intent === "technical-docs") {
    queries = [`${originalQuestion} official API docs SDK`, `${originalQuestion} 文档 官方 接入`];
  }

  return {
    originalQuestion,
    shouldSearch: Boolean(originalQuestion),
    intent,
    queries: compactQueries(queries).slice(0, 4),
    blockedTopics,
    freshness: recency.freshness,
    recencyRequired: recency.required,
    recencyReason: recency.reason,
    allowFinance
  };
}

function planRecency(question, intent, context = null) {
  const text = String(question || "");
  const configured = context && typeof context.defaultFreshness === "string" && context.defaultFreshness
    ? context.defaultFreshness
    : "";
  if (/今天|今日|这两天|最近两天/i.test(text)) {
    return { freshness: "oneWeek", required: true, reason: "问题要求今天或最近两天的信息，需要优先近期结果。" };
  }
  if (intent === "news") {
    return { freshness: "oneMonth", required: true, reason: "新闻与发布信息需要近期结果。" };
  }
  if (intent === "ai-opportunity") {
    return { freshness: "oneMonth", required: true, reason: "趋势和新机会判断需要近期产品与市场信号。" };
  }
  if (intent === "technical-docs") {
    return { freshness: "oneYear", required: true, reason: "API / SDK / 当前版本需要尽量新的文档。" };
  }
  if (intent === "project-research" || intent === "competitor-research") {
    return { freshness: configured || "oneYear", required: false, reason: "项目与竞品研究可参考稍旧资料，但优先近期信息。" };
  }
  return { freshness: configured || "noLimit", required: false, reason: "普通搜索不强制时效性。" };
}

function scoreResult(result) {
  const text = `${result.title || ""} ${result.snippet || ""} ${result.source || ""}`;
  const financeScore = FINANCE_TERMS.reduce((count, term) => count + (hasAny(text, [term]) ? 1 : 0), 0);
  const relevanceText = removeFinanceTerms(text);
  const relevanceScore = RELEVANCE_TERMS.reduce((count, term) => count + (hasAny(relevanceText, [term]) ? 1 : 0), 0);
  return relevanceScore * 2 - financeScore * 3;
}

function filterSearchResultsByRelevance(results, plan, maxResults = 5) {
  const items = Array.isArray(results) ? results : [];
  if (!plan || plan.allowFinance || plan.intent !== "ai-opportunity") {
    return { results: items.slice(0, maxResults), weak: false, blockedTopicCount: 0 };
  }

  let blockedTopicCount = 0;
  const filtered = items.filter((item) => {
    const text = `${item.title || ""} ${item.snippet || ""} ${item.source || ""}`;
    const hasFinance = hasAny(text, FINANCE_TERMS);
    const hasRelevance = hasAny(removeFinanceTerms(text), RELEVANCE_TERMS);
    const keep = !hasFinance || hasRelevance;
    if (!keep) blockedTopicCount += 1;
    return keep;
  });

  if (filtered.length) return { results: filtered.slice(0, maxResults), weak: false, blockedTopicCount };

  return {
    results: items
      .slice()
      .sort((a, b) => scoreResult(b) - scoreResult(a))
      .slice(0, Math.min(2, maxResults)),
    weak: items.length > 0,
    blockedTopicCount
  };
}

module.exports = {
  FINANCE_TERMS,
  RELEVANCE_TERMS,
  classifySearchIntent,
  filterSearchResultsByRelevance,
  isFinanceQuestion,
  planRecency,
  planSearchQueries
};
