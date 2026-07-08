#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CODEX_EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const CLAUDE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function pathsFor(home = os.homedir()) {
  return {
    home,
    cozeAgentsRoot: path.join(home, ".coze", "agents"),
    tunerRoot: path.join(home, ".coze-agent-tuner"),
    tunerConfig: path.join(home, ".coze-agent-tuner", "config.json"),
    codexConfig: path.join(home, ".codex", "config.toml")
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function defaultTunerConfig() {
  return {
    codex: { model: "auto", reasoning_effort: "high" },
    "claude-code": { model: "auto", effort: "high" }
  };
}

function loadTunerConfig(home) {
  const paths = pathsFor(home);
  if (!fs.existsSync(paths.tunerConfig)) return defaultTunerConfig();
  return { ...defaultTunerConfig(), ...readJson(paths.tunerConfig) };
}

function saveTunerConfig(home, config) {
  writeJson(pathsFor(home).tunerConfig, config);
}

function detectAgents(home) {
  const paths = pathsFor(home);
  if (!fs.existsSync(paths.cozeAgentsRoot)) {
    throw new Error(`Coze agents root not found: ${paths.cozeAgentsRoot}`);
  }

  const found = {};
  for (const name of fs.readdirSync(paths.cozeAgentsRoot)) {
    const configFile = path.join(paths.cozeAgentsRoot, name, "config.json");
    if (!fs.existsSync(configFile)) continue;
    const raw = readJson(configFile);
    if (raw.framework !== "codex" && raw.framework !== "claude-code") continue;
    if (found[raw.framework]) throw new Error(`Multiple ${raw.framework} agents found`);
    found[raw.framework] = {
      agentId: raw.agentId || name,
      framework: raw.framework,
      model: raw.model || "auto",
      configFile
    };
  }
  return found;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = argv[i + 1];
      i += 1;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function redactDisplayValue(value) {
  if (typeof value === "string" && /^(sk|sat)_[A-Za-z0-9_=-]+/.test(value)) return "[redacted]";
  return value;
}

function safeDesiredConfig(framework, desired) {
  if (framework === "codex") {
    return {
      model: redactDisplayValue(desired.model),
      reasoning_effort: desired.reasoning_effort
    };
  }
  return {
    model: redactDisplayValue(desired.model),
    effort: desired.effort
  };
}

function normalizeFramework(value) {
  if (value === "claude") return "claude-code";
  if (value === "codex" || value === "claude-code") return value;
  throw new Error("Unknown framework");
}

function setConfig(home, frameworkArg, model, effort) {
  const framework = normalizeFramework(frameworkArg);
  if (!model) throw new Error("Missing --model");
  if (!effort) throw new Error("Missing --effort");

  if (framework === "codex" && !CODEX_EFFORTS.has(effort)) {
    throw new Error("Unsupported codex effort");
  }
  if (framework === "claude-code" && !CLAUDE_EFFORTS.has(effort)) {
    throw new Error("Unsupported claude effort");
  }

  const config = loadTunerConfig(home);
  if (framework === "codex") {
    config.codex = { model, reasoning_effort: effort };
  } else {
    config["claude-code"] = { model, effort };
  }
  saveTunerConfig(home, config);
  return `Saved ${framework} defaults.\n`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function backupFile(home, file, backupDir) {
  if (!fs.existsSync(file)) return;
  const relative = path.relative(home, file);
  const target = path.join(backupDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}

function quoteTomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setTopLevelTomlKeys(content, updates) {
  const lines = content ? content.split(/\r?\n/) : [];
  const tableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const topLines = tableIndex === -1 ? lines : lines.slice(0, tableIndex);
  const restLines = tableIndex === -1 ? [] : lines.slice(tableIndex);
  const seen = new Set();
  const next = topLines.map((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key} = ${quoteTomlString(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key} = ${quoteTomlString(value)}`);
  }
  const updated = next.concat(restLines).filter((line, index, all) => line !== "" || index < all.length - 1);
  return `${updated.join("\n")}\n`;
}

function updateAgentModel(agent, model) {
  const raw = readJson(agent.configFile);
  raw.model = model;
  writeJson(agent.configFile, raw);
}

function applyConfig(home) {
  const paths = pathsFor(home);
  const agents = detectAgents(home);
  const config = loadTunerConfig(home);
  const backupDir = path.join(paths.tunerRoot, "backups", timestamp());
  const changed = [];

  if (agents.codex) {
    backupFile(home, agents.codex.configFile, backupDir);
    backupFile(home, paths.codexConfig, backupDir);
    updateAgentModel(agents.codex, config.codex.model);

    const existing = fs.existsSync(paths.codexConfig) ? fs.readFileSync(paths.codexConfig, "utf8") : "";
    const updated = setTopLevelTomlKeys(existing, {
      model: config.codex.model,
      model_reasoning_effort: config.codex.reasoning_effort
    });
    fs.mkdirSync(path.dirname(paths.codexConfig), { recursive: true });
    fs.writeFileSync(paths.codexConfig, updated, "utf8");
    changed.push("codex");
  }

  if (agents["claude-code"]) {
    backupFile(home, agents["claude-code"].configFile, backupDir);
    updateAgentModel(agents["claude-code"], config["claude-code"].model);
    changed.push("claude-code model");
  }

  return [
    `Applied: ${changed.join(", ") || "nothing"}`,
    "Claude effort was saved in tuner config but not injected into bridge startup in v1.",
    "Restart Coze or the Coze bridge for new agent starts to pick up changed defaults.",
    ""
  ].join("\n");
}

function copyTree(source, target) {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dst = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dst);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
}

function restoreLatest(home) {
  const paths = pathsFor(home);
  const backupsRoot = path.join(paths.tunerRoot, "backups");
  if (!fs.existsSync(backupsRoot)) throw new Error("No backups found");
  const backups = fs.readdirSync(backupsRoot).sort();
  const latest = backups[backups.length - 1];
  if (!latest) throw new Error("No backups found");

  copyTree(path.join(backupsRoot, latest), home);
  saveTunerConfig(home, defaultTunerConfig());
  return `Restored backup ${latest} and reset tuner config to auto.\n`;
}

function status(home) {
  const agents = detectAgents(home);
  const config = loadTunerConfig(home);
  const lines = ["Coze Agent Tuner status:"];
  for (const framework of ["codex", "claude-code"]) {
    const agent = agents[framework];
    const desired = safeDesiredConfig(framework, config[framework]);
    lines.push(`- ${framework}: ${agent ? agent.agentId : "not detected"}`);
    lines.push(`  current model: ${agent ? redactDisplayValue(agent.model) : "unknown"}`);
    lines.push(`  desired: ${JSON.stringify(desired)}`);
  }
  return `${lines.join("\n")}\n`;
}

function run(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  const home = args.home || os.homedir();
  try {
    if (command === "status") {
      return { code: 0, stdout: status(home), stderr: "" };
    }
    if (command === "set") {
      return {
        code: 0,
        stdout: setConfig(home, args._[1], args.model, args.effort),
        stderr: ""
      };
    }
    if (command === "apply") {
      return { code: 0, stdout: applyConfig(home), stderr: "" };
    }
    if (command === "restore") {
      return { code: 0, stdout: restoreLatest(home), stderr: "" };
    }
    return { code: 1, stdout: "", stderr: `Unknown command: ${command || ""}\n` };
  } catch (error) {
    return { code: 1, stdout: "", stderr: `${error.message}\n` };
  }
}

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

module.exports = {
  CODEX_EFFORTS,
  CLAUDE_EFFORTS,
  applyConfig,
  copyTree,
  defaultTunerConfig,
  detectAgents,
  loadTunerConfig,
  restoreLatest,
  saveTunerConfig,
  pathsFor,
  run,
  setTopLevelTomlKeys,
  setConfig
};
