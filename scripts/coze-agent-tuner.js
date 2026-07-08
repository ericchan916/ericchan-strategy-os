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

function status(home) {
  const agents = detectAgents(home);
  const config = loadTunerConfig(home);
  const lines = ["Coze Agent Tuner status:"];
  for (const framework of ["codex", "claude-code"]) {
    const agent = agents[framework];
    const desired = config[framework];
    lines.push(`- ${framework}: ${agent ? agent.agentId : "not detected"}`);
    lines.push(`  current model: ${agent ? agent.model : "unknown"}`);
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
  defaultTunerConfig,
  detectAgents,
  loadTunerConfig,
  pathsFor,
  run
};
