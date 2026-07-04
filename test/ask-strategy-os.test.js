const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { askStrategyOs, askStrategyOsAsync, classifyQuestion, buildLlmUserPrompt, generateKickoffPackageForOpportunity, buildKickoffUserPrompt, buildLocalKickoff, buildSparseKickoff } = require("../scripts/ask-strategy-os");
const llmClient = require("../scripts/llm-client");
const loadEnv = require("../scripts/load-env");
const http = require("node:http");

// 这些测试主要验证本地规则回答；测试期间清掉 STRATEGY_OS_LLM_* / LLM_*
// 以避免误命中真实 .env，跑到真实 LLM API。
const LLM_TEST_KEYS = [
  "STRATEGY_OS_LLM_ENABLED",
  "STRATEGY_OS_LLM_API_KEY",
  "STRATEGY_OS_LLM_BASE_URL",
  "STRATEGY_OS_LLM_MODEL",
  "STRATEGY_OS_LLM_TIMEOUT_MS",
  "STRATEGY_OS_SEARCH_ENABLED",
  "STRATEGY_OS_SEARCH_PROVIDER",
  "STRATEGY_OS_SEARCH_API_KEY",
  "STRATEGY_OS_SEARCH_BASE_URL",
  "STRATEGY_OS_SEARCH_TIMEOUT_MS",
  "STRATEGY_OS_SEARCH_MAX_RESULTS",
  "STRATEGY_OS_SEARCH_FRESHNESS",
  "LLM_API_KEY",
  "LLM_API_BASE_URL",
  "LLM_MODEL"
];
const SAVED_LLM_ENV = {};
for (const key of LLM_TEST_KEYS) SAVED_LLM_ENV[key] = process.env[key];
for (const key of LLM_TEST_KEYS) delete process.env[key];
test.after(() => {
  for (const key of LLM_TEST_KEYS) {
    if (SAVED_LLM_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED_LLM_ENV[key];
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ask-"));
  const date = "2026-07-03";
  fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "config"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "daily-command"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "context", "context.md"), "EricChan 当前优先个人可用、中文输出、机会发现。");
  writeJson(path.join(rootDir, "config", "recommended-questions.json"), [
    "今天适合做什么？",
    "当前项目哪个最值得推进？",
    "我现在该不该开新项目？",
    "我看到一个好项目，帮我体检一下。",
    "帮我生成项目开工包。",
    "这件事该交给哪个智能体？",
    "我是不是把事情搞复杂了？"
  ]);
  writeJson(path.join(rootDir, "data", "reports", `${date}.json`), {
    date,
    mode: "mock",
    warnings: [],
    opportunities: [],
    recommendedActions: [{ action: "把 Independent AI opportunity brief 压成一个样例。", stageFit: "now" }]
  });
  writeJson(path.join(rootDir, "data", "opportunities", "opportunity-pool.json"), {
    version: 1,
    opportunities: [
      {
        id: "opp-brief",
        status: "validate",
        humanDecision: "accepted",
        opportunityName: "Independent AI opportunity brief MVP",
        firstValidationAction: "写一份样例 brief"
      },
      {
        id: "opp-quality",
        status: "watch",
        humanDecision: "watching",
        opportunityName: "Opportunity scoring quality gate"
      }
    ]
  });
  writeJson(path.join(rootDir, "data", "daily-command", `${date}.json`), {
    date,
    sourceMode: "mock",
    oneLineJudgment: "今天最重要的是把最强机会压成一个可验证的小动作。",
    topOpportunities: [{ opportunityName: "Independent AI opportunity brief MVP" }],
    recommendedActions: [
      {
        action: "推进 Independent AI opportunity brief MVP 的个人可用验证",
        expectedOutput: "一份样例 brief",
        timebox: "45-60 min"
      }
    ],
    newProjectDecision: {
      decision: "not-yet",
      reason: "先验证个人可用价值。",
      requiredConfirmation: "完成一个样例 brief。"
    }
  });
  fs.writeFileSync(path.join(rootDir, "daily-command", `${date}.md`), "# EricChan·战略OS Daily Command\n\n今天最重要的是保持轻量。");
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");

  return {
    rootDir,
    date,
    reportPath: path.join(rootDir, "data", "reports", `${date}.json`),
    poolPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    commandPath: path.join(rootDir, "daily-command", `${date}.md`)
  };
}

test("no question prints Chinese recommended questions", () => {
  const fixture = createFixture();
  const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date });

  assert.equal(result.type, "general-strategy-question");
  assert.ok(result.answer.includes("# 推荐问题"));
  assert.ok(result.answer.includes("今天适合做什么？"));
  assert.ok(result.answer.includes("我是不是把事情搞复杂了？"));
});

