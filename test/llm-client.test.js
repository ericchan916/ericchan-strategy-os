const assert = require("node:assert/strict");
const test = require("node:test");

const { readConfig, callChatCompletion, LlmError, normalizeBaseUrl } = require("../scripts/llm-client");

// 记录 fetch 实际收到的 url / headers / body，便于在测试中断言。
function makeFetchSpy({ impl }) {
  const calls = [];
  const fn = async (url, options = {}) => {
    calls.push({ url, options });
    return impl(url, options);
  };
  fn.calls = calls;
  return fn;
}

const BASE_CONFIG = {
  enabled: true,
  apiKey: "sk-test-key",
  model: "test-model",
  timeoutMs: 5000
};

test("normalizeBaseUrl trims trailing slashes", () => {
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1///"), "https://api.openai.com/v1");
});

test("normalizeBaseUrl collapses /chat/completions suffix", () => {
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1");
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1/chat/completions/"), "https://api.openai.com/v1");
});

test("normalizeBaseUrl keeps /v1 as-is", () => {
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1"), "https://api.openai.com/v1");
});

test("normalizeBaseUrl handles bare host", () => {
  assert.equal(normalizeBaseUrl("https://api.example.com"), "https://api.example.com");
});

test("readConfig applies default baseUrl and trims trailing slash", () => {
  const cfg = readConfig({ STRATEGY_OS_LLM_ENABLED: "true", STRATEGY_OS_LLM_API_KEY: "k", STRATEGY_OS_LLM_MODEL: "m" });
  assert.equal(cfg.baseUrl, "https://api.openai.com/v1");
});

test("readConfig normalizes a baseUrl already pointing to /chat/completions", () => {
  const cfg = readConfig({
    STRATEGY_OS_LLM_ENABLED: "true",
    STRATEGY_OS_LLM_API_KEY: "k",
    STRATEGY_OS_LLM_MODEL: "m",
    STRATEGY_OS_LLM_BASE_URL: "https://proxy.example.com/v1/chat/completions"
  });
  assert.equal(cfg.baseUrl, "https://proxy.example.com/v1");
});

test("callChatCompletion appends /chat/completions to a /v1 baseUrl", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "# ok" } }] })
    })
  });
  const text = await callChatCompletion({
    config: { ...BASE_CONFIG, baseUrl: "https://api.openai.com/v1" },
    systemPrompt: "sys",
    userPrompt: "user",
    fetchImpl: fetchSpy
  });
  assert.equal(text, "# ok");
  assert.equal(fetchSpy.calls.length, 1);
  assert.equal(fetchSpy.calls[0].url, "https://api.openai.com/v1/chat/completions");
});

test("callChatCompletion does NOT double /chat/completions when baseUrl already ends with it", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "# ok" } }] })
    })
  });
  await callChatCompletion({
    config: { ...BASE_CONFIG, baseUrl: "https://proxy.example.com/v1/chat/completions" },
    systemPrompt: "sys",
    userPrompt: "user",
    fetchImpl: fetchSpy
  });
  assert.equal(fetchSpy.calls[0].url, "https://proxy.example.com/v1/chat/completions");
});

test("callChatCompletion sends Bearer auth and model in body", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "# ok" } }] })
    })
  });
  await callChatCompletion({
    config: { ...BASE_CONFIG, model: "gpt-x", apiKey: "sk-abc" },
    systemPrompt: "sys",
    userPrompt: "user",
    fetchImpl: fetchSpy
  });
  assert.equal(fetchSpy.calls[0].options.headers.authorization, "Bearer sk-abc");
  const body = JSON.parse(fetchSpy.calls[0].options.body);
  assert.equal(body.model, "gpt-x");
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "user" }
  ]);
});

test("callChatCompletion HTTP 401 returns code 'unauthorized' with safe message", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid sk-leak-1234"}' })
  });
  try {
    await callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof LlmError);
    assert.equal(error.code, "unauthorized");
    assert.ok(error.message.includes("API Key"));
    assert.equal(error.message.includes("sk-leak-1234"), false);
  }
});

test("callChatCompletion HTTP 403 returns code 'forbidden'", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 403, text: async () => "denied" })
  });
  await assert.rejects(
    callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    }),
    (error) => error instanceof LlmError && error.code === "forbidden"
  );
});

test("callChatCompletion HTTP 404 returns code 'not-found' with baseUrl hint", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 404, text: async () => "not found" })
  });
  try {
    await callChatCompletion({
      config: { ...BASE_CONFIG, baseUrl: "https://bad.example.com/v1" },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof LlmError);
    assert.equal(error.code, "not-found");
    assert.ok(error.message.includes("baseUrl"));
    assert.ok(error.message.includes("https://bad.example.com/v1"));
  }
});

