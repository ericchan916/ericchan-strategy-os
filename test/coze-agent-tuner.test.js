const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tuner = require("../scripts/coze-agent-tuner");

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coze-agent-tuner-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fixtureHome() {
  const home = makeTempHome();
  writeJson(path.join(home, ".coze", "agents", "codex-agent", "config.json"), {
    agentId: "codex-agent",
    framework: "codex",
    workspace: "C:\\fake\\codex",
    model: "auto",
    patToken: "sat_secret_should_not_print"
  });
  writeJson(path.join(home, ".coze", "agents", "claude-agent", "config.json"), {
    agentId: "claude-agent",
    framework: "claude-code",
    workspace: "C:\\fake\\claude",
    model: "auto",
    patToken: "sat_secret_should_not_print"
  });
  return home;
}

test("detectAgents finds Codex and Claude agent configs without exposing tokens", () => {
  const home = fixtureHome();
  const agents = tuner.detectAgents(home);

  assert.equal(agents.codex.agentId, "codex-agent");
  assert.equal(agents["claude-code"].agentId, "claude-agent");
  assert.equal("patToken" in agents.codex, false);
  assert.equal("patToken" in agents["claude-code"], false);
});

test("status prints detected agents and desired config without token-like values", () => {
  const home = fixtureHome();
  const output = tuner.run(["status", "--home", home], { write: false });

  assert.equal(output.code, 0);
  assert.match(output.stdout, /codex-agent/);
  assert.match(output.stdout, /claude-agent/);
  assert.doesNotMatch(output.stdout, /sat_secret/);
});

test("status only prints safe desired config fields", () => {
  const home = fixtureHome();
  writeJson(path.join(home, ".coze-agent-tuner", "config.json"), {
    codex: {
      model: "gpt-5.5",
      reasoning_effort: "high",
      patToken: "sat_secret_should_not_print"
    },
    "claude-code": {
      model: "opus",
      effort: "max",
      sat_secret: "sat_secret_should_not_print"
    }
  });
  const output = tuner.run(["status", "--home", home]);

  assert.equal(output.code, 0);
  assert.match(output.stdout, /gpt-5\.5/);
  assert.match(output.stdout, /max/);
  assert.doesNotMatch(output.stdout, /sat_secret_should_not_print/);
});

test("status redacts token-like current and desired model values", () => {
  const home = fixtureHome();
  writeJson(path.join(home, ".coze", "agents", "codex-agent", "config.json"), {
    agentId: "codex-agent",
    framework: "codex",
    workspace: "C:\\fake\\codex",
    model: "sk_should_not_print"
  });
  writeJson(path.join(home, ".coze-agent-tuner", "config.json"), {
    codex: { model: "sat_should_not_print", reasoning_effort: "high" },
    "claude-code": { model: "auto", effort: "high" }
  });
  const output = tuner.run(["status", "--home", home]);

  assert.equal(output.code, 0);
  assert.match(output.stdout, /current model: \[redacted\]/);
  assert.match(output.stdout, /"model":"\[redacted\]"/);
  assert.doesNotMatch(output.stdout, /sk_should_not_print/);
  assert.doesNotMatch(output.stdout, /sat_should_not_print/);
});

test("status redacts sk-dash current and desired model values", () => {
  const home = fixtureHome();
  writeJson(path.join(home, ".coze", "agents", "codex-agent", "config.json"), {
    agentId: "codex-agent",
    framework: "codex",
    workspace: "C:\\fake\\codex",
    model: "sk-should-not-print"
  });
  writeJson(path.join(home, ".coze-agent-tuner", "config.json"), {
    codex: { model: "sk-should-not-print", reasoning_effort: "high" },
    "claude-code": { model: "auto", effort: "high" }
  });
  const output = tuner.run(["status", "--home", home]);

  assert.equal(output.code, 0);
  assert.match(output.stdout, /current model: \[redacted\]/);
  assert.match(output.stdout, /"model":"\[redacted\]"/);
  assert.doesNotMatch(output.stdout, /sk-should-not-print/);
});

test("set codex writes tuner-owned config only", () => {
  const home = fixtureHome();
  const result = tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "medium", "--home", home]);

  assert.equal(result.code, 0);
  const config = tuner.loadTunerConfig(home);
  assert.deepEqual(config.codex, { model: "gpt-5.5", reasoning_effort: "medium" });

  const agent = JSON.parse(fs.readFileSync(path.join(home, ".coze", "agents", "codex-agent", "config.json"), "utf8"));
  assert.equal(agent.model, "auto");
});

test("set claude writes tuner-owned config only", () => {
  const home = fixtureHome();
  const result = tuner.run(["set", "claude", "--model", "opus", "--effort", "max", "--home", home]);

  assert.equal(result.code, 0);
  const config = tuner.loadTunerConfig(home);
  assert.deepEqual(config["claude-code"], { model: "opus", effort: "max" });
});