test("classifies supported question types", () => {
  assert.equal(classifyQuestion("今天适合做什么？"), "today-action");
  assert.equal(classifyQuestion("我看到一个好项目，帮我体检一下。"), "project-checkup");
  assert.equal(classifyQuestion("帮我生成项目开工包。"), "kickoff-package");
  assert.equal(classifyQuestion("这件事该交给哪个智能体？"), "agent-dispatch");
  assert.equal(classifyQuestion("我是不是把事情搞复杂了？"), "complexity-check");
});

test("today action answers in Chinese and uses current Daily Command", () => {
  const fixture = createFixture();
  const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date, question: "今天适合做什么？" });

  assert.equal(result.type, "today-action");
  assert.ok(result.answer.includes("# 今天适合做什么"));
  assert.ok(result.answer.includes("今天最重要的是把最强机会压成一个可验证的小动作"));
  assert.ok(result.answer.includes("今天不要做"));
});

test("CLI accepts a question argument", () => {
  const fixture = createFixture();
  const output = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "ask-strategy-os.js"), "今天适合做什么？"], {
    cwd: fixture.rootDir,
    encoding: "utf8"
  });

  assert.ok(output.includes("# 今天适合做什么"));
  assert.equal(output.includes("# 推荐问题"), false);
});

test("project checkup contains required Chinese sections", () => {
  const fixture = createFixture();
  const result = askStrategyOs({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "我看到一个 ESP32 墨水屏日历项目，帮我体检一下。"
  });

  assert.equal(result.type, "project-checkup");
  assert.ok(result.answer.includes("# 项目体检"));
  assert.ok(result.answer.includes("## 2. 值不值得做"));
  assert.ok(result.answer.includes("## 6. 最小可验证效果"));
  assert.ok(result.answer.includes("生成开工包"));
  assert.equal(result.answer.includes("直接交给 Codex 开工"), false);
});

test("kickoff package is for GPT 5.5 Thinking control, not direct Codex execution", () => {
  const fixture = createFixture();
  const result = askStrategyOs({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "帮我生成这个项目的开工包：ESP32 墨水屏日历项目。"
  });

  assert.equal(result.type, "kickoff-package");
  assert.ok(result.answer.includes("# 项目开工包：交给 GPT 5.5 Thinking 总控"));
  assert.ok(result.answer.includes("是否需要 Codex 做工程 MVP？"));
  assert.ok(result.answer.includes("GPT 5.5 Thinking：战略判断"));
  assert.equal(result.answer.includes("直接交给 Codex 开工"), false);
});

test("recommended questions config is Chinese", () => {
  const fixture = createFixture();
  const questions = JSON.parse(fs.readFileSync(path.join(fixture.rootDir, "config", "recommended-questions.json"), "utf8"));

  assert.ok(questions.length >= 7);
  assert.ok(questions.every((item) => /[\u4e00-\u9fa5]/.test(item)));
});

test("ask mode does not read .env or modify user generated files", () => {
  const fixture = createFixture();
  const before = {
    report: fs.readFileSync(fixture.reportPath, "utf8"),
    pool: fs.readFileSync(fixture.poolPath, "utf8"),
    command: fs.readFileSync(fixture.commandPath, "utf8")
  };
  const originalRead = fs.readFileSync;

  try {
    fs.readFileSync = function patchedRead(filePath, ...args) {
      if (String(filePath).endsWith(".env")) throw new Error(".env should not be read");
      return originalRead.call(this, filePath, ...args);
    };
    const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date, question: "这件事该交给哪个智能体？" });
    assert.ok(result.answer.includes("GPT 5.5 Thinking"));
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.equal(fs.readFileSync(fixture.reportPath, "utf8"), before.report);
  assert.equal(fs.readFileSync(fixture.poolPath, "utf8"), before.pool);
  assert.equal(fs.readFileSync(fixture.commandPath, "utf8"), before.command);
});