test("callChatCompletion HTTP 429 returns code 'rate-limited'", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 429, text: async () => "slow down" })
  });
  await assert.rejects(
    callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    }),
    (error) => error instanceof LlmError && error.code === "rate-limited"
  );
});

test("callChatCompletion HTTP 5xx returns code 'server-error'", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 502, text: async () => "bad gateway" })
  });
  await assert.rejects(
    callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    }),
    (error) => error instanceof LlmError && error.code === "server-error"
  );
});

test("callChatCompletion HTTP error body is redacted of any sk- tokens", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 401, text: async () => "auth failed for sk-leak-1234 token" })
  });
  try {
    await callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
  } catch (error) {
    assert.equal(error.message.includes("sk-leak-1234"), false);
  }
});

test("callChatCompletion network error returns code 'network' with diagnostic hint", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => {
      const e = new Error("ECONNREFUSED 127.0.0.1:443");
      e.code = "ECONNREFUSED";
      throw e;
    }
  });
  try {
    await callChatCompletion({
      config: { ...BASE_CONFIG, baseUrl: "https://unreachable.example.com/v1" },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof LlmError);
    assert.equal(error.code, "network");
    assert.ok(error.message.length > 0);
    // 不应该把内部 socket 错误细节外抛。
    assert.equal(error.message.includes("ECONNREFUSED"), false);
  }
});

test("callChatCompletion timeout returns code 'timeout' with timeoutMs in message", async () => {
  let aborted = false;
  const fetchSpy = makeFetchSpy({
    impl: async (url, options) => {
      return await new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          aborted = true;
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }
  });
  try {
    await callChatCompletion({
      config: { ...BASE_CONFIG, timeoutMs: 50 },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.ok(error instanceof LlmError);
    assert.equal(error.code, "timeout");
    assert.ok(error.message.includes("50ms"));
  }
  assert.equal(aborted, true);
});

test("callChatCompletion parses choices[0].message.content", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "  hello  " } }] })
    })
  });
  const text = await callChatCompletion({
    config: BASE_CONFIG,
    systemPrompt: "sys",
    userPrompt: "user",
    fetchImpl: fetchSpy
  });
  assert.equal(text, "hello");
});

test("callChatCompletion falls back to choices[0].text for completion-style providers", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ text: "from-text-field" }] })
    })
  });
  const text = await callChatCompletion({
    config: BASE_CONFIG,
    systemPrompt: "sys",
    userPrompt: "user",
    fetchImpl: fetchSpy
  });
  assert.equal(text, "from-text-field");
});

test("callChatCompletion throws 'empty' when response has no usable text", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: {} }] })
    })
  });
  try {
    await callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "empty");
  }
});

test("callChatCompletion throws 'parse' on invalid JSON", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })
  });
  try {
    await callChatCompletion({
      config: BASE_CONFIG,
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "parse");
  }
});

test("callChatCompletion never includes the API key in the response or any logged detail", async () => {
  const fetchSpy = makeFetchSpy({
    impl: async () => ({ ok: false, status: 401, text: async () => "denied" })
  });
  const apiKey = "sk-should-never-leak-7890";
  let caught;
  try {
    await callChatCompletion({
      config: { ...BASE_CONFIG, apiKey },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  const dump = JSON.stringify({ message: caught.message, code: caught.code, stack: caught.stack });
  assert.equal(dump.includes(apiKey), false);
});

test("callChatCompletion disabled throws 'disabled'", async () => {
  await assert.rejects(
    callChatCompletion({
      config: { ...BASE_CONFIG, enabled: false },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
    }),
    (error) => error instanceof LlmError && error.code === "disabled"
  );
});

test("callChatCompletion missing apiKey throws 'missing-key'", async () => {
  await assert.rejects(
    callChatCompletion({
      config: { ...BASE_CONFIG, apiKey: "" },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) })
    }),
    (error) => error instanceof LlmError && error.code === "missing-key"
  );
});

test("callChatCompletion missing model throws 'missing-model' WITHOUT hitting the network", async () => {
  let called = false;
  const fetchSpy = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    callChatCompletion({
      config: { ...BASE_CONFIG, model: "" },
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl: fetchSpy
    }),
    (error) => error instanceof LlmError && error.code === "missing-model"
  );
  assert.equal(called, false);
});
