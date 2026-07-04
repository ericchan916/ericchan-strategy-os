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
    query: "EricChan Strategy OS",
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
    query: "EricChan Strategy OS",
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

test("wide opportunity search uses planned queries, dedupes urls, and filters finance noise", async () => {
  const requestBodies = [];
  const result = await searchWeb({
    query: "今天有什么趋势？",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "bocha",
      STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key",
      STRATEGY_OS_SEARCH_MAX_RESULTS: "5"
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestBodies.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          webPages: {
            value: [
              {
                name: "A股三大指数缩量上涨，资金流入机器人板块",
                url: "https://finance.example/a",
                siteName: "财经站",
                summary: "股票 行情 板块 资金流入"
              },
              {
                name: "AI Agent workflow automation tools for solo developers",
                url: "https://ai.example/agent",
                siteName: "AI Example",
                summary: "AI Agent 工具 独立开发者 workflow automation product launch"
              },
              {
                name: "Duplicate AI Agent result",
                url: "https://ai.example/agent",
                siteName: "AI Example",
                summary: "重复 URL 应被去重"
              }
            ]
          }
        })
      };
    }
  });

  assert.equal(requestBodies.length, 3);
  assert.equal(requestBodies.some((body) => body.query === "今天有什么趋势？"), false);
  assert.equal(result.intent, "ai-opportunity");
  assert.ok(result.plannedQueries.some((item) => /AI|Agent|大模型|独立开发者|商业机会/i.test(item)));
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].url, "https://ai.example/agent");
  assert.equal(JSON.stringify(result.results).includes("A股"), false);
  const meta = toPublicSearchMeta(result);
  assert.equal(meta.used, true);
  assert.equal(meta.intent, "ai-opportunity");
  assert.ok(meta.plannedQueries.length > 1);
});

test("bocha real data wrapper response is normalized", async () => {
  const result = await searchWeb({
    query: "最近 AI Agent 有什么新机会？",
    env: {
      STRATEGY_OS_SEARCH_ENABLED: "true",
      STRATEGY_OS_SEARCH_PROVIDER: "bocha",
      STRATEGY_OS_SEARCH_API_KEY: "test-bocha-key",
      STRATEGY_OS_SEARCH_MAX_RESULTS: "5"
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        log_id: "log-should-not-leak",
        msg: "success",
        data: {
          webPages: {
            value: [
              {
                name: "真实结构结果",
                url: "https://example.cn/agent",
                siteName: "ExampleCN",
                snippet: "短摘要",
                summary: "真实结构摘要优先",
                datePublished: "2026-07-04T00:00:00+08:00"
              },
              {
                name: "无站点名",
                url: "https://agent.example/path",
                snippet: "hostname fallback"
              },
              {
                name: "No URL",
                summary: "skip"
              }
            ]
          }
        }
      })
    })
  });

  assert.equal(result.warning, null);
  assert.equal(result.errorCode, null);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0], {
    title: "真实结构结果",
    url: "https://example.cn/agent",
    snippet: "真实结构摘要优先",
    source: "ExampleCN",
    publishedAt: "2026-07-04T00:00:00+08:00"
  });
  assert.equal(result.results[1].source, "agent.example");
  assert.equal(JSON.stringify(result.results).includes("log-should-not-leak"), false);
  assert.equal(JSON.stringify(result.results).includes("success"), false);
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
