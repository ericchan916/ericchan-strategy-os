#!/usr/bin/env node

// Ask Mode 按需搜索客户端：只读取 STRATEGY_OS_SEARCH_*，不输出 / 不返回 API Key。

const {
  FINANCE_TERMS,
  RELEVANCE_TERMS,
  filterSearchResultsByRelevance,
  planSearchQueries
} = require("./search-planner");
const { redactSecretLikeText } = require("./secret-redact");

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_SEARCH_RESULTS = 50;
const DEFAULT_TAVILY_URL = "https://api.tavily.com/search";
const DEFAULT_BOCHA_URL = "https://api.bochaai.com/v1/web-search";
const SEARCH_FALLBACK_WARNING = "联网搜索暂时不可用，已使用本地上下文回答。";

function redactKey(value) {
  return String(value || "").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}

function readSearchConfig(env = process.env) {
  const timeout = Number(env.STRATEGY_OS_SEARCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const maxResults = Number(env.STRATEGY_OS_SEARCH_MAX_RESULTS || DEFAULT_MAX_RESULTS);
  return {
    enabled: String(env.STRATEGY_OS_SEARCH_ENABLED || "false").toLowerCase() === "true",
    provider: String(env.STRATEGY_OS_SEARCH_PROVIDER || "").trim().toLowerCase(),
    apiKey: String(env.STRATEGY_OS_SEARCH_API_KEY || "").trim(),
    baseUrl: String(env.STRATEGY_OS_SEARCH_BASE_URL || "").trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.min(Math.floor(maxResults), MAX_SEARCH_RESULTS) : DEFAULT_MAX_RESULTS,
    freshness: String(env.STRATEGY_OS_SEARCH_FRESHNESS || "").trim()
  };
}

function shouldUseWebSearch(question, options = {}) {
  if (options.explicit === true) return true;
  const text = String(question || "");
  return /最新|最近|这两天|新闻|搜一下|搜索|查一下|联网|外部项目|GitHub|竞品|来源|热度|价格|官网|API 文档|当前版本|发布|更新/i.test(text);
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function truncate(value, max = 500) {
  const text = String(redactSecretLikeText(value || "")).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeResults(items, maxResults) {
  return (Array.isArray(items) ? items : [])
    .slice(0, maxResults)
    .map((item) => {
      const url = String(redactSecretLikeText(item.url || item.link || "")).trim();
      return {
        title: truncate(item.title || item.name || url || "未命名来源", 140),
        url,
        snippet: truncate(item.snippet || item.content || item.description || "", 500),
        source: truncate(item.source || hostFromUrl(url), 80),
        publishedAt: item.publishedAt || item.published_at || item.date || null
      };
    })
    .filter((item) => item.title || item.url || item.snippet);
}

function normalizeBochaResults(items, maxResults) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const url = String(redactSecretLikeText(item.url || "")).trim();
      return {
        title: truncate(item.name || item.title || "未命名来源", 140),
        url,
        snippet: truncate(item.summary || item.snippet || "", 500),
        source: truncate(item.siteName || hostFromUrl(url), 80),
        publishedAt: item.datePublished || null
      };
    })
    .filter((item) => item.url)
    .slice(0, maxResults);
}

function resultSkeleton(config, query, plan = null) {
  return {
    provider: config.provider || "",
    query: String(redactSecretLikeText(query || "")),
    plannedQueries: redactSecretLikeText(plan && Array.isArray(plan.queries) ? plan.queries : []),
    intent: plan ? plan.intent : "general",
    freshness: plan ? plan.freshness : config.freshness || "",
    recency: buildRecencyMeta(plan),
    filters: { blockedTopicCount: 0, duplicateCount: 0 },
    results: [],
    warning: null,
    errorCode: null
  };
}

function buildRecencyMeta(plan, overrides = {}) {
  return {
    required: Boolean(plan && plan.recencyRequired),
    reason: (plan && plan.recencyReason) || "",
    filteredOldCount: 0,
    missingDateCount: 0,
    oldestKeptDate: null,
    newestKeptDate: null,
    ...overrides
  };
}

function unavailable(config, query, errorCode, warning = SEARCH_FALLBACK_WARNING) {
  const safeQuery = String(redactSecretLikeText(query || ""));
  const plan = planSearchQueries(safeQuery);
  return {
    ...resultSkeleton(config, safeQuery, plan),
    warning,
    errorCode
  };
}

