#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { askStrategyOsAsync } = require("./ask-strategy-os");

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
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("请求内容太大。"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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

function createAskUiServer({ rootDir = process.cwd(), publicDir = path.join(__dirname, "..", "public", "ask-ui") } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "POST" && url.pathname === "/api/ask") {
      try {
        const payload = JSON.parse((await readBody(req)) || "{}");
        const question = String(payload.question || "").trim();
        if (!question) {
          sendJson(res, 400, { error: "请输入问题。" });
          return;
        }
        const result = await askStrategyOsAsync({ rootDir, question });
        const responseBody = {
          type: result.type,
          answer: result.answer,
          source: result.source,
          llmEnabled: result.llmEnabled
        };
        if (result.warning) responseBody.warning = result.warning;
        sendJson(res, 200, responseBody);
      } catch (error) {
        const safeMessage = String(error.message || "回答生成失败，请检查终端日志或先运行 npm run today。").replace(
          /sk-[A-Za-z0-9_-]+/g,
          "[redacted]"
        );
        console.error(safeMessage);
        sendJson(res, 500, { error: safeMessage });
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
  closeAskUiServers
};
