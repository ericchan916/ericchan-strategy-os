const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { getDateString } = require("../scripts/generate-report");
const { safeErrorMessage, startAskUiServer } = require("../scripts/start-ask-ui");

// 防止真实 .env 把 STRATEGY_OS_LLM_* 注进 process.env，导致 UI 测试命中真实 LLM。
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
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ask-ui-"));
  const date = getDateString();
  fs.mkdirSync(path.join(rootDir, "context"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "daily-command"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "context", "context.md"), "EricChan 使用中文 Ask Mode 做个人战略判断。");
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
    recommendedActions: [{ action: "保持今天的动作足够轻。", stageFit: "now" }]
  });
  writeJson(path.join(rootDir, "data", "opportunities", "opportunity-pool.json"), {
    version: 1,
    opportunities: [
      {
        id: "opp-brief",
        status: "validate",
        humanDecision: "accepted",
        opportunityName: "Independent AI opportunity brief MVP"
      }
    ]
  });
  writeJson(path.join(rootDir, "data", "daily-command", `${date}.json`), {
    date,
    sourceMode: "mock",
    oneLineJudgment: "今天先把最强机会压成一个可验证的小动作。",
    topOpportunities: [{ opportunityName: "Independent AI opportunity brief MVP" }],
    recommendedActions: [{ action: "写一段样例 brief", expectedOutput: "一段样例", timebox: "45 min" }]
  });
  fs.writeFileSync(path.join(rootDir, "daily-command", `${date}.md`), "# EricChan·战略OS Daily Command\n");
  fs.writeFileSync(path.join(rootDir, ".env"), "LLM_API_KEY=do-not-read-this\n");
  return {
    rootDir,
    reportPath: path.join(rootDir, "data", "reports", `${date}.json`),
    poolPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    commandPath: path.join(rootDir, "daily-command", `${date}.md`)
  };
}

function request(baseUrl, { method = "GET", path: requestPath = "/", body } = {}) {
  const url = new URL(requestPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: body ? { "content-type": "application/json" } : {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function withServer(rootDir, fn) {
  const server = await startAskUiServer({ rootDir, port: 0 });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("ask UI serves Chinese HTML with recommended questions", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl);

    assert.equal(response.status, 200);
    assert.ok(response.body.includes("EricChan·战略OS"));
    // V0.3.4-hotfix: 顶部副标题已替换为新文案。
    const oldSubtitle = response.body.includes("主动提问，而不是被动推送");
    assert.equal(oldSubtitle, false, "旧副标题不应再出现");
    const hasNewSubtitle =
      response.body.includes("把想法压成判断") ||
      response.body.includes("把混乱的问题，压成今天能做的判断");
    assert.ok(hasNewSubtitle, "缺少新副标题文案");
    assert.ok(response.body.includes("今天适合做什么？"));
    assert.ok(response.body.includes("最近提问"), "HTML 应含历史记录区域");
  });
});

test("start-ask-ui safeErrorMessage redacts sk-like secrets", () => {
  const error = new Error("上游失败：sk-v0-4-3-secret-123456");
  const message = safeErrorMessage(error, "fallback");

  assert.equal(message.includes("sk-v0-4-3-secret-123456"), false);
  assert.ok(message.includes("[redacted]"));
});

test("ask UI API returns a Chinese Ask Mode answer", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "POST",
      path: "/api/ask",
      body: { question: "今天适合做什么？" }
    });
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.equal(payload.type, "today-action");
    assert.ok(payload.answer.includes("# 今天适合做什么"));
    assert.ok(payload.answer.includes("今天不要做"));
  });
});

test("V0.5: ask UI API accepts currentGoal without writing strategy files", async () => {
  const fixture = createFixture();
  const beforePool = fs.readFileSync(fixture.poolPath, "utf8");
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "POST",
      path: "/api/ask",
      body: {
        question: "今天适合做什么？",
        currentGoal: "用战略OS筛选适合独立开发者的小型 AI 产品 sk-goalServer123456"
      }
    });
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.ok(payload.answer.includes("当前目标锚点"));
    assert.ok(payload.answer.includes("用战略OS筛选适合独立开发者的小型 AI 产品"));
    assert.equal(JSON.stringify(payload).includes("sk-goalServer123456"), false);
  });
  assert.equal(fs.readFileSync(fixture.poolPath, "utf8"), beforePool, "currentGoal 不应写入 opportunity-pool.json");
});

