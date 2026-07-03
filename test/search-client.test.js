const assert = require("node:assert/strict");
const test = require("node:test");

const {
  readSearchConfig,
  shouldUseWebSearch,
  searchWeb,
  toPublicSearchMeta
} = require("../scripts/search-client");

test("readSearchConfig defaults to disabled", () => {
  const cfg = readSearchConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.provider, "");
  assert.equal(cfg.apiKey, "");
  assert.equal(cfg.timeoutMs, 15000);
  assert.equal(cfg.maxResults, 5);
});

test("shouldUseWebSearch recognizes explicit and current-info triggers", () => {
  assert.equal(shouldUseWebSearch("普通战略问题"), false);
  assert.equal(shouldUseWebSearch("最近 Anthropic 有什么新闻？"), true);
  assert.equal(shouldUseWebSearch("帮我搜一下 GitHub 上的竞品"), true);
  assert.equal(shouldUseWebSearch("这个 API 文档当前版本是什么？"), true);
  assert.equal(shouldUseWebSearch("普通问题", { explicit: true }), true);
});

test("disabled search returns Chinese warning and does not call fetch", async () => {
  let called = false;
  const result = await searchWeb({
    query: "最近 Anthropic 有什么新闻？",
    env: { STRATEGY_OS_SEARCH_ENABLED: "false" },
    fetchImpl: async () => {
      called = true;
    }
  });

  assert.equal(called, false);
  assert.equal(result.errorCode, "disabled");
  assert.ok(result.warning.includes("联网搜索未启用"));
});

test("enabled search without provider/key fails safely", async () => {
  const missingProvider = await searchWeb({
    query: "OpenAI latest news",
    env: { STRATEGY_OS_SEARCH_ENABLED: "true", STRATEGY_OS_SEARCH_API_KEY: "sk-search-key" }
  });
  assert.equal(missingProvider.errorCode, "missing-provider");
  assert.ok(missingProvider.warning.includes("本地上下文"));

  const missingKey = await searchWeb({
    query: "OpenAI latest news",
    env: { STRATEGY_OS_SEARCH_ENABLED: "true", STRATEGY_OS_SEARCH_PROVIDER: "tavily" }
  });
  assert.equal(missingKey.errorCode, "missing-key");
  assert.ok(missingKey.warning.includes("本地上下文"));
});

test("tavily success normalizes and truncates search results", async () => {
  const longSnippet = "x".repeat(900);
  let requestBody = "";
  const result = await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "tavily",
      STRATEGY_OS_SEARCH_API_KEY: "sk-search-key",
      STRATEGY_OS_SEARCH_MAX_RESULTS: "2"
    },
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { title: "One", url: "https://example.com/a", content: longSnippet },
            { title: "Two", url: "https://news.example/b", content: "brief" },
            { title: "Three", url: "https://skip.example/c", content: "skip" }
          ]
        })
      };
    }
  });

  assert.equal(result.warning, null);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].source, "example.com");
  assert.ok(result.results[0].snippet.length < longSnippet.length);
  assert.ok(requestBody.includes("sk-search-key"), "provider 请求体可以包含 key");
  const publicMeta = toPublicSearchMeta(result);
  assert.equal(publicMeta.used, true);
  assert.equal(JSON.stringify(publicMeta).includes("sk-search-key"), false);
});

test("search HTTP failure is classified without leaking key", async () => {
  const result = await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "tavily",
      STRATEGY_OS_SEARCH_API_KEY: "sk-search-key"
    },
    fetchImpl: async () => ({ ok: false, status: 429 })
  });

  assert.equal(result.errorCode, "rate-limited");
  assert.ok(result.warning.includes("本地上下文"));
  assert.equal(JSON.stringify(result).includes("sk-search-key"), false);
});