test("default Ask Mode returns local answer with source=local and llmEnabled=false", async () => {
  const fixture = createFixture();
  const result = await askStrategyOsAsync({ rootDir: fixture.rootDir, date: fixture.date, question: "今天适合做什么？" });

  assert.equal(result.source, "local");
  assert.equal(result.llmEnabled, false);
  assert.equal(result.warning, null);
  assert.ok(result.answer.includes("# 今天适合做什么"));
});

test("STRATEGY_OS_LLM_ENABLED=false keeps local answer and does not call LLM", async () => {
  const fixture = createFixture();
  let called = false;
  const fakeFetch = () => {
    called = true;
    throw new Error("should not be called");
  };
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "今天适合做什么？",
    env: { ...process.env, STRATEGY_OS_LLM_ENABLED: "false", STRATEGY_OS_LLM_API_KEY: "sk-should-not-be-used", STRATEGY_OS_LLM_MODEL: "x" },
    deps: { fetch: fakeFetch }
  });

  assert.equal(called, false);
  assert.equal(result.source, "local");
  assert.equal(result.llmEnabled, false);
});

test("useSearch=false does not search even when question contains latest-info trigger", async () => {
  const fixture = createFixture();
  let called = false;
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "最近 Anthropic 有什么新闻？",
    useSearch: false,
    env: { STRATEGY_OS_LLM_ENABLED: "false" },
    deps: {
      searchWeb: async () => {
        called = true;
        return { query: "x", results: [], warning: null };
      }
    }
  });

  assert.equal(called, false);
  assert.equal(result.search.used, false);
  assert.equal(result.source, "local");
});

test("useSearch=true calls search client and returns public search metadata", async () => {
  const fixture = createFixture();
  let called = false;
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "最近 Anthropic 有什么新闻？",
    useSearch: true,
    env: { STRATEGY_OS_LLM_ENABLED: "false" },
    deps: {
      searchWeb: async ({ query }) => {
        called = true;
        return {
          provider: "tavily",
          query,
          plannedQueries: ["Anthropic AI news Claude product launch recent"],
          intent: "news",
          freshness: "oneMonth",
          recency: { required: true, reason: "新闻与发布信息需要近期结果。", filteredOldCount: 0, missingDateCount: 0 },
          filters: { blockedTopicCount: 0, duplicateCount: 0 },
          warning: null,
          results: [{ title: "Anthropic news", url: "https://example.com/a", snippet: "news", source: "example.com" }]
        };
      }
    }
  });

  assert.equal(called, true);
  assert.equal(result.search.used, true);
  assert.equal(result.search.resultCount, 1);
  assert.equal(result.search.intent, "news");
  assert.equal(result.search.freshness, "oneMonth");
  assert.equal(result.search.recency.required, true);
  assert.equal(JSON.stringify(result.search).includes("sk-"), false);
  assert.ok(result.answer.includes("参考来源"));
});

test("search failure returns Chinese warning and keeps local fallback answer", async () => {
  const fixture = createFixture();
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "查一下最近 Anthropic 有什么新闻？",
    useSearch: true,
    env: { STRATEGY_OS_LLM_ENABLED: "false" },
    deps: {
      searchWeb: async ({ query }) => ({
        provider: "tavily",
        query,
        warning: "联网搜索暂时不可用，已使用本地上下文回答。",
        results: []
      })
    }
  });

  assert.equal(result.search.used, false);
  assert.ok(result.search.warning.includes("联网搜索暂时不可用"));
  assert.ok(result.answer.includes("# 战略回答"));
});

test("STRATEGY_OS_LLM_ENABLED=true with API failure returns local-fallback + Chinese warning", async () => {
  const fixture = createFixture();
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "今天适合做什么？",
    env: {
      ...process.env,
      STRATEGY_OS_LLM_ENABLED: "true",
      STRATEGY_OS_LLM_API_KEY: "sk-mock-key",
      STRATEGY_OS_LLM_MODEL: "mock-model",
      STRATEGY_OS_LLM_BASE_URL: "https://example.invalid/v1"
    },
    deps: { fetch: fakeFetch }
  });

  assert.equal(result.source, "local-fallback");
  assert.equal(result.llmEnabled, true);
  assert.equal(result.warning, "LLM 动态回答暂时不可用，已回退到本地规则回答。");
  assert.ok(result.answer.includes("# 今天适合做什么"));
});