test("V0.6.3-hotfix: /api/ask redacts sk-like question and currentGoal in LLM response", async () => {
  const fixture = createFixture();
  const oldEnv = {
    enabled: process.env.STRATEGY_OS_LLM_ENABLED,
    key: process.env.STRATEGY_OS_LLM_API_KEY,
    model: process.env.STRATEGY_OS_LLM_MODEL,
    baseUrl: process.env.STRATEGY_OS_LLM_BASE_URL
  };
  const oldFetch = globalThis.fetch;
  let capturedPrompt = "";
  process.env.STRATEGY_OS_LLM_ENABLED = "true";
  process.env.STRATEGY_OS_LLM_API_KEY = "sk-real-test-key";
  process.env.STRATEGY_OS_LLM_MODEL = "mock-model";
  process.env.STRATEGY_OS_LLM_BASE_URL = "https://example.invalid/v1";
  globalThis.fetch = async (_url, options) => {
    capturedPrompt = JSON.parse(options.body).messages[1].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "回答里回显 sk-leakTestABC，也应该被后端脱敏。" } }]
      })
    };
  };

  try {
    await withServer(fixture.rootDir, async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        path: "/api/ask",
        body: {
          question: "我的测试 key 是 sk-leakTestABC，今天适合做什么？",
          currentGoal: "当前 Goal sk-goalLeakABC"
        }
      });
      const payload = JSON.parse(response.body);
      const serialized = JSON.stringify(payload);

      assert.equal(response.status, 200);
      assert.equal(payload.source, "llm");
      assert.equal(capturedPrompt.includes("sk-leakTestABC"), false);
      assert.equal(capturedPrompt.includes("sk-goalLeakABC"), false);
      assert.equal(serialized.includes("sk-leakTestABC"), false);
      assert.equal(serialized.includes("sk-goalLeakABC"), false);
      assert.ok(serialized.includes("[redacted]"));
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.enabled === undefined) delete process.env.STRATEGY_OS_LLM_ENABLED;
    else process.env.STRATEGY_OS_LLM_ENABLED = oldEnv.enabled;
    if (oldEnv.key === undefined) delete process.env.STRATEGY_OS_LLM_API_KEY;
    else process.env.STRATEGY_OS_LLM_API_KEY = oldEnv.key;
    if (oldEnv.model === undefined) delete process.env.STRATEGY_OS_LLM_MODEL;
    else process.env.STRATEGY_OS_LLM_MODEL = oldEnv.model;
    if (oldEnv.baseUrl === undefined) delete process.env.STRATEGY_OS_LLM_BASE_URL;
    else process.env.STRATEGY_OS_LLM_BASE_URL = oldEnv.baseUrl;
  }
});

