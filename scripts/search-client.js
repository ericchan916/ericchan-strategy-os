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
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.min(Math.floor(maxResults), MAX_SEARCH_RESULTS) : DEFAULT_MAX_RESULTS
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
    results: [],
    warning: null,
    errorCode: null
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
  const plan = planSearchQueries(q);

  if (!config.enabled) return unavailable(config, q, "disabled", "联网搜索未启用，已使用本地上下文回答。");
  if (!config.provider) return unavailable(config, q, "missing-provider");
  if (!config.apiKey) return unavailable(config, q, "missing-key");
  if (!q) return unavailable(config, q, "empty-query", "搜索问题为空，已使用本地上下文回答。");
  if (typeof fetchImpl !== "function") return unavailable(config, q, "no-fetch");
  if (config.provider !== "tavily" && config.provider !== "bocha") return unavailable(config, q, "unsupported-provider");

  const queries = plan.queries.slice(0, 3);
  const attempts = [];
  for (const plannedQuery of queries) {
    attempts.push(await searchProvider({ config, query: plannedQuery, fetchImpl, abortImpl }));
  }

  const results = dedupeResults(attempts.flatMap((item) => item.results || []));
  if (!results.length) {
    const failed = attempts.find((item) => item.warning);
    return {
      ...resultSkeleton(config, q, plan),
      warning: failed ? failed.warning : "没有搜到可用结果，已使用本地上下文回答。",
      errorCode: failed ? failed.errorCode : "empty"
    };
  }

  const filtered = filterSearchResultsByRelevance(results, plan, config.maxResults);
  return {
    ...resultSkeleton(config, q, plan),
    results: filtered.results,
    warning: filtered.weak ? "搜索结果相关性较弱，已保留少量结果供参考。" : null,
    errorCode: filtered.weak ? "weak-relevance" : null
  };
}

function dedupeResults(results) {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).filter((item) => {
    const key = String(item.url || item.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchProvider({ config, query, fetchImpl, abortImpl }) {
  if (config.provider === "tavily") return searchTavily({ config, query, fetchImpl, abortImpl });
  return searchBocha({ config, query, fetchImpl, abortImpl });
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

async function searchBocha({ config, query, fetchImpl, abortImpl }) {
  const url = config.baseUrl || DEFAULT_BOCHA_URL;
  const body = JSON.stringify({
    query,
    freshness: "oneYear",
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
  normalizeResults,
  normalizeBochaResults,
  toPublicSearchMeta
};
