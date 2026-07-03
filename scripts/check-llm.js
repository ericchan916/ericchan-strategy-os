#!/usr/bin/env node

// LLM 连接诊断脚本：
// - 读取当前 STRATEGY_OS_LLM_* 配置并打印安全诊断信息（不输出 key 内容）。
// - 发起一次最小 LLM 请求（system + "只回复：OK"）。
// - 按状态码或网络错误分类输出结果。
// - 全程不输出 API Key；脚本不修改任何项目数据。

const path = require("node:path");
const { readConfig, isConfigured, callChatCompletion, LlmError, redactKey } = require("./llm-client");
const { loadDotenv } = require("./load-env");

// 始终只把 key 是否存在打印成 true/false；不打印 key 内容。
function buildDiagnostics(env = process.env) {
  const cfg = readConfig(env);
  return {
    enabled: cfg.enabled,
    apiKeyPresent: Boolean(cfg.apiKey),
    modelPresent: Boolean(cfg.model),
    baseUrl: cfg.baseUrl,
    requestUrl: `${cfg.baseUrl}/chat/completions`,
    timeoutMs: cfg.timeoutMs
  };
}

// 给 main 用的打印：把对象里所有"应该脱敏"的字段（这里没有，但保留 redaction 通道）做一遍处理。
function safeForPrint(value) {
  return redactKey(value);
}

// 分类码 → 中文摘要。
function summarize(status, error) {
  switch (status) {
    case "success":
      return "LLM 连接成功。";
    case "disabled":
      return "Ask Mode LLM 未启用（STRATEGY_OS_LLM_ENABLED != true）。";
    case "missing-key":
      return "缺少 STRATEGY_OS_LLM_API_KEY。";
    case "missing-model":
      return "缺少 STRATEGY_OS_LLM_MODEL。";
    case "unauthorized":
      return "请检查 API Key（HTTP 401）。";
    case "forbidden":
      return "API Key 无权访问（HTTP 403）。";
    case "not-found":
      return `无法找到 chat/completions 端点（HTTP 404）。请检查 baseUrl。${error ? `（${safeForPrint(error.message)}）` : ""}`;
    case "rate-limited":
      return "请求被限流（HTTP 429），请稍后重试。";
    case "server-error":
      return "LLM 服务暂时不可用（HTTP 5xx）。";
    case "network":
      return `无法连接到 LLM 服务。${error ? `（${safeForPrint(error.message)}）` : ""}`;
    case "timeout":
      return `LLM 请求超时。${error ? `（${safeForPrint(error.message)}）` : ""}`;
    case "parse":
      return "LLM 响应不是合法 JSON。";
    case "empty":
      return "LLM 没有返回内容。";
    case "no-fetch":
      return "当前环境不支持 fetch。";
    default:
      return `未知状态：${status}${error ? `（${safeForPrint(error.message)}）` : ""}`;
  }
}

// 实际执行一次诊断调用。
//   opts.env          注入测试 env；默认 process.env
//   opts.fetchImpl    注入测试 fetch；默认 globalThis.fetch
//   opts.abortImpl    注入测试 AbortController；默认 globalThis.AbortController
async function runDiagnostic({ env = process.env, fetchImpl = globalThis.fetch, abortImpl = globalThis.AbortController } = {}) {
  const cfg = readConfig(env);

  if (!cfg.enabled) return { status: "disabled", summary: summarize("disabled") };
  if (!isConfigured(cfg)) {
    if (!cfg.apiKey) return { status: "missing-key", summary: summarize("missing-key") };
    if (!cfg.model) return { status: "missing-model", summary: summarize("missing-model") };
  }

  let error;
  try {
    const text = await callChatCompletion({
      config: cfg,
      systemPrompt: "你是诊断脚本。请严格只回复一个词：OK。",
      userPrompt: "只回复：OK",
      fetchImpl,
      abortImpl
    });
    return { status: "success", summary: `LLM 连接成功（响应：${safeForPrint(text.slice(0, 60))}）` };
  } catch (caught) {
    error = caught;
  }

  if (error instanceof LlmError) {
    return { status: error.code, error, summary: summarize(error.code, error) };
  }
  return { status: "unknown", error, summary: summarize("unknown", error) };
}

function printDiagnostics(diag) {
  console.log("Ask Mode LLM 诊断：");
  console.log(`- enabled         : ${diag.enabled}`);
  console.log(`- apiKey          : ${diag.apiKeyPresent ? "已配置（内容已脱敏）" : "未配置"}`);
  console.log(`- model           : ${diag.modelPresent ? "已配置" : "未配置"}`);
  console.log(`- baseUrl         : ${diag.baseUrl}`);
  console.log(`- requestUrl      : ${diag.requestUrl}`);
  console.log(`- timeoutMs       : ${diag.timeoutMs}`);
}

function printResult(result) {
  console.log("");
  console.log("诊断结果：");
  console.log(`- status : ${result.status}`);
  if (result.summary) console.log(`- message: ${safeForPrint(result.summary)}`);
  else if (result.error) console.log(`- message: ${summarize(result.status, result.error)}`);
  else console.log(`- message: ${summarize(result.status)}`);
}

async function main() {
  // CLI 入口时主动加载 .env（静默）。
  loadDotenv({ silent: true });
  const diag = buildDiagnostics(process.env);
  printDiagnostics(diag);
  const result = await runDiagnostic();
  printResult(result);

  if (result.status !== "success") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[check-llm] 诊断失败：${safeForPrint(error.message)}`);
    process.exit(1);
  });
}

module.exports = {
  buildDiagnostics,
  runDiagnostic,
  summarize,
  printDiagnostics,
  printResult,
  redactKey
};
