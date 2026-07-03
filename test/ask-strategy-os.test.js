const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { askStrategyOs, askStrategyOsAsync, classifyQuestion, buildLlmUserPrompt } = require("../scripts/ask-strategy-os");
const llmClient = require("../scripts/llm-client");
const loadEnv = require("../scripts/load-env");
const http = require("node:http");

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