test("STRATEGY_OS_LLM_ENABLED=true with API success returns source=llm", async () => {
  const fixture = createFixture();
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: "# LLM 回答\n\n结论：动态中文判断。" } }]
    })
  });
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "今天适合做什么？",
    env: {
      ...process.env,
      STRATEGY_OS_LLM_ENABLED: "true",
      STRATEGY_OS_LLM_API_KEY: "sk-mock-key",
      STRATEGY_OS_LLM_MODEL: "mock-model",
      STRATEGY_OS_LLM_BASE_URL: "https://example.invalid/v1"
    },
    deps: { fetch: fakeFetch }
  });

  assert.equal(result.source, "llm");
  assert.equal(result.llmEnabled, true);
  assert.equal(result.warning, null);
  assert.ok(result.answer.includes("动态中文判断"));
});

test("search results are injected into LLM prompt without API key and with truncated snippets", async () => {
  const fixture = createFixture();
  const longSnippet = "外部搜索摘要".repeat(80);
  let capturedPrompt = "";
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    capturedPrompt = body.messages[1].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "# LLM 回答\n\n结论：结合本地上下文和外部搜索，今天先观察。" } }]
      })
    };
  };

  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "最近 Anthropic 有什么新闻？",
    useSearch: true,
    env: {
      STRATEGY_OS_LLM_ENABLED: "true",
      STRATEGY_OS_LLM_API_KEY: "sk-llm-key",
      STRATEGY_OS_LLM_MODEL: "mock-model",
      STRATEGY_OS_LLM_BASE_URL: "https://example.invalid/v1",
      STRATEGY_OS_SEARCH_API_KEY: "sk-search-secret"
    },
    deps: {
      fetch: fakeFetch,
      searchWeb: async ({ query }) => ({
        provider: "tavily",
        query,
        plannedQueries: ["Anthropic AI news Claude product launch recent"],
        intent: "news",
        freshness: "oneMonth",
        recency: { required: true, reason: "新闻与发布信息需要近期结果。", filteredOldCount: 2, missingDateCount: 1 },
        filters: { blockedTopicCount: 0, duplicateCount: 1 },
        quality: { averageScore: 76, topSourceScore: 88, lowQualityCount: 0, weakReason: "", hasHighConfidenceSources: true },
        warning: null,
        results: [{ title: "Anthropic update", url: "https://example.com/news", snippet: longSnippet, source: "example.com", quality: { overallScore: 88 } }]
      })
    }
  });

  assert.equal(result.source, "llm");
  assert.ok(capturedPrompt.includes("【外部搜索结果摘要】"));
  assert.ok(capturedPrompt.includes("搜索意图：news"));
  assert.ok(capturedPrompt.includes("实际搜索词：Anthropic AI news Claude product launch recent"));
  assert.ok(capturedPrompt.includes("搜索时间范围：oneMonth"));
  assert.ok(capturedPrompt.includes("时效性过滤：过旧 2 条，缺少日期 1 条。"));
  assert.ok(capturedPrompt.includes("相关性过滤：无关财经 0 条，重复 1 条。"));
  assert.ok(capturedPrompt.includes("搜索质量摘要：平均 76，最高 88，低质来源 0 条。"));
  assert.ok(capturedPrompt.includes("质量：88 / 100"));
  assert.ok(capturedPrompt.includes("搜索结果只是参考"));
  assert.ok(capturedPrompt.includes("A股、行情、股票、盘面热点"));
  assert.equal(capturedPrompt.includes("sk-llm-key"), false);
  assert.equal(capturedPrompt.includes("sk-search-secret"), false);
  assert.ok(capturedPrompt.length < longSnippet.length + 3000, "搜索摘要应被截断后注入 prompt");
});

