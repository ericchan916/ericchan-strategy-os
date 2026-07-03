#!/usr/bin/env node

// Ask Mode 按需搜索客户端：只读取 STRATEGY_OS_SEARCH_*，不输出 / 不返回 API Key。
// 当前只支持 tavily；其它 provider 保留为明确错误，不做多平台抽象。

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TAVILY_URL = "https://api.tavily.com/search";
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
    maxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.min(Math.floor(maxResults), 10) : DEFAULT_MAX_RESULTS
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

function resultSkeleton(config, query) {
  return {
    provider: config.provider || "",
    query: String(query || ""),
    results: [],
    warning: null,
    errorCode: null
  };
}

function unavailable(config, query, errorCode, warning = SEARCH_FALLBACK_WARNING) {
  return {
    ...resultSkeleton(config, query),
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

  if (!config.enabled) return unavailable(config, q, "disabled", "联网搜索未启用，已使用本地上下文回答。");
  if (!config.provider) return unavailable(config, q, "missing-provider");
  if (!config.apiKey) return unavailable(config, q, "missing-key");
  if (!q) return unavailable(config, q, "empty-query", "搜索问题为空，已使用本地上下文回答。");
  if (typeof fetchImpl !== "function") return unavailable(config, q, "no-fetch");
  if (config.provider !== "tavily") return unavailable(config, q, "unsupported-provider");

  return searchTavily({ config, query: q, fetchImpl, abortImpl });
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

function toPublicSearchMeta(search) {
  const result = search && typeof search === "object" ? search : {};
  const sources = normalizeResults(result.results || [], DEFAULT_MAX_RESULTS).map((item) => ({
    title: item.title,
    url: item.url,
    source: item.source
  }));
  return {
    used: sources.length > 0 && !result.warning,
    query: String(result.query || ""),
    resultCount: sources.length,
    warning: result.warning || null,
    sources
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESULTS,
  DEFAULT_TAVILY_URL,
  SEARCH_FALLBACK_WARNING,
  redactKey,
  readSearchConfig,
  shouldUseWebSearch,
  searchWeb,
  normalizeResults,
  toPublicSearchMeta
};
