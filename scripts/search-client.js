#!/usr/bin/env node

// Ask Mode 按需搜索客户端：只读取 STRATEGY_OS_SEARCH_*，不输出 / 不返回 API Key。

const { filterSearchResultsByRelevance, planSearchQueries } = require("./search-planner");

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
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizeResults(items, maxResults) {
  return (Array.isArray(items) ? items : [])
    .slice(0, maxResults)
    .map((item) => {
      const url = String(item.url || item.link || "").trim();
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
      const url = String(item.url || "").trim();
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
    query: String(query || ""),
    plannedQueries: plan && Array.isArray(plan.queries) ? plan.queries : [],
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
  const plan = planSearchQueries(query);
  return {
    ...resultSkeleton(config, query, plan),
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
  const q = String(query || "").trim();
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
  const warning = recent.weak
    ? "搜索结果时效性较弱，已保留少量参考来源。"
    : relevant.weak
      ? "搜索结果相关性较弱，已保留少量结果供参考。"
      : null;
  return {
    ...resultSkeleton(config, q, plan),
    results: recent.results,
    recency: buildRecencyMeta(plan, recent.meta),
    filters: {
      blockedTopicCount: relevant.blockedTopicCount || 0,
      duplicateCount: deduped.duplicateCount
    },
    warning,
    errorCode: recent.weak ? "weak-recency" : relevant.weak ? "weak-relevance" : null
  };
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
  const result = search && typeof search === "object" ? search : {};
  const sources = normalizeResults(result.results || [], DEFAULT_MAX_RESULTS).map((item) => ({
    title: item.title,
    url: item.url,
    source: item.source
  }));
  return {
    used: sources.length > 0,
    query: String(result.query || ""),
    plannedQueries: Array.isArray(result.plannedQueries) ? result.plannedQueries.slice(0, 4) : [],
    intent: result.intent || "general",
    freshness: result.freshness || "",
    recency: result.recency || buildRecencyMeta(null),
    filters: result.filters || { blockedTopicCount: 0, duplicateCount: 0 },
    resultCount: sources.length,
    warning: result.warning || null,
    sources
  };
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
  normalizeResults,
  normalizeBochaResults,
  parseResultDate,
  toPublicSearchMeta
};