test("API key is never included in the user prompt", () => {
  const fixture = createFixture();
  const result = askStrategyOs({ rootDir: fixture.rootDir, date: fixture.date });
  const prompt = buildLlmUserPrompt({
    context: result.context,
    type: "today-action",
    question: "今天适合做什么？"
  });

  assert.equal(prompt.includes("sk-"), false);
  assert.equal(prompt.includes("do-not-read-this"), false);
  assert.equal(prompt.includes("LLM_API_KEY"), false);
});

test("llm client readConfig defaults to disabled", () => {
  const config = llmClient.readConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, "");
  assert.equal(config.timeoutMs, 30000);
});

test("llm client isConfigured requires enabled + key + model", () => {
  assert.equal(llmClient.isConfigured({ enabled: true, apiKey: "k", model: "m" }), true);
  assert.equal(llmClient.isConfigured({ enabled: false, apiKey: "k", model: "m" }), false);
  assert.equal(llmClient.isConfigured({ enabled: true, apiKey: "", model: "m" }), false);
  assert.equal(llmClient.isConfigured({ enabled: true, apiKey: "k", model: "" }), false);
});

test("llm client sanitizes API key from logged errors", async () => {
  const fixture = createFixture();
  const captured = [];
  const origWarn = console.warn;
  console.warn = (msg) => captured.push(String(msg));
  try {
    const fakeFetch = async () => ({ ok: false, status: 401, text: async () => "denied sk-leak-key-1234" });
    await askStrategyOsAsync({
      rootDir: fixture.rootDir,
      date: fixture.date,
      question: "今天适合做什么？",
      env: {
        ...process.env,
        STRATEGY_OS_LLM_ENABLED: "true",
        STRATEGY_OS_LLM_API_KEY: "sk-leak-key-1234",
        STRATEGY_OS_LLM_MODEL: "m",
        STRATEGY_OS_LLM_BASE_URL: "https://example.invalid/v1"
      },
      deps: { fetch: fakeFetch }
    });
  } finally {
    console.warn = origWarn;
  }

  const joined = captured.join("\n");
  assert.equal(joined.includes("sk-leak-key-1234"), false);
});

test("load-env reads .env into a clean env without leaking keys", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-load-env-"));
  fs.writeFileSync(
    path.join(rootDir, ".env"),
    [
      "STRATEGY_OS_LLM_ENABLED=true",
      'STRATEGY_OS_LLM_API_KEY="sk-only-in-file"',
      "STRATEGY_OS_LLM_MODEL=m-from-file",
      "STRATEGY_OS_LLM_BASE_URL=https://from-file.example/v1",
      "STRATEGY_OS_LLM_TIMEOUT_MS=12345",
      "STRATEGY_OS_SEARCH_ENABLED=true",
      "STRATEGY_OS_SEARCH_PROVIDER=tavily",
      "STRATEGY_OS_SEARCH_API_KEY=sk-search-file",
      "STRATEGY_OS_SEARCH_FRESHNESS=oneMonth",
      "UNRELATED_PASSWORD=hunter2"
    ].join("\n")
  );
  const freshEnv = {};
  loadEnv.loadDotenv({ rootDir, env: freshEnv, silent: true });

  assert.equal(freshEnv.STRATEGY_OS_LLM_ENABLED, "true");
  assert.equal(freshEnv.STRATEGY_OS_LLM_API_KEY, "sk-only-in-file");
  assert.equal(freshEnv.STRATEGY_OS_LLM_MODEL, "m-from-file");
  assert.equal(freshEnv.STRATEGY_OS_LLM_BASE_URL, "https://from-file.example/v1");
  assert.equal(freshEnv.STRATEGY_OS_LLM_TIMEOUT_MS, "12345");
  assert.equal(freshEnv.STRATEGY_OS_SEARCH_ENABLED, "true");
  assert.equal(freshEnv.STRATEGY_OS_SEARCH_PROVIDER, "tavily");
  assert.equal(freshEnv.STRATEGY_OS_SEARCH_API_KEY, "sk-search-file");
  assert.equal(freshEnv.STRATEGY_OS_SEARCH_FRESHNESS, "oneMonth");
  // 白名单外的变量不应被注入。
  assert.equal(freshEnv.UNRELATED_PASSWORD, undefined);
});