test("V0.6.3-hotfix: /api/ask redacts sk-like strings from search query and sources", async () => {
  const fixture = createFixture();
  const oldEnv = {
    llmEnabled: process.env.STRATEGY_OS_LLM_ENABLED,
    llmKey: process.env.STRATEGY_OS_LLM_API_KEY,
    llmModel: process.env.STRATEGY_OS_LLM_MODEL,
    llmBaseUrl: process.env.STRATEGY_OS_LLM_BASE_URL,
    searchEnabled: process.env.STRATEGY_OS_SEARCH_ENABLED,
    provider: process.env.STRATEGY_OS_SEARCH_PROVIDER,
    searchKey: process.env.STRATEGY_OS_SEARCH_API_KEY
  };
  const oldFetch = globalThis.fetch;
  const searchBodies = [];
  const llmPrompts = [];
  process.env.STRATEGY_OS_LLM_ENABLED = "true";
  process.env.STRATEGY_OS_LLM_API_KEY = "sk-real-test-key";
  process.env.STRATEGY_OS_LLM_MODEL = "mock-model";
  process.env.STRATEGY_OS_LLM_BASE_URL = "https://llm.example.invalid/v1";
  process.env.STRATEGY_OS_SEARCH_ENABLED = "true";
  process.env.STRATEGY_OS_SEARCH_PROVIDER = "bocha";
  process.env.STRATEGY_OS_SEARCH_API_KEY = "sk-search-test-key";
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).includes("bochaai")) {
      searchBodies.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          webPages: {
            value: [{
              name: "结果标题 sk-leakTestABC",
              url: "https://example.com/sk-leakTestABC",
              siteName: "来源 sk-leakTestABC",
              summary: "摘要 sk-leakTestABC AI 产品机会",
              datePublished: "2026-07-01T00:00:00Z"
            }]
          }
        })
      };
    }
    llmPrompts.push(body.messages[1].content);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "联网回答 sk-leakTestABC" } }]
      })
    };
  };

  try {
    await withServer(fixture.rootDir, async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        path: "/api/ask",
        body: {
          question: "请联网搜索 sk-leakTestABC 最近有什么适合独立开发者做的小型 AI 项目？",
          useSearch: true
        }
      });
      const payload = JSON.parse(response.body);
      const serialized = JSON.stringify(payload);

      assert.equal(response.status, 200);
      assert.equal(payload.search.used, true);
      assert.equal(searchBodies.some((body) => JSON.stringify(body).includes("sk-leakTestABC")), false);
      assert.equal(llmPrompts.some((prompt) => prompt.includes("sk-leakTestABC")), false);
      assert.equal(serialized.includes("sk-leakTestABC"), false);
      assert.ok(serialized.includes("[redacted]"));
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.llmEnabled === undefined) delete process.env.STRATEGY_OS_LLM_ENABLED;
    else process.env.STRATEGY_OS_LLM_ENABLED = oldEnv.llmEnabled;
    if (oldEnv.llmKey === undefined) delete process.env.STRATEGY_OS_LLM_API_KEY;
    else process.env.STRATEGY_OS_LLM_API_KEY = oldEnv.llmKey;
    if (oldEnv.llmModel === undefined) delete process.env.STRATEGY_OS_LLM_MODEL;
    else process.env.STRATEGY_OS_LLM_MODEL = oldEnv.llmModel;
    if (oldEnv.llmBaseUrl === undefined) delete process.env.STRATEGY_OS_LLM_BASE_URL;
    else process.env.STRATEGY_OS_LLM_BASE_URL = oldEnv.llmBaseUrl;
    if (oldEnv.searchEnabled === undefined) delete process.env.STRATEGY_OS_SEARCH_ENABLED;
    else process.env.STRATEGY_OS_SEARCH_ENABLED = oldEnv.searchEnabled;
    if (oldEnv.provider === undefined) delete process.env.STRATEGY_OS_SEARCH_PROVIDER;
    else process.env.STRATEGY_OS_SEARCH_PROVIDER = oldEnv.provider;
    if (oldEnv.searchKey === undefined) delete process.env.STRATEGY_OS_SEARCH_API_KEY;
    else process.env.STRATEGY_OS_SEARCH_API_KEY = oldEnv.searchKey;
  }
});

test("ask UI API returns public search metadata when useSearch=true", async () => {
  const fixture = createFixture();
  const oldEnv = {
    enabled: process.env.STRATEGY_OS_SEARCH_ENABLED,
    provider: process.env.STRATEGY_OS_SEARCH_PROVIDER,
    key: process.env.STRATEGY_OS_SEARCH_API_KEY
  };
  const oldFetch = globalThis.fetch;
  process.env.STRATEGY_OS_SEARCH_ENABLED = "true";
  process.env.STRATEGY_OS_SEARCH_PROVIDER = "tavily";
  process.env.STRATEGY_OS_SEARCH_API_KEY = "sk-search-ui";
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [{ title: "Anthropic latest", url: "https://example.com/news", content: "short snippet" }]
    })
  });

  try {
    await withServer(fixture.rootDir, async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        path: "/api/ask",
        body: { question: "最近 Anthropic 有什么新闻？", useSearch: true }
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.status, 200);
      assert.equal(payload.search.used, true);
      assert.equal(payload.search.resultCount, 1);
      assert.equal(payload.search.intent, "news");
      assert.equal(payload.search.freshness, "oneMonth");
      assert.equal(payload.search.recency.required, true);
      assert.ok(payload.search.filters);
      assert.ok(payload.search.quality);
      assert.equal(payload.search.sources[0].source, "example.com");
      assert.ok(payload.search.sources[0].quality.label);
      assert.equal(JSON.stringify(payload).includes("sk-search-ui"), false);
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnv.enabled === undefined) delete process.env.STRATEGY_OS_SEARCH_ENABLED;
    else process.env.STRATEGY_OS_SEARCH_ENABLED = oldEnv.enabled;
    if (oldEnv.provider === undefined) delete process.env.STRATEGY_OS_SEARCH_PROVIDER;
    else process.env.STRATEGY_OS_SEARCH_PROVIDER = oldEnv.provider;
    if (oldEnv.key === undefined) delete process.env.STRATEGY_OS_SEARCH_API_KEY;
    else process.env.STRATEGY_OS_SEARCH_API_KEY = oldEnv.key;
  }
});

test("ask UI opportunities API returns stats and supports whitelisted PATCH", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const listResponse = await request(baseUrl, { path: "/api/opportunities" });
    const listPayload = JSON.parse(listResponse.body);

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.opportunities.length, 1);
    assert.equal(listPayload.opportunities[0].statusLabel, "待验证");
    assert.equal(listPayload.stats.total, 1);

    const patchResponse = await request(baseUrl, {
      method: "PATCH",
      path: "/api/opportunities/opp-brief",
      body: { status: "watch", notes: "网页备注", opportunityName: "我重命名了" }
    });
    const patchPayload = JSON.parse(patchResponse.body);

    assert.equal(patchResponse.status, 200);
    assert.equal(patchPayload.opportunity.status, "watch");
    assert.equal(patchPayload.opportunity.notes, "网页备注");
    assert.equal(patchPayload.opportunity.opportunityName, "我重命名了"); // V0.3.10-hotfix：现在允许
    const saved = JSON.parse(fs.readFileSync(fixture.poolPath, "utf8"));
    assert.equal(saved.opportunities[0].opportunityName, "我重命名了");
  });
});

test("V0.6.3-hotfix: opportunity draft API redacts sk-like request and response fields", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "POST",
      path: "/api/opportunities/draft",
      body: {
        question: "问题 sk-leakTestABC",
        answer: "回答 sk-answerLeakABC",
        currentGoal: "目标 sk-goalLeakABC"
      }
    });
    const payload = JSON.parse(response.body);
    const serialized = JSON.stringify(payload);

    assert.equal(response.status, 200);
    assert.equal(serialized.includes("sk-leakTestABC"), false);
    assert.equal(serialized.includes("sk-answerLeakABC"), false);
    assert.equal(serialized.includes("sk-goalLeakABC"), false);
    assert.ok(serialized.includes("[redacted]"));
  });
});

test("V0.6.3-hotfix: opportunity add and patch do not persist raw sk-like values", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const addResponse = await request(baseUrl, {
      method: "POST",
      path: "/api/opportunities",
      body: {
        opportunityName: "机会 sk-leakTestABC",
        oneLineSummary: "摘要 sk-summaryLeakABC",
        note: "备注 sk-noteLeakABC",
        nextAction: "动作 sk-actionLeakABC"
      }
    });
    assert.equal(addResponse.status, 200);

    const addPayload = JSON.parse(addResponse.body);
    const targetId = addPayload.opportunity.id;
    const patchResponse = await request(baseUrl, {
      method: "PATCH",
      path: `/api/opportunities/${targetId}`,
      body: { notes: "补充 sk-patchLeakABC" }
    });
    assert.equal(patchResponse.status, 200);

    const saved = fs.readFileSync(fixture.poolPath, "utf8");
    assert.equal(saved.includes("sk-leakTestABC"), false);
    assert.equal(saved.includes("sk-summaryLeakABC"), false);
    assert.equal(saved.includes("sk-noteLeakABC"), false);
    assert.equal(saved.includes("sk-actionLeakABC"), false);
    assert.equal(saved.includes("sk-patchLeakABC"), false);
    assert.ok(saved.includes("[redacted]"));
  });
});

