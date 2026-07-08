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