test("load-env never overrides existing shell env", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-load-env-"));
  fs.writeFileSync(
    path.join(rootDir, ".env"),
    [
      "STRATEGY_OS_LLM_API_KEY=sk-from-file",
      "STRATEGY_OS_LLM_MODEL=m-from-file"
    ].join("\n")
  );
  const shellEnv = { STRATEGY_OS_LLM_API_KEY: "sk-from-shell" };
  loadEnv.loadDotenv({ rootDir, env: shellEnv, silent: true });

  assert.equal(shellEnv.STRATEGY_OS_LLM_API_KEY, "sk-from-shell");
  assert.equal(shellEnv.STRATEGY_OS_LLM_MODEL, "m-from-file");
});

test("load-env is a no-op when .env is missing or unparseable", () => {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-load-env-"));
  const env1 = {};
  const result1 = loadEnv.loadDotenv({ rootDir: missingRoot, env: env1, silent: true });
  assert.equal(result1.loaded, false);
  assert.equal(result1.reason, "missing");
  assert.equal(env1.STRATEGY_OS_LLM_API_KEY, undefined);
});

test("askStrategyOsAsync reads STRATEGY_OS_LLM_* from custom env and falls back on failure", async () => {
  const fixture = createFixture();
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  const result = await askStrategyOsAsync({
    rootDir: fixture.rootDir,
    date: fixture.date,
    question: "今天适合做什么？",
    env: {
      STRATEGY_OS_LLM_ENABLED: "true",
      STRATEGY_OS_LLM_API_KEY: "sk-mock-key",
      STRATEGY_OS_LLM_MODEL: "mock-model",
      STRATEGY_OS_LLM_BASE_URL: "https://example.invalid/v1",
      STRATEGY_OS_LLM_TIMEOUT_MS: "1000"
    },
    deps: { fetch: fakeFetch }
  });

  assert.equal(result.source, "local-fallback");
  assert.equal(result.llmEnabled, true);
  assert.equal(result.warning, "LLM 动态回答暂时不可用，已回退到本地规则回答。");
});

test("start-ask-ui /api/ask never echoes the API key back", async () => {
  const fixture = createFixture();
  delete require.cache[require.resolve("../scripts/start-ask-ui")];
  delete require.cache[require.resolve("../scripts/ask-strategy-os")];
  delete require.cache[require.resolve("../scripts/llm-client")];
  delete require.cache[require.resolve("../scripts/load-env")];
  const { startAskUiServers, closeAskUiServers } = require("../scripts/start-ask-ui");
  const { servers } = await startAskUiServers({ rootDir: fixture.rootDir, port: 0, hosts: ["127.0.0.1"] });
  const port = servers[0].address().port;
  const oldEnv = process.env.STRATEGY_OS_LLM_ENABLED;
  const oldBase = process.env.STRATEGY_OS_LLM_BASE_URL;
  const oldKey = process.env.STRATEGY_OS_LLM_API_KEY;
  const oldModel = process.env.STRATEGY_OS_LLM_MODEL;
  process.env.STRATEGY_OS_LLM_ENABLED = "true";
  process.env.STRATEGY_OS_LLM_BASE_URL = "http://127.0.0.1:1/v1";
  process.env.STRATEGY_OS_LLM_API_KEY = "sk-server-leak";
  process.env.STRATEGY_OS_LLM_MODEL = "m";
  try {
    const body = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ question: "今天适合做什么？" });
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/ask",
          headers: { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) }
        },
        (res) => {
          let chunks = "";
          res.on("data", (c) => (chunks += c));
          res.on("end", () => resolve({ status: res.statusCode, body: chunks }));
        }
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    });
    const payload = JSON.parse(body.body);
    assert.equal(body.status, 200);
    assert.equal(payload.llmEnabled, true);
    assert.equal(payload.source === "local-fallback" || payload.source === "llm", true);
    if (payload.warning) assert.equal(payload.warning.includes("sk-"), false);
    assert.equal(JSON.stringify(payload).includes("sk-server-leak"), false);
  } finally {
    delete require.cache[require.resolve("../scripts/start-ask-ui")];
    delete require.cache[require.resolve("../scripts/ask-strategy-os")];
    delete require.cache[require.resolve("../scripts/llm-client")];
    delete require.cache[require.resolve("../scripts/load-env")];
    if (oldEnv === undefined) delete process.env.STRATEGY_OS_LLM_ENABLED;
    else process.env.STRATEGY_OS_LLM_ENABLED = oldEnv;
    if (oldBase === undefined) delete process.env.STRATEGY_OS_LLM_BASE_URL;
    else process.env.STRATEGY_OS_LLM_BASE_URL = oldBase;
    if (oldKey === undefined) delete process.env.STRATEGY_OS_LLM_API_KEY;
    else process.env.STRATEGY_OS_LLM_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.STRATEGY_OS_LLM_MODEL;
    else process.env.STRATEGY_OS_LLM_MODEL = oldModel;
    await closeAskUiServers(servers);
  }
});