test("set rejects unsupported effort without writing config", () => {
  const home = fixtureHome();
  const result = tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "max", "--home", home]);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "Unsupported codex effort\n");
  assert.equal(fs.existsSync(path.join(home, ".coze-agent-tuner", "config.json")), false);
});

test("set does not echo token-like invalid effort", () => {
  const home = fixtureHome();
  const tokenLike = "sat_secret_should_not_print";
  const result = tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", tokenLike, "--home", home]);

  assert.equal(result.code, 1);
  assert.equal(result.stderr, "Unsupported codex effort\n");
  assert.doesNotMatch(result.stderr, /sat_secret_should_not_print/);
  assert.equal(fs.existsSync(path.join(home, ".coze-agent-tuner", "config.json")), false);
});

test("apply updates Codex agent model and top-level Codex TOML keys with backup", () => {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), "model = \"old\"\nmodel_reasoning_effort = \"low\"\n", "utf8");

  tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "high", "--home", home]);
  const result = tuner.run(["apply", "--home", home]);

  assert.equal(result.code, 0);
  const codexAgent = JSON.parse(fs.readFileSync(path.join(home, ".coze", "agents", "codex-agent", "config.json"), "utf8"));
  assert.equal(codexAgent.model, "gpt-5.5");

  const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, /model = "gpt-5\.5"/);
  assert.match(toml, /model_reasoning_effort = "high"/);

  const backupRoot = path.join(home, ".coze-agent-tuner", "backups");
  const backupDirs = fs.readdirSync(backupRoot);
  assert.equal(backupDirs.length, 1);
});

test("apply creates Codex config if missing", () => {
  const home = fixtureHome();
  tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "medium", "--home", home]);
  const result = tuner.run(["apply", "--home", home]);

  assert.equal(result.code, 0);
  const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, /model = "gpt-5\.5"/);
  assert.match(toml, /model_reasoning_effort = "medium"/);
});

test("apply fails when agents root has no supported agents", () => {
  const home = makeTempHome();
  fs.mkdirSync(path.join(home, ".coze", "agents", "other-agent"), { recursive: true });
  writeJson(path.join(home, ".coze", "agents", "other-agent", "config.json"), {
    agentId: "other-agent",
    framework: "other",
    model: "auto"
  });

  const result = tuner.run(["apply", "--home", home]);

  assert.equal(result.code, 1);
  assert.doesNotMatch(result.stdout, /Applied: nothing/);
});

test("setTopLevelTomlKeys inserts top-level keys before tables without changing nested model", () => {
  const toml = tuner.setTopLevelTomlKeys("[profiles.default]\nmodel = \"nested-old\"\n", {
    model: "gpt-5.5",
    model_reasoning_effort: "high"
  });

  assert.match(toml, /^model = "gpt-5\.5"\nmodel_reasoning_effort = "high"\n\[profiles\.default\]\nmodel = "nested-old"\n$/);
});

test("setTopLevelTomlKeys updates indented top-level keys without duplicating them", () => {
  const toml = tuner.setTopLevelTomlKeys("  model = \"old\"\n", { model: "new" });

  assert.equal(toml, "model = \"new\"\n");
  assert.equal(toml.match(/^model\s=/gm).length, 1);
});

test("restore restores latest backup and resets tuner config to auto", () => {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), "model = \"old\"\nmodel_reasoning_effort = \"low\"\n", "utf8");

  tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "high", "--home", home]);
  tuner.run(["apply", "--home", home]);
  const result = tuner.run(["restore", "--home", home]);

  assert.equal(result.code, 0);
  const toml = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, /model = "old"/);
  assert.match(toml, /model_reasoning_effort = "low"/);
  assert.deepEqual(tuner.loadTunerConfig(home), tuner.defaultTunerConfig());
});

test("restore removes Codex config that apply created from missing", () => {
  const home = fixtureHome();
  const codexConfig = path.join(home, ".codex", "config.toml");

  tuner.run(["set", "codex", "--model", "gpt-5.5", "--effort", "high", "--home", home]);
  const apply = tuner.run(["apply", "--home", home]);

  assert.equal(apply.code, 0);
  assert.equal(fs.existsSync(codexConfig), true);
  const restore = tuner.run(["restore", "--home", home]);
  assert.equal(restore.code, 0);
  assert.equal(fs.existsSync(codexConfig), false);
});

test("command output never prints token-like fields from agent config", () => {
  const home = fixtureHome();
  tuner.run(["set", "claude", "--model", "opus", "--effort", "max", "--home", home]);
  const apply = tuner.run(["apply", "--home", home]);
  const status = tuner.run(["status", "--home", home]);

  assert.doesNotMatch(apply.stdout + apply.stderr, /sat_secret_should_not_print/);
  assert.doesNotMatch(status.stdout + status.stderr, /sat_secret_should_not_print/);
});