function classifyHttpStatus(status) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server-error";
  return "http";
}

function classifyNetworkError(error) {
  if (error && (error.name === "AbortError" || /aborted/i.test(String(error.message)))) return "timeout";
  return "network";
}

async function searchWeb({ query, env = process.env, fetchImpl = globalThis.fetch, abortImpl = globalThis.AbortController } = {}) {
  const config = readSearchConfig(env);
  const q = String(redactSecretLikeText(query || "")).trim();
  const plan = planSearchQueries(q, { defaultFreshness: config.freshness });

  if (!config.enabled) return unavailable(config, q, "disabled", "联网搜索未启用，已使用本地上下文回答。");
  if (!config.provider) return unavailable(config, q, "missing-provider");
  if (!config.apiKey) return unavailable(config, q, "missing-key");
  if (!q) return unavailable(config, q, "empty-query", "搜索问题为空，已使用本地上下文回答。");
  if (typeof fetchImpl !== "function") return unavailable(config, q, "no-fetch");
  if (config.provider !== "tavily" && config.provider !== "bocha") return unavailable(config, q, "unsupported-provider");

  const queries = plan.queries.slice(0, 3);
  const attempts = [];
  for (const plannedQuery of queries) {
    attempts.push(await searchProvider({ config, plan, query: plannedQuery, fetchImpl, abortImpl }));
  }

  const deduped = dedupeResultsWithStats(attempts.flatMap((item) => item.results || []));
  if (!deduped.results.length) {
    const failed = attempts.find((item) => item.warning);
    return {
      ...resultSkeleton(config, q, plan),
      warning: failed ? failed.warning : "没有搜到可用结果，已使用本地上下文回答。",
      errorCode: failed ? failed.errorCode : "empty"
    };
  }

  const relevant = filterSearchResultsByRelevance(deduped.results, plan, MAX_SEARCH_RESULTS);
  const recent = filterSearchResultsByRecency(relevant.results, plan, config.maxResults);
  const scored = scoreSearchResultsQuality(recent.results, plan);
  const warning = recent.weak
    ? "搜索结果时效性较弱，已保留少量参考来源。"
    : relevant.weak
      ? "搜索结果相关性较弱，已保留少量结果供参考。"
      : null;
  return redactSecretLikeText({
    ...resultSkeleton(config, q, plan),
    results: scored.results,
    recency: buildRecencyMeta(plan, recent.meta),
    filters: {
      blockedTopicCount: relevant.blockedTopicCount || 0,
      duplicateCount: deduped.duplicateCount
    },
    quality: scored.summary,
    warning,
    errorCode: recent.weak ? "weak-recency" : relevant.weak ? "weak-relevance" : null
  });
}