// ============== V0.3.10 Ask Mode 上下文注入机会池 ==============

test("buildLlmUserPrompt: 注入机会池摘要，使用中文 status / type", () => {
  const prompt = buildLlmUserPrompt({
    context: {
      contextText: "",
      dailyCommand: null,
      opportunityPool: {
        opportunities: [
          {
            id: "1",
            opportunityName: "短视频选题工具",
            status: "validate",
            type: "new-project-opportunity",
            tags: ["高潜力", "可快速验证"],
            notes: "用户认为适合做短视频选题工具验证。",
            nextAction: "做一个最小页面或提示词流程。"
          }
        ]
      },
      report: null
    },
    type: "general-strategy-question",
    question: "今天适合做什么？"
  });
  assert.ok(prompt.includes("短视频选题工具"), "prompt 应包含机会标题");
  assert.ok(prompt.includes("待验证"), "prompt 应使用中文 status 标签");
  assert.ok(prompt.includes("新项目机会"), "prompt 应使用中文 type 标签");
  assert.ok(prompt.includes("高潜力"), "prompt 应包含 tags");
  assert.ok(prompt.includes("用户认为适合做短视频选题工具验证"), "prompt 应包含 note");
});

test("buildLlmUserPrompt: archived / rejected 默认不注入机会池", () => {
  const prompt = buildLlmUserPrompt({
    context: {
      contextText: "",
      opportunityPool: {
        opportunities: [
          { id: "1", opportunityName: "已归档A", status: "archived" },
          { id: "2", opportunityName: "已拒绝B", status: "rejected" }
        ]
      }
    },
    type: "general-strategy-question",
    question: "q"
  });
  assert.equal(prompt.includes("已归档A"), false, "archived 不应注入");
  assert.equal(prompt.includes("已拒绝B"), false, "rejected 不应注入");
});

test("buildLlmUserPrompt: prompt 中不出现 raw JSON 字段名", () => {
  const prompt = buildLlmUserPrompt({
    context: {
      contextText: "",
      opportunityPool: {
        opportunities: [
          {
            id: "1",
            opportunityName: "字段测试",
            status: "validate",
            type: "new-project-opportunity",
            tags: ["a"],
            notes: "n",
            scores: { ericChanFit: 4 },
            sourceUrls: [{ title: "t", url: "u", source: "s" }]
          }
        ]
      }
    },
    type: "general-strategy-question",
    question: "q"
  });
  for (const field of ["\"tags\":", "\"notes\":", "\"scores\":", "\"sourceUrls\":", "humanDecision:", "ericChanFit"]) {
    assert.equal(prompt.includes(field), false, `prompt 不应出现 '${field}'`);
  }
});

test("buildLlmUserPrompt: 用户编辑机会后，prompt 包含新 note", () => {
  // 模拟用户编辑：第二次 build 时 notes 已被更新
  const ctx = {
    contextText: "",
    opportunityPool: {
      opportunities: [
        {
          id: "1",
          opportunityName: "编辑测试",
          status: "validate",
          type: "new-project-opportunity",
          tags: [],
          notes: "更新后这是我重点关注的方向"
        }
      ]
    }
  };
  const prompt = buildLlmUserPrompt({
    context: ctx,
    type: "general-strategy-question",
    question: "今天适合做什么？"
  });
  assert.ok(prompt.includes("更新后这是我重点关注的方向"), "应包含用户最新编辑的备注");
});

// ============== V0.3.11 开工包 ==============

