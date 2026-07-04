const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_BOCHA_URL,
  readSearchConfig,
  shouldUseWebSearch,
  searchWeb,
  toPublicSearchMeta
} = require("../scripts/search-client");
const { isPlaceholderKey } = require("../scripts/check-search");

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
    env: { STRATEGY_OS_SEARCH_ENABLED: "true", STRATEGY_OS_SEARCH_API_KEY: "test-search-key" }
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
      STRATEGY_OS_SEARCH_API_KEY: "test-search-key",
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
  assert.ok(requestBody.includes("test-search-key"), "provider 请求体可以包含 key");
  const publicMeta = toPublicSearchMeta(result);
  assert.equal(publicMeta.used, true);
  assert.equal(JSON.stringify(publicMeta).includes("test-search-key"), false);
});

test("search HTTP failure is classified without leaking key", async () => {
  const result = await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "tavily",
      STRATEGY_OS_SEARCH_API_KEY: "test-search-key"
    },
    fetchImpl: async () => ({ ok: false, status: 429 })
  });

  assert.equal(result.errorCode, "rate-limited");
  assert.ok(result.warning.includes("本地上下文"));
  assert.equal(JSON.stringify(result).includes("test-search-key"), false);
});

test("bocha success posts expected request and normalizes response", async () => {
  let requestUrl = "";
  let requestOptions = {};
  const result = await searchWeb({
    query: "最近 AI Agent 有什么新机会？",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "bocha",
      STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key",
      STRATEGY_OS_SEARCH_MAX_RESULTS: "3"
    },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          webPages: {
            value: [
              {
                name: "Bocha One",
                url: "https://example.com/one",
                siteName: "Example",
                snippet: "短摘要",
                summary: "长摘要优先",
                datePublished: "2026-07-01T00:00:00+08:00"
              },
              {
                name: "Bocha Two",
                url: "https://news.example/two",
                snippet: "没有 siteName 时使用 hostname"
              },
              {
                name: "No URL",
                summary: "没有 URL 的结果应过滤"
              }
            ]
          }
        })
      };
    }
  });

  assert.equal(requestUrl, DEFAULT_BOCHA_URL);
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.authorization, "Bearer test-bocha-key");
  assert.equal(requestOptions.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    query: "最近 AI Agent 有什么新机会？",
    freshness: "oneYear",
    summary: true,
    count: 3
  });
  assert.equal(result.warning, null);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].title, "Bocha One");
  assert.equal(result.results[0].snippet, "长摘要优先");
  assert.equal(result.results[0].source, "Example");
  assert.equal(result.results[0].publishedAt, "2026-07-01T00:00:00+08:00");
  assert.equal(result.results[1].source, "news.example");
  assert.equal(JSON.stringify(toPublicSearchMeta(result)).includes("test-bocha-key"), false);
});

test("bocha count is capped at 50", async () => {
  let body = {};
  await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "bocha",
      STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key",
      STRATEGY_OS_SEARCH_MAX_RESULTS: "99"
    },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ webPages: { value: [{ name: "One", url: "https://example.com", summary: "ok" }] } })
      };
    }
  });

  assert.equal(body.count, 50);
});

test("bocha empty results fail safely", async () => {
  const result = await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "bocha",
      STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key"
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ webPages: { value: [{ name: "No URL", summary: "skip" }] } })
    })
  });

  assert.equal(result.errorCode, "empty");
  assert.ok(result.warning.includes("本地上下文"));
});

test("bocha HTTP failures are classified", async () => {
  const cases = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not-found"],
    [429, "rate-limited"],
    [500, "server-error"]
  ];

  for (const [status, errorCode] of cases) {
    const result = await searchWeb({
      query: "OpenAI latest news",
      env: {
        STRATEGY_OS_SEARCH_ENABLED: "true",
        STRATEGY_OS_SEARCH_PROVIDER: "bocha",
        STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key"
      },
      fetchImpl: async () => ({ ok: false, status })
    });
    assert.equal(result.errorCode, errorCode);
    assert.equal(JSON.stringify(result).includes("test-bocha-key"), false);
  }
});

test("unsupported provider and placeholder keys are explicit", async () => {
  const result = await searchWeb({
    query: "OpenAI latest news",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "unknown",
      STRATEGY_OS_SEARCH_API_KEY: "test-search-key"
    }
  });

  assert.equal(result.errorCode, "unsupported-provider");
  assert.equal(isPlaceholderKey("BOCHA_API_KEY_HERE"), true);
  assert.equal(isPlaceholderKey("test-search-key"), false);
});

test(".env.example and README do not contain real search keys", () => {
  const root = path.resolve(__dirname, "..");
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  assert.equal(/STRATEGY_OS_SEARCH_API_KEY\s*=\s*sk-/i.test(envExample), false);
  assert.equal(/sk-[A-Za-z0-9]{20,}/.test(readme), false);
});