function parseResultDate(result) {
  const explicit = result && result.publishedAt ? Date.parse(result.publishedAt) : NaN;
  if (Number.isFinite(explicit)) return new Date(explicit);
  const text = `${result && result.title ? result.title : ""} ${result && result.snippet ? result.snippet : ""}`;
  const match = text.match(/(20\d{2})(?:\s*年|\-|\/)?\s*(\d{1,2})?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const parsed = new Date(Date.UTC(year, Math.max(0, month - 1), 1));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recencyWindowDays(plan) {
  const question = String(plan && plan.originalQuestion ? plan.originalQuestion : "");
  if (/今天|今日|这两天|最近两天/.test(question)) return 7;
  if (plan && plan.intent === "news") return 30;
  if (plan && plan.intent === "ai-opportunity") return 180;
  if (plan && plan.intent === "technical-docs") return 365;
  return Infinity;
}

function filterSearchResultsByRecency(results, plan, maxResults = DEFAULT_MAX_RESULTS, now = new Date()) {
  const items = Array.isArray(results) ? results : [];
  if (!plan || !plan.recencyRequired) {
    const sliced = sortResults(items).slice(0, maxResults);
    return { results: sliced, weak: false, meta: recencyMetaFor(sliced, 0, countMissingDates(sliced)) };
  }

  const windowMs = recencyWindowDays(plan) * 24 * 60 * 60 * 1000;
  const threshold = Number.isFinite(windowMs) ? new Date(now.getTime() - windowMs) : null;
  let filteredOldCount = 0;
  let missingDateCount = 0;
  const kept = [];
  for (const item of items) {
    const date = parseResultDate(item);
    if (!date) {
      missingDateCount += 1;
      kept.push(item);
      continue;
    }
    if (threshold && date < threshold) {
      filteredOldCount += 1;
      continue;
    }
    kept.push(item);
  }

  if (kept.length) {
    const sliced = sortResults(kept).slice(0, maxResults);
    return { results: sliced, weak: false, meta: recencyMetaFor(sliced, filteredOldCount, missingDateCount) };
  }

  const fallback = sortResults(items).slice(0, Math.min(2, maxResults));
  return {
    results: fallback,
    weak: items.length > 0,
    meta: recencyMetaFor(fallback, filteredOldCount, countMissingDates(fallback))
  };
}

function sortResults(results) {
  return (Array.isArray(results) ? results : []).slice().sort((a, b) => {
    const dateA = parseResultDate(a);
    const dateB = parseResultDate(b);
    if (dateA && dateB && dateA.getTime() !== dateB.getTime()) return dateB - dateA;
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    const summaryA = String(a.snippet || "").length;
    const summaryB = String(b.snippet || "").length;
    if (summaryA !== summaryB) return summaryB - summaryA;
    return String(b.source || "").length - String(a.source || "").length;
  });
}

function countMissingDates(results) {
  return (Array.isArray(results) ? results : []).filter((item) => !parseResultDate(item)).length;
}

function recencyMetaFor(results, filteredOldCount, missingDateCount) {
  const dates = (Array.isArray(results) ? results : [])
    .map(parseResultDate)
    .filter(Boolean)
    .sort((a, b) => a - b);
  return {
    filteredOldCount,
    missingDateCount,
    oldestKeptDate: dates[0] ? dates[0].toISOString().slice(0, 10) : null,
    newestKeptDate: dates[dates.length - 1] ? dates[dates.length - 1].toISOString().slice(0, 10) : null
  };
}

function hasAny(text, terms) {
  const value = String(text || "").toLowerCase();
  return (terms || []).some((term) => value.includes(String(term).toLowerCase()));
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ageDaysOf(result, now = new Date()) {
  const date = parseResultDate(result);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function scoreRelevance(result, plan) {
  const text = `${result.title || ""} ${result.snippet || ""} ${result.source || ""}`;
  const matches = RELEVANCE_TERMS.reduce((count, term) => count + (hasAny(text, [term]) ? 1 : 0), 0);
  const financeMatches = FINANCE_TERMS.reduce((count, term) => count + (hasAny(text, [term]) ? 1 : 0), 0);
  let score = 45 + matches * 9 - financeMatches * 22;
  if (plan && plan.intent === "ai-opportunity") score += matches > 0 ? 10 : -18;
  if (plan && plan.allowFinance) score += financeMatches * 8;
  const reasons = [];
  if (matches > 0) reasons.push("命中 AI / Agent / 工具 / 产品机会相关词");
  if (financeMatches > 0 && !(plan && plan.allowFinance)) reasons.push("包含财经盘面噪声");
  if (!matches) reasons.push("与战略OS主线相关性不强");
  return { score: clampScore(score), reasons };
}

function scoreFreshness(result, plan, now = new Date()) {
  const age = ageDaysOf(result, now);
  const text = `${result.title || ""} ${result.snippet || ""}`;
  const hasLatestHint = /latest|current|version|release|更新|发布|最新|当前版本/i.test(text);
  const reasons = [];
  if (age == null) {
    reasons.push("缺少发布时间");
    return { score: hasLatestHint ? 62 : 48, reasons };
  }
  reasons.push(`发布时间约 ${age} 天前`);
  if (plan && plan.intent === "news") {
    if (age <= 7) return { score: 96, reasons };
    if (age <= 30) return { score: 84, reasons };
    if (age <= 180) return { score: 45, reasons };
    return { score: 18, reasons };
  }
  if (plan && plan.intent === "ai-opportunity") {
    if (age <= 90) return { score: 90, reasons };
    if (age <= 180) return { score: 70, reasons };
    if (age <= 365) return { score: 45, reasons };
    return { score: 20, reasons };
  }
  if (plan && plan.intent === "technical-docs") {
    if (age <= 365) return { score: 88, reasons };
    return { score: hasLatestHint ? 62 : 32, reasons };
  }
  if (age <= 365) return { score: 72, reasons };
  return { score: 45, reasons };
}

function scoreCredibility(result) {
  const source = String(result.source || "").toLowerCase();
  const url = String(result.url || "").toLowerCase();
  const title = String(result.title || "");
  const host = hostFromUrl(url).toLowerCase();
  const text = `${source} ${host} ${title}`.toLowerCase();
  const reasons = [];
  const official = ["github.com", "arxiv.org", "openai.com", "anthropic.com", "deepmind.google", "ai.google", "microsoft.com", "vercel.com", ".edu", ".gov"];
  const mainstream = ["techcrunch", "theverge", "wired", "mit technology review", "36kr", "huxiu", "虎嗅", "财新", "界面", "腾讯", "新华", "机器之心", "量子位"];
  const lowQuality = ["下载", "app", "价格套餐", "产品介绍", "资源网", "天晴", "聚合", "导航", "广告", "seo"];
  if (hasAny(text, official)) {
    reasons.push("官方 / GitHub / 研究机构来源");
    return { score: 90, reasons };
  }
  if (hasAny(text, mainstream)) {
    reasons.push("主流科技或行业媒体来源");
    return { score: 72, reasons };
  }
  if (hasAny(text, lowQuality)) {
    reasons.push("疑似 SEO 聚合或低质转载来源");
    return { score: 35, reasons };
  }
  if (!source && !host) {
    reasons.push("来源不明确");
    return { score: 42, reasons };
  }
  reasons.push("普通网页来源");
  return { score: 58, reasons };
}

function scoreSearchResultQuality(result, plan, now = new Date()) {
  const relevance = scoreRelevance(result, plan);
  const freshness = scoreFreshness(result, plan, now);
  const credibility = scoreCredibility(result);
  const overallScore = clampScore(relevance.score * 0.45 + freshness.score * 0.3 + credibility.score * 0.25);
  return {
    relevanceScore: relevance.score,
    freshnessScore: freshness.score,
    credibilityScore: credibility.score,
    overallScore,
    reasons: [...relevance.reasons, ...freshness.reasons, ...credibility.reasons].slice(0, 5)
  };
}

function qualitySummaryFor(results) {
  const scores = (Array.isArray(results) ? results : [])
    .map((item) => item && item.quality && Number(item.quality.overallScore))
    .filter((score) => Number.isFinite(score));
  if (!scores.length) {
    return {
      averageScore: 0,
      topSourceScore: 0,
      lowQualityCount: 0,
      weakReason: "没有可评分的外部来源。",
      hasHighConfidenceSources: false
    };
  }
  const averageScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const topSourceScore = Math.max(...scores);
  const lowQualityCount = scores.filter((score) => score < 50).length;
  return {
    averageScore,
    topSourceScore,
    lowQualityCount,
    weakReason: averageScore < 55 ? "来源质量偏弱，外部搜索仅作参考。" : lowQualityCount > 0 ? "部分来源质量偏弱，已降低权重。" : "",
    hasHighConfidenceSources: topSourceScore >= 75
  };
}

function scoreSearchResultsQuality(results, plan, now = new Date()) {
  const scored = (Array.isArray(results) ? results : []).map((item) => ({
    ...item,
    quality: scoreSearchResultQuality(item, plan, now)
  }));
  scored.sort((a, b) => (b.quality.overallScore || 0) - (a.quality.overallScore || 0));
  return {
    results: scored,
    summary: qualitySummaryFor(scored)
  };
}

function dedupeResults(results) {
  return dedupeResultsWithStats(results).results;
}

function dedupeResultsWithStats(results) {
  const seen = new Set();
  let duplicateCount = 0;
  const deduped = (Array.isArray(results) ? results : []).filter((item) => {
    const key = String(item.url || item.title || "").trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) {
      duplicateCount += 1;
      return false;
    }
    seen.add(key);
    return true;
  });
  return { results: deduped, duplicateCount };
}

function searchProvider({ config, plan, query, fetchImpl, abortImpl }) {
  if (config.provider === "tavily") return searchTavily({ config, query, fetchImpl, abortImpl });
  return searchBocha({ config, plan, query, fetchImpl, abortImpl });
}

async function searchTavily({ config, query, fetchImpl, abortImpl }) {
  const url = config.baseUrl || DEFAULT_TAVILY_URL;
  let timer;
  let response;
  try {
    if (abortImpl) {
      const controller = new abortImpl();
      timer = setTimeout(() => controller.abort(), config.timeoutMs);
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: config.apiKey,
          query,
          max_results: config.maxResults,
          search_depth: "basic",
          include_answer: false
        }),
        signal: controller.signal
      });
    } else {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: config.apiKey,
          query,
          max_results: config.maxResults,
          search_depth: "basic",
          include_answer: false
        })
      });
    }
  } catch (error) {
    return unavailable(config, query, classifyNetworkError(error));
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response || !response.ok) {
    return unavailable(config, query, classifyHttpStatus(response ? response.status : 0));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return unavailable(config, query, "parse");
  }

  const results = normalizeResults(payload && payload.results, config.maxResults);
  if (!results.length) return unavailable(config, query, "empty", "没有搜到可用结果，已使用本地上下文回答。");

  return {
    ...resultSkeleton(config, query),
    results
  };
}

