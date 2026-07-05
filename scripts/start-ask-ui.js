#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { askStrategyOsAsync, generateKickoffPackageForOpportunity, generateOpportunityDraft } = require("./ask-strategy-os");
const { redactSecretLikeText } = require("./secret-redact");
const {
  loadOpportunityPool,
  updateOpportunity,
  addOpportunity,
  deleteOpportunity,
  isValidOpportunityId,
  derivePrioritizedOpportunities
} = require("./opportunity-store");
require("./load-env"); // 静默补全 STRATEGY_OS_LLM_* / LLM_*；shell 优先。

const DEFAULT_PORT = 5177;
const ASSET_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(redactSecretLikeText(body)), "application/json; charset=utf-8");
}

function safeErrorMessage(error, fallback) {
  return String(redactSecretLikeText((error && error.message) || fallback || "请求失败。"));
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("请求内容太大。"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// V0.3.11-hotfix-3：草稿 API 响应白名单 - 丢弃 filePath / apiKey / rawAnswer 等敏感字段
const DRAFT_RESPONSE_FIELDS = [
  "opportunityName",
  "oneLineSummary",
  "note",
  "nextAction",
  "status",
  "type",
  "suggestedTags",
  "draftWarning",
  "sourceQuestion",
  "sourceAnswerSummary",
  "sourceUrls",
  "draftSource"
];
function pickDraftResponse(result) {
  const raw = result && typeof result === "object" ? result : {};
  const out = {};
  for (const key of DRAFT_RESPONSE_FIELDS) {
    if (key in raw) out[key] = raw[key];
  }
  // 防御：tags 必须是数组
  if (!Array.isArray(out.suggestedTags)) out.suggestedTags = [];
  // 防御：draftSource 必须是已知值
  if (!["llm", "local-rule", "fallback"].includes(out.draftSource)) out.draftSource = "fallback";
  return out;
}

function assetPathFor(urlPath, publicDir) {
  if (urlPath === "/" || urlPath === "/index.html") return path.join(publicDir, "index.html");
  if (urlPath === "/styles.css") return path.join(publicDir, "styles.css");
  if (urlPath === "/app.js") return path.join(publicDir, "app.js");
  return null;
}

function renderIndex(rootDir, publicDir) {
  const indexPath = path.join(publicDir, "index.html");
  const questionsPath = path.join(rootDir, "config", "recommended-questions.json");
  const questions = readJson(questionsPath, []);
  return fs.readFileSync(indexPath, "utf8").replace("__RECOMMENDED_QUESTIONS__", JSON.stringify(questions).replace(/</g, "\\u003c"));
}

function opportunityIdFromPath(urlPath) {
  const match = String(urlPath || "").match(/^\/api\/opportunities\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function createAskUiServer({ rootDir = process.cwd(), publicDir = path.join(__dirname, "..", "public", "ask-ui") } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/ask") {
      try {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const question = String(redactSecretLikeText(payload.question || "")).trim();
        if (!question) {
          sendJson(res, 400, { error: "请输入问题。" });
          return;
        }
        const result = await askStrategyOsAsync({
          rootDir,
          question,
          useSearch: payload.useSearch === true,
          currentGoal: redactSecretLikeText(payload.currentGoal || "")
        });
        const responseBody = {
          type: result.type,
          answer: result.answer,
          source: result.source,
          llmEnabled: result.llmEnabled,
          search: result.search
        };
        if (result.warning) responseBody.warning = result.warning;
        sendJson(res, 200, responseBody);
      } catch (error) {
        const safeMessage = safeErrorMessage(error, "回答生成失败，请检查终端日志或先运行 npm run today。");
        console.error(safeMessage);
        sendJson(res, 500, { error: safeMessage });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/opportunities") {
      try {
        const result = loadOpportunityPool({ rootDir });
        const currentGoal = String(redactSecretLikeText(url.searchParams.get("currentGoal") || "")).slice(0, 300);
        const opportunities = derivePrioritizedOpportunities(result.opportunities, currentGoal);
        sendJson(res, 200, { opportunities, stats: result.stats });
      } catch (error) {
        sendJson(res, 500, { error: safeErrorMessage(error, "机会池读取失败。") });
      }
      return;
    }

    // V0.3.10：POST /api/opportunities - 从 Ask Mode / 搜索 / 手动 一键加入机会
    // 安全约束：
    //  - 只接受白名单字段（addOpportunity 内部过滤）
    //  - 任何 filePath / jsonPath / markdownPath / rootDir / apiKey 都不被持久化
    //  - sourceUrls 截到 5 条，只保留 title / url / source
    //  - rawAnswer 不被持久化，只生成 sourceAnswerSummary
    //  - 重复标题给出中文 warning
    if (req.method === "POST" && url.pathname === "/api/opportunities") {
      try {
        const raw = redactSecretLikeText(JSON.parse((await readBody(req)) || "{}"));
        if (!raw || typeof raw !== "object") {
          sendJson(res, 400, { error: "请求体格式不合法。" });
          return;
        }
        const result = addOpportunity({ rootDir, input: raw });
        const body = {
          opportunity: result.opportunity,
          opportunities: result.opportunities,
          stats: result.stats
        };
        if (result.warning) body.warning = result.warning;
        sendJson(res, 200, body);
      } catch (error) {
        const status = error.statusCode || 400;
        const safeMessage = safeErrorMessage(error, "机会新增失败。");
        sendJson(res, status, { error: safeMessage });
      }
      return;
    }

    // V0.3.11-hotfix-3：智能草稿 API - LLM 优先 → 规则回退
    if (req.method === "POST" && url.pathname === "/api/opportunities/draft") {
      try {
        const raw = redactSecretLikeText(JSON.parse((await readBody(req, 200 * 1024)) || "{}"));
        if (!raw || typeof raw !== "object") {
          sendJson(res, 400, { error: "请求体格式不合法。" });
          return;
        }
        const question = String(raw.question || "").slice(0, 1000);
        const answer = String(raw.answer || "").slice(0, 4000);
        const search = raw.search && typeof raw.search === "object" ? raw.search : null;
        const currentGoal = String(raw.currentGoal || "").slice(0, 300);
        const result = await generateOpportunityDraft({
          question,
          answer,
          search,
          currentGoal,
          env: process.env
        });
        sendJson(res, 200, pickDraftResponse(result));
      } catch (error) {
        const status = error.statusCode || 400;
        const safeMessage = safeErrorMessage(error, "草稿生成失败。");
        sendJson(res, status, { error: safeMessage });
      }
      return;
    }

    if (req.method === "PATCH" && /^\/api\/opportunities\/[^/]+$/.test(url.pathname)) {
      try {
        const id = opportunityIdFromPath(url.pathname);
        const payload = redactSecretLikeText(JSON.parse((await readBody(req)) || "{}"));
        const result = updateOpportunity({ rootDir, id, patch: payload });
        sendJson(res, 200, { opportunity: result.opportunity, opportunities: result.opportunities, stats: result.stats });
      } catch (error) {
        const status = error.statusCode || 400;
        sendJson(res, status, { error: safeErrorMessage(error, "机会池保存失败。") });
      }
      return;
    }

    // V0.3.10-hotfix：DELETE /api/opportunities/:id - 从机会池移除一个机会
    // 安全约束：
    //  - id 必须是路径最后一段，不允许 .. 或路径分隔符（deleteOpportunity 内部校验）
    //  - 不接受 body / query 控制文件路径
    //  - 404 / 400 返回中文错误
    if (req.method === "DELETE" && /^\/api\/opportunities\/[^/]+$/.test(url.pathname)) {
      try {
        const id = opportunityIdFromPath(url.pathname);
        const result = deleteOpportunity({ rootDir, id });
        sendJson(res, 200, { removed: result.removed, opportunities: result.opportunities, stats: result.stats });
      } catch (error) {
        const status = error.statusCode || 400;
        sendJson(res, status, { error: safeErrorMessage(error, "机会删除失败。") });
      }
      return;
    }

    // V0.3.11：POST /api/opportunities/:id/kickoff - 从机会卡生成开工包
    // 安全约束：
    //  - id 必须是路径最后一段，不接受 .. / 路径分隔符（isValidOpportunityId 校验）
    //  - 不联网：默认 useSearch=false
    //  - 不调用真实 Codex / WorkBuddy / MiniMax
    //  - 不接受 body 控制 filePath / apiKey
    //  - 404 / 400 返回中文错误
    if (req.method === "POST" && /^\/api\/opportunities\/[^/]+\/kickoff$/.test(url.pathname)) {
      try {
        const id = opportunityIdFromPath(url.pathname.replace(/\/kickoff$/, ""));
        if (!isValidOpportunityId(id)) {
          sendJson(res, 400, { error: "请提供合法的机会 id（不能包含路径分隔符或控制字符）。" });
          return;
        }
        const loaded = loadOpportunityPool({ rootDir });
        const target = loaded.opportunities.find((o) => o.id === id);
        if (!target) {
          sendJson(res, 404, { error: "没有找到这个机会，可能已被删除。" });
          return;
        }
        const payload = redactSecretLikeText(JSON.parse((await readBody(req, 200 * 1024)) || "{}"));
        const result = await generateKickoffPackageForOpportunity({
          opportunity: target,
          env: process.env,
          currentGoal: payload.currentGoal
        });
        const body = {
          answer: result.answer,
          source: result.source,
          opportunity: target,
          warning: result.warning || null
        };
        if (result.warning) body.warning = result.warning;
        sendJson(res, 200, body);
      } catch (error) {
        const status = error.statusCode || 400;
        const safeMessage = safeErrorMessage(error, "开工包生成失败。");
        sendJson(res, status, { error: safeMessage });
      }
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "不支持这个请求方法。" });
      return;
    }

    const filePath = assetPathFor(url.pathname, publicDir);
    if (!filePath) {
      send(res, 404, "页面不存在。");
      return;
    }

    try {
      const body = path.basename(filePath) === "index.html" ? renderIndex(rootDir, publicDir) : fs.readFileSync(filePath, "utf8");
      send(res, 200, body, ASSET_TYPES[path.extname(filePath)] || "text/plain; charset=utf-8");
    } catch (error) {
      console.error(error.message);
      send(res, 500, "页面加载失败。");
    }
  });
}

function startAskUiServer({ rootDir = process.cwd(), port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  const server = createAskUiServer({ rootDir });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function startAskUiServers({ rootDir = process.cwd(), port = DEFAULT_PORT, hosts = ["127.0.0.1", "::1"] } = {}) {
  return new Promise((resolve, reject) => {
    const servers = [];
    let pending = hosts.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      for (const srv of servers) srv.off("error", reject);
      resolve({ servers, close: () => closeAskUiServers(servers) });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      for (const srv of servers) {
        srv.off("error", reject);
        try { srv.close(); } catch {}
      }
      reject(error);
    };

    for (const host of hosts) {
      const server = createAskUiServer({ rootDir }).listen(port, host, () => {
        pending -= 1;
        if (pending === 0) finish();
      });
      server.once("error", fail);
      servers.push(server);
    }
  });
}

function closeAskUiServers(servers) {
  return Promise.all(
    (servers || []).map(
      (server) =>
        new Promise((resolve) => {
          try {
            server.close(() => resolve());
          } catch {
            resolve();
          }
        })
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const portArgIndex = args.indexOf("--port");
  const port = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) : DEFAULT_PORT;
  const { servers, close } = await startAskUiServers({ port });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      close().finally(() => process.exit(0));
    });
  }
  console.log("本地战略OS界面已启动：");
  for (const server of servers) {
    const addr = server.address();
    console.log(`- http://${addr.family === "IPv6" ? `[${addr.address}]` : addr.address}:${addr.port}`);
  }
  console.log("（同时支持 IPv4 与 IPv6 loopback，不会暴露到局域网。）");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`本地战略OS界面启动失败：${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  createAskUiServer,
  startAskUiServer,
  startAskUiServers,
  closeAskUiServers,
  // V0.3.11-hotfix-3
  pickDraftResponse,
  safeErrorMessage,
  readBody
};
