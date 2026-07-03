#!/usr/bin/env node

// 安全 .env 加载器：
// - 仅在 Node 后端入口调用（scripts/ask-strategy-os.js / scripts/start-ask-ui.js）。
// - 不输出 .env 内容，不输出 API Key。
// - shell 环境变量优先，.env 只补缺失项（dotenv 默认 override=false）。
// - 静默失败：缺 .env 或解析错误都不影响主流程。
// - 仅补 Ask Mode (STRATEGY_OS_LLM_*) 与 Report (LLM_*) 相关变量，不随意覆盖其他 env。

const fs = require("node:fs");
const path = require("node:path");

const SAFE_KEY_PREFIXES = ["STRATEGY_OS_LLM_", "LLM_"];

function loadDotenv({ rootDir = process.cwd(), env = process.env, silent = false, logger = console } = {}) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return { loaded: false, reason: "missing", path: envPath };
  }

  let parsed;
  try {
    parsed = require("dotenv").config({ path: envPath, override: false });
  } catch (error) {
    if (!silent) {
      logger.warn(`[load-env] 无法解析 .env：${error.message}`);
    }
    return { loaded: false, reason: "parse-error", path: envPath };
  }

  if (parsed && parsed.error) {
    if (!silent) {
      logger.warn(`[load-env] 无法加载 .env：${parsed.error.message}`);
    }
    return { loaded: false, reason: "dotenv-error", path: envPath };
  }

  let filled = 0;
  if (parsed && parsed.parsed) {
    for (const [key, value] of Object.entries(parsed.parsed)) {
      if (!SAFE_KEY_PREFIXES.some((prefix) => key === prefix.slice(0, -1) || key.startsWith(prefix))) {
        // 跳过不在白名单前缀的变量，避免污染 env。
        continue;
      }
      if (env[key] === undefined || env[key] === "") {
        env[key] = String(value);
        filled += 1;
      }
    }
  }

  if (!silent && filled > 0) {
    logger.log(`[load-env] .env 已补全 ${filled} 个变量（shell 优先）。`);
  }
  return { loaded: true, filled, path: envPath };
}

// 自动执行：被 require 时静默加载；显式调用时可传 silent=false 看提示。
if (require.main !== module) {
  loadDotenv({ silent: true });
}

module.exports = {
  loadDotenv,
  SAFE_KEY_PREFIXES
};