#!/usr/bin/env node

// Ask Mode 专用 LLM 客户端：仅读取 STRATEGY_OS_LLM_* 命名空间，不读 .env，
// 不输出 / 不返回 API Key。返回纯文本 answer 或抛出可控错误。

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function readConfig(env = process.env) {
  const enabled = String(env.STRATEGY_OS_LLM_ENABLED || "false").toLowerCase() === "true";
  const apiKey = String(env.STRATEGY_OS_LLM_API_KEY || "").trim();
  const baseUrl = String(env.STRATEGY_OS_LLM_BASE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const model = String(env.STRATEGY_OS_LLM_MODEL || "").trim();
  const timeoutMs = Number(env.STRATEGY_OS_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    enabled,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function isConfigured(config) {
  return Boolean(config.enabled && config.apiKey && config.model);
}

class LlmError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

async function callChatCompletion({ config, systemPrompt, userPrompt, fetchImpl = globalThis.fetch, abortImpl = globalThis.AbortController }) {
  if (!config || !config.enabled) {
    throw new LlmError("disabled", "LLM 未启用。");
  }
  if (!config.apiKey) {
    throw new LlmError("missing-key", "缺少 STRATEGY_OS_LLM_API_KEY。");
  }
  if (!config.model) {
    throw new LlmError("missing-model", "缺少 STRATEGY_OS_LLM_MODEL。");
  }
  if (typeof fetchImpl !== "function") {
    throw new LlmError("no-fetch", "当前环境不支持 fetch。");
  }

  const url = `${config.baseUrl}/chat/completions`;
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.4
  };

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`
  };

  let response;
  let timer;
  try {
    if (abortImpl) {
      const controller = new abortImpl();
      timer = setTimeout(() => controller.abort(), config.timeoutMs);
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } else {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    }
  } catch (error) {
    if (error && (error.name === "AbortError" || /aborted/i.test(String(error.message)))) {
      throw new LlmError("timeout", `LLM 请求超时（${config.timeoutMs}ms）。`);
    }
    throw new LlmError("network", "无法连接到 LLM 服务。");
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.text();
      if (errBody && errBody.length < 400) detail = errBody;
    } catch {
      // 忽略错误响应读取失败；只保留状态码。
    }
    throw new LlmError("http", `LLM 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new LlmError("parse", "LLM 响应不是合法 JSON。");
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const text = choice && choice.message && typeof choice.message.content === "string"
    ? choice.message.content.trim()
    : "";

  if (!text) {
    throw new LlmError("empty", "LLM 没有返回内容。");
  }

  return text;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  readConfig,
  isConfigured,
  callChatCompletion,
  LlmError
};