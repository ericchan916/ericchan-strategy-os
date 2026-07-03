#!/usr/bin/env node

// Ask Mode 专用 LLM 客户端：仅读取 STRATEGY_OS_LLM_* 命名空间，不读 .env，
// 不输出 / 不返回 API Key。返回纯文本 answer 或抛出可控错误。
//
// 健壮性：
// - baseUrl 兼容三种写法：
//   1) https://host/v1            → https://host/v1/chat/completions
//   2) https://host/v1/           → https://host/v1/chat/completions
//   3) https://host/v1/chat/completions  → 不重复拼接
// - HTTP 错误按状态码细分：401 / 403 / 404 / 429 / 5xx，方便诊断。
// - 响应解析兼容 choices[0].message.content 与 choices[0].text。
// - 错误信息统一脱敏 sk- 模式，绝不输出 API Key。

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const KEY_REDACT_RE = /sk-[A-Za-z0-9_-]+/g;

function redactKey(value) {
  return String(value || "").replace(KEY_REDACT_RE, "[redacted]");
}

// 把用户配置的 baseUrl 规整成 "host + /v1" 这种根 URL：
// - 去尾斜杠
// - 若以 /chat/completions 结尾，再剥掉这一段
function normalizeBaseUrl(input) {
  let value = String(input || "").trim();
  if (!value) return DEFAULT_BASE_URL;
  value = value.replace(/\/+$/, "");
  if (/\/chat\/completions\/?$/.test(value)) {
    value = value.replace(/\/chat\/completions\/?$/, "");
    value = value.replace(/\/+$/, "");
  }
  return value || DEFAULT_BASE_URL;
}

function readConfig(env = process.env) {
  const enabled = String(env.STRATEGY_OS_LLM_ENABLED || "false").toLowerCase() === "true";
  const apiKey = String(env.STRATEGY_OS_LLM_API_KEY || "").trim();
  const rawBaseUrl = String(env.STRATEGY_OS_LLM_BASE_URL || DEFAULT_BASE_URL).trim();
  const model = String(env.STRATEGY_OS_LLM_MODEL || "").trim();
  const timeoutMs = Number(env.STRATEGY_OS_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    enabled,
    apiKey,
    baseUrl: normalizeBaseUrl(rawBaseUrl),
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

// 把网络层抛出的错误归类成 network，并把诊断信息透出，但不泄露 key。
function classifyNetworkError(error) {
  const code = error && error.code ? String(error.code) : "";
  if (code === "ENOTFOUND") return new LlmError("network", "无法解析 LLM 服务的域名，请检查 baseUrl 或网络 DNS。");
  if (code === "ECONNREFUSED") return new LlmError("network", "LLM 服务拒绝连接，请检查 baseUrl 与端口是否可达。");
  if (code === "ECONNRESET") return new LlmError("network", "LLM 服务连接被重置，请稍后重试。");
  if (code === "EAI_AGAIN") return new LlmError("network", "DNS 临时不可用，请稍后重试。");
  if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return new LlmError("network", "TLS 证书校验失败，请检查 baseUrl 或代理。");
  }
  return new LlmError("network", "无法连接到 LLM 服务，请检查 baseUrl、代理或网络。");
}

// 把 HTTP 非 2xx 响应归类成可读的中文错误。
function classifyHttpError(status, baseUrl) {
  if (status === 401) {
    return new LlmError("unauthorized", "请检查 API Key（HTTP 401）。");
  }
  if (status === 403) {
    return new LlmError("forbidden", "API Key 无权访问该模型或服务（HTTP 403）。");
  }
  if (status === 404) {
    return new LlmError("not-found", `无法找到 chat/completions 端点（HTTP 404）。请检查 baseUrl（当前：${baseUrl}）与模型名。`);
  }
  if (status === 429) {
    return new LlmError("rate-limited", "请求被限流（HTTP 429），请稍后重试或降低请求频率。");
  }
  if (status >= 500 && status < 600) {
    return new LlmError("server-error", `LLM 服务暂时不可用（HTTP ${status}）。`);
  }
  return new LlmError("http", `LLM 请求失败（HTTP ${status}）。`);
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

  // 防御性归一化：即使调用方绕开 readConfig 直接传入 config.baseUrl，
  // 也不重复拼接 /chat/completions。
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const url = `${normalizedBaseUrl}/chat/completions`;
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
      throw new LlmError("timeout", `LLM 请求超时（${config.timeoutMs}ms），请检查接口速度或代理。`);
    }
    throw classifyNetworkError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response) {
    throw new LlmError("network", "LLM 响应为空。");
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.text();
      if (errBody) {
        // 错误响应里如果含 sk-* 形式的内容，统一脱敏。
        const safe = redactKey(errBody).slice(0, 400);
        if (safe) detail = `：${safe}`;
      }
    } catch {
      // 忽略错误响应读取失败。
    }
    const classified = classifyHttpError(response.status, normalizedBaseUrl);
    classified.message = `${classified.message}${detail}`;
    throw classified;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new LlmError("parse", "LLM 响应不是合法 JSON。");
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  let text = "";
  if (choice) {
    if (choice.message && typeof choice.message.content === "string") {
      text = choice.message.content;
    } else if (typeof choice.text === "string") {
      // 兼容老式 /completions 端点返回 choices[0].text。
      text = choice.text;
    }
  }
  text = String(text || "").trim();

  if (!text) {
    throw new LlmError("empty", "LLM 没有返回内容。");
  }

  return text;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BASE_URL,
  KEY_REDACT_RE,
  redactKey,
  normalizeBaseUrl,
  readConfig,
  isConfigured,
  callChatCompletion,
  LlmError
};