test("V0.6.3-hotfix: kickoff API redacts sk-like currentGoal and generated answer", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "POST",
      path: "/api/opportunities/opp-brief/kickoff",
      body: { currentGoal: "目标 sk-goalLeakABC" }
    });
    const payload = JSON.parse(response.body);
    const serialized = JSON.stringify(payload);

    assert.equal(response.status, 200);
    assert.equal(serialized.includes("sk-goalLeakABC"), false);
    assert.ok(serialized.includes("[redacted]"));
  });
});

test("ask UI opportunities API returns Chinese 404 for missing id", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "PATCH",
      path: "/api/opportunities/missing",
      body: { status: "watch" }
    });
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 404);
    assert.ok(payload.error.includes("没有找到这个机会"));
  });
});

test("ask UI API returns Chinese search warning and keeps answering when search is misconfigured", async () => {
  const fixture = createFixture();
  const oldSearchEnv = {
    enabled: process.env.STRATEGY_OS_SEARCH_ENABLED,
    provider: process.env.STRATEGY_OS_SEARCH_PROVIDER,
    key: process.env.STRATEGY_OS_SEARCH_API_KEY
  };
  delete process.env.STRATEGY_OS_SEARCH_PROVIDER;
  delete process.env.STRATEGY_OS_SEARCH_API_KEY;
  process.env.STRATEGY_OS_SEARCH_ENABLED = "true";

  try {
    await withServer(fixture.rootDir, async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        path: "/api/ask",
        body: { question: "查一下最近 Anthropic 有什么新闻？", useSearch: true }
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.status, 200);
      assert.equal(payload.search.used, false);
      assert.ok(payload.search.warning.includes("联网搜索暂时不可用"));
      assert.ok(payload.answer.includes("# 战略回答"));
    });
  } finally {
    if (oldSearchEnv.enabled === undefined) delete process.env.STRATEGY_OS_SEARCH_ENABLED;
    else process.env.STRATEGY_OS_SEARCH_ENABLED = oldSearchEnv.enabled;
    if (oldSearchEnv.provider === undefined) delete process.env.STRATEGY_OS_SEARCH_PROVIDER;
    else process.env.STRATEGY_OS_SEARCH_PROVIDER = oldSearchEnv.provider;
    if (oldSearchEnv.key === undefined) delete process.env.STRATEGY_OS_SEARCH_API_KEY;
    else process.env.STRATEGY_OS_SEARCH_API_KEY = oldSearchEnv.key;
  }
});

test("ask UI API rejects an empty question in Chinese", async () => {
  const fixture = createFixture();
  await withServer(fixture.rootDir, async (baseUrl) => {
    const response = await request(baseUrl, {
      method: "POST",
      path: "/api/ask",
      body: { question: "" }
    });
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 400);
    assert.equal(payload.error, "请输入问题。");
  });
});

test("ask UI does not read .env or modify generated strategy files", async () => {
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
    await withServer(fixture.rootDir, async (baseUrl) => {
      const response = await request(baseUrl, {
        method: "POST",
        path: "/api/ask",
        body: { question: "我看到一个好项目，帮我体检一下。" }
      });

      assert.equal(response.status, 200);
      assert.ok(JSON.parse(response.body).answer.includes("# 项目体检"));
    });
  } finally {
    fs.readFileSync = originalRead;
  }

  assert.equal(fs.readFileSync(fixture.reportPath, "utf8"), before.report);
  assert.equal(fs.readFileSync(fixture.poolPath, "utf8"), before.pool);
  assert.equal(fs.readFileSync(fixture.commandPath, "utf8"), before.command);
});