test("buildKickoffUserPrompt: 包含机会名称、备注、标签、下一步", () => {
  const prompt = buildKickoffUserPrompt({
    name: "AI 短视频选题助手",
    oneLine: "把热点和方向结合成可拍选题",
    note: "MVP 验证",
    next: "做一个最小页面",
    tags: ["高潜力", "可快速验证"],
    sourceQuestion: "想做点啥",
    sourceUrls: []
  });
  assert.ok(prompt.includes("AI 短视频选题助手"));
  assert.ok(prompt.includes("MVP 验证"));
  assert.ok(prompt.includes("做一个最小页面"));
  assert.ok(prompt.includes("高潜力"));
  assert.ok(prompt.includes("可快速验证"));
});

test("buildKickoffUserPrompt: 不注入 API Key / raw search response 字段", () => {
  const prompt = buildKickoffUserPrompt({
    name: "N",
    oneLine: "a",
    note: "sk-1234567890abcdef",
    next: "do",
    tags: [],
    sourceQuestion: "",
    sourceUrls: []
  });
  assert.equal(prompt.includes("sk-1234567890abcdef"), false, "应脱敏");
  assert.equal(prompt.includes("rawResponse"), false);
});

test("buildLocalKickoff: 包含 10 个小节", () => {
  const text = buildLocalKickoff({
    name: "X",
    oneLine: "y",
    note: "n",
    next: "做 X",
    tags: ["t"],
    sourceQuestion: "q",
    sourceUrls: []
  });
  for (let i = 1; i <= 10; i += 1) {
    assert.ok(text.includes(`${i}.`), `应包含小节 ${i}.`);
  }
  assert.ok(text.includes("X"), "应包含机会名");
  assert.ok(text.includes("做 X"), "应包含 next");
  assert.ok(text.includes("y"), "应包含一句话");
});

test("buildSparseKickoff: 信息不足时给保守版开工包 + 中文提示", () => {
  const text = buildSparseKickoff({ name: "N", sourceQuestion: "q" });
  assert.ok(/保守版|信息不足/.test(text));
  for (let i = 1; i <= 10; i += 1) {
    assert.ok(text.includes(`${i}.`), `应包含小节 ${i}.`);
  }
});

test("generateKickoffPackageForOpportunity: 数据稀疏时回退到 sparse 模板", async () => {
  const result = await generateKickoffPackageForOpportunity({
    opportunity: { id: "x", opportunityName: "稀疏机会" },
    env: {}
  });
  assert.ok(result.answer.length > 0);
  assert.ok(/保守版|信息不足/.test(result.answer));
  assert.ok(result.warning && /信息不足/.test(result.warning));
});

test("generateKickoffPackageForOpportunity: 数据完整时回退到本地规则模板（无 LLM 配置）", async () => {
  const result = await generateKickoffPackageForOpportunity({
    opportunity: {
      id: "x",
      opportunityName: "AI 短视频选题助手",
      oneLineSummary: "把热点和方向结合成可拍选题",
      notes: "MVP 验证",
      nextAction: "做一个最小网页",
      tags: ["高潜力", "可快速验证"]
    },
    env: {} // 无 LLM 配置
  });
  assert.ok(result.answer.length > 100, "应有结构化开工包");
  assert.equal(result.source, "local", "无 LLM 时 source=local");
  assert.ok(result.answer.includes("AI 短视频选题助手"));
  assert.ok(result.answer.includes("做一个最小网页"));
});

test("generateKickoffPackageForOpportunity: 不暴露 API Key", async () => {
  const result = await generateKickoffPackageForOpportunity({
    opportunity: {
      id: "x",
      opportunityName: "测试 sk-1234abcd",
      oneLineSummary: "x",
      notes: "y",
      nextAction: "z",
      tags: []
    },
    env: {}
  });
  assert.ok(result.answer.length > 0);
  // 不在 result 里出现 rawResponse / apiKey 字段
  for (const key of Object.keys(result)) {
    assert.equal(/rawResponse|apiKey|sk-/.test(String(result[key] || "")), false, `字段 ${key} 不应暴露敏感信息`);
  }
  // ensure response key set
  for (const key of ["answer", "source", "warning", "opportunity"]) {
    assert.ok(key in result, `应包含字段: ${key}`);
  }
});
