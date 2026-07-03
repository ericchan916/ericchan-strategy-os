const assert = require("node:assert/strict");
const test = require("node:test");

const { buildDiagnostics, runDiagnostic, redactKey } = require("../scripts/check-llm");

test("buildDiagnostics reports enabled=false when STRATEGY_OS_LLM_ENABLED is missing", () => {
  const d = buildDiagnostics({});
  assert.equal(d.enabled, false);
  assert.equal(d.apiKeyPresent, false);
  assert.equal(d.modelPresent, false);
  assert.equal(d.baseUrl, "https://api.openai.com/v1");
  assert.equal(d.timeoutMs, 30000);
  assert.equal(typeof d.requestUrl, "string");
  assert.ok(d.requestUrl.endsWith("/chat/completions"));
});

test("buildDiagnostics reports enabled=true and apiKeyPresent=true when configured", () => {
  const d = buildDiagnostics({
    STRATEGY_OS_LLM_ENABLED: "true",
    STRATEGY_OS_LLM_API_KEY: "sk-should-not-leak-1234",
    STRATEGY_OS_LLM_MODEL: "gpt-x",
    STRATEGY_OS_LLM_BASE_URL: "https://api.openai.com/v1",
    STRATEGY_OS_LLM_TIMEOUT_MS: "15000"
  });
  assert.equal(d.enabled, true);
  assert.equal(d.apiKeyPresent, true);
  assert.equal(d.modelPresent, true);
  assert.equal(d.timeoutMs, 15000);
  // 重要：诊断信息里不能出现 key 字符串。
  const dump = JSON.stringify(d);
  assert.equal(dump.includes("sk-should-not-leak-1234"), false);
});

test("buildDiagnostics collapses /chat/completions in baseUrl", () => {
  const d = buildDiagnostics({
    STRATEGY_OS_LLM_ENABLED: "true",
    STRATEGY_OS_LLM_BASE_URL: "https://proxy.example.com/v1/chat/completions"
  });
  assert.equal(d.baseUrl, "https://proxy.example.com/v1");
  assert.equal(d.requestUrl, "https://proxy.example.com/v1/chat/completions");
});

test("buildDiagnostics strips trailing slash from baseUrl", () => {
  const d = buildDiagnostics({
    STRATEGY_OS_LLM_ENABLED: "true",
    STRATEGY_OS_LLM_BASE_URL: "https://api.example.com/v1/"
  });
  assert.equal(d.baseUrl, "https://api.example.com/v1");
});

test("runDiagnostic returns 'disabled' status when not enabled", async () => {
  const result = await runDiagnostic({ env: {}, fetchImpl: async () => { throw new Error("should not be called"); } });
  assert.equal(result.status, "disabled");
});

test("runDiagnostic returns 'missing-key' when enabled but no key", async () => {
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, "missing-key");
});

test("runDiagnostic returns 'missing-model' when key present but no model", async () => {
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x" },
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  assert.equal(result.status, "missing-model");
});

test("runDiagnostic returns 'success' on 200 with content", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "OK" } }] })
  });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-test", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "success");
  assert.ok(result.summary.includes("OK") || result.summary.includes("成功"));
});

test("runDiagnostic returns 'unauthorized' on 401 without leaking key in summary", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "denied sk-leak-9999" });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-leak-9999", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "unauthorized");
  const dump = JSON.stringify(result);
  assert.equal(dump.includes("sk-leak-9999"), false);
});

test("runDiagnostic returns 'not-found' on 404 and includes baseUrl in summary", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "nope" });
  const result = await runDiagnostic({
    env: {
      STRATEGY_OS_LLM_ENABLED: "true",
      STRATEGY_OS_LLM_API_KEY: "sk-x",
      STRATEGY_OS_LLM_MODEL: "m",
      STRATEGY_OS_LLM_BASE_URL: "https://bad.example.com/v1"
    },
    fetchImpl
  });
  assert.equal(result.status, "not-found");
  assert.ok(result.summary.includes("https://bad.example.com/v1"));
});

test("runDiagnostic returns 'rate-limited' on 429", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "slow" });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "rate-limited");
});

test("runDiagnostic returns 'server-error' on 5xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => "down" });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "server-error");
});

test("runDiagnostic returns 'network' on fetch throw", async () => {
  const fetchImpl = async () => {
    const e = new Error("ECONNREFUSED");
    e.code = "ECONNREFUSED";
    throw e;
  };
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "network");
});

test("runDiagnostic returns 'parse' on invalid JSON", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "parse");
});

test("runDiagnostic returns 'empty' on empty content", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "sk-x", STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  assert.equal(result.status, "empty");
});

test("runDiagnostic never includes the API key in any output field", async () => {
  const apiKey = "sk-this-key-must-not-leak-9876";
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "denied" });
  const result = await runDiagnostic({
    env: { STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: apiKey, STRATEGY_OS_LLM_MODEL: "m" },
    fetchImpl
  });
  const dump = JSON.stringify(result);
  assert.equal(dump.includes(apiKey), false);
});

test("redactKey strips sk- tokens", () => {
  assert.equal(redactKey("hello sk-abc-1234 world"), "hello [redacted] world");
  assert.equal(redactKey("plain text"), "plain text");
  assert.equal(redactKey("sk-a sk-b"), "[redacted] [redacted]");
});
