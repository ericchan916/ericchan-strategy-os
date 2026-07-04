#!/usr/bin/env node

const { readSearchConfig, searchWeb } = require("./search-client");
require("./load-env");

function isPlaceholderKey(value) {
  const text = String(value || "").trim();
  return !text || /^(BOCHA_API_KEY_HERE|TAVILY_API_KEY_HERE|SEARCH_API_KEY_HERE)$/i.test(text);
}

function printConfig(config) {
  console.log("Search 配置诊断：");
  console.log(`enabled: ${config.enabled}`);
  console.log(`provider: ${config.provider || "(未配置)"}`);
  console.log(`apiKeyPresent: ${Boolean(config.apiKey)}`);
  console.log(`baseUrl: ${config.baseUrl || "(默认)"}`);
  console.log(`timeoutMs: ${config.timeoutMs}`);
  console.log(`maxResults: ${config.maxResults}`);
}

async function main() {
  const config = readSearchConfig(process.env);
  printConfig(config);

  if (!config.enabled) {
    console.log("status: disabled");
    return;
  }
  if (!config.provider) {
    console.log("status: missing-provider");
    return;
  }
  if (!config.apiKey) {
    console.log("status: missing-key");
    return;
  }
  if (isPlaceholderKey(config.apiKey)) {
    console.log("status: placeholder-key");
    return;
  }

  const result = await searchWeb({ query: "OpenAI latest news", env: process.env });
  if (result.warning) {
    console.log(`status: ${result.errorCode || "failed"}`);
    console.log(`warning: ${result.warning}`);
    return;
  }

  console.log("status: ok");
  console.log(`resultCount: ${result.results.length}`);
  for (const item of result.results.slice(0, 2)) {
    console.log(`- ${item.title}`);
    console.log(`  ${item.url}`);
    console.log(`  source: ${item.source || "(未知)"}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`search:check 失败：${String(error.message || error).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")}`);
    process.exitCode = 1;
  });
}

module.exports = { isPlaceholderKey };