async function searchBocha({ config, plan, query, fetchImpl, abortImpl }) {
  const url = config.baseUrl || DEFAULT_BOCHA_URL;
  const body = JSON.stringify({
    query,
    freshness: (plan && plan.freshness) || config.freshness || "oneYear",
    summary: true,
    count: Math.min(Math.max(config.maxResults, 1), MAX_SEARCH_RESULTS)
  });
  let timer;
  let response;
  try {
    const request = {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body
    };
    if (abortImpl) {
      const controller = new abortImpl();
      timer = setTimeout(() => controller.abort(), config.timeoutMs);
      request.signal = controller.signal;
    }
    response = await fetchImpl(url, request);
  } catch (error) {
    return unavailable(config, query, classifyNetworkError(error));
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response || !response.ok) {
    return unavailable(config, query, classifyHttpStatus(response ? response.status : 0));
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return unavailable(config, query, "parse");
  }

  const webPages = (payload && payload.webPages) || (payload && payload.data && payload.data.webPages);
  const values = webPages && webPages.value;
  const results = normalizeBochaResults(values, config.maxResults);
  if (!results.length) return unavailable(config, query, "empty", "没有搜到可用结果，已使用本地上下文回答。");

  return {
    ...resultSkeleton(config, query),
    results
  };
}

function toPublicSearchMeta(search) {
  const result = redactSecretLikeText(search && typeof search === "object" ? search : {});
  const rawResults = Array.isArray(result.results) ? result.results : [];
  const sources = normalizeResults(rawResults, DEFAULT_MAX_RESULTS).map((item, index) => ({
    title: item.title,
    url: item.url,
    source: item.source,
    quality: rawResults[index] && rawResults[index].quality
      ? {
          overallScore: rawResults[index].quality.overallScore,
          label: qualityLabel(rawResults[index].quality.overallScore)
        }
      : undefined
  }));
  return redactSecretLikeText({
    used: sources.length > 0,
    query: String(result.query || ""),
    plannedQueries: Array.isArray(result.plannedQueries) ? result.plannedQueries.slice(0, 4) : [],
    intent: result.intent || "general",
    freshness: result.freshness || "",
    recency: result.recency || buildRecencyMeta(null),
    filters: result.filters || { blockedTopicCount: 0, duplicateCount: 0 },
    quality: result.quality || qualitySummaryFor(result.results || []),
    resultCount: sources.length,
    warning: result.warning || null,
    sources
  });
}

function qualityLabel(score) {
  const value = Number(score);
  if (value >= 75) return "较高";
  if (value >= 55) return "一般";
  return "偏弱";
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESULTS,
  MAX_SEARCH_RESULTS,
  DEFAULT_TAVILY_URL,
  DEFAULT_BOCHA_URL,
  SEARCH_FALLBACK_WARNING,
  redactKey,
  readSearchConfig,
  shouldUseWebSearch,
  searchWeb,
  dedupeResults,
  dedupeResultsWithStats,
  filterSearchResultsByRecency,
  scoreSearchResultQuality,
  scoreSearchResultsQuality,
  normalizeResults,
  normalizeBochaResults,
  parseResultDate,
  qualityLabel,
  toPublicSearchMeta
};
