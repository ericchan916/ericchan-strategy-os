# Coze Agent Tuner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small local CLI that stores separate model/effort preferences for Coze's Codex and Claude Code agents, applies the safe Codex settings, and safely reports Claude effort as not yet persistently writable unless a supported surface is verified.

**Architecture:** Use one dependency-free Node.js CLI plus one `node:test` test file. Keep all machine-specific paths injectable with `--home`/environment-style options in tests so the implementation can be verified with temporary directories instead of touching real Coze/Codex config during tests.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:assert/strict`, `node:fs`, `node:path`, existing `npm test`.

---

## File Structure

- Create: `scripts/coze-agent-tuner.js`
  - CLI entrypoint and all implementation helpers.
  - Exports helpers for tests.
  - Reads/writes JSON configs.
  - Updates simple top-level TOML keys without adding a TOML dependency.
- Create: `test/coze-agent-tuner.test.js`
  - Unit tests using temporary directories.
  - Covers status, set, apply, restore, validation, and output redaction.
- Modify: `package.json`
  - Add `coze:tuner` script.

This is intentionally small. Do not add a package, daemon, UI, database, or new dependency.

### Task 1: CLI Skeleton And Agent Discovery

**Files:**
- Create: `scripts/coze-agent-tuner.js`
- Create: `test/coze-agent-tuner.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for agent discovery and status output**

Create `test/coze-agent-tuner.test.js` with:

```js
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: FAIL because `../scripts/coze-agent-tuner` does not exist.

- [ ] **Step 3: Add the minimal CLI skeleton and discovery helpers**

Create `scripts/coze-agent-tuner.js` with:

```js
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

function run(argv, options = {}) {
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
```

- [ ] **Step 4: Add an npm script**

Modify `package.json` scripts section by adding:

```json
"coze:tuner": "node scripts/coze-agent-tuner.js"
```

Keep the surrounding script ordering stable.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: PASS for the two new tests.

- [ ] **Step 6: Commit**

Run:

```powershell
git add package.json scripts/coze-agent-tuner.js test/coze-agent-tuner.test.js
git commit -m "Add Coze agent tuner CLI skeleton"
```

### Task 2: Set Command And Validation

**Files:**
- Modify: `scripts/coze-agent-tuner.js`
- Modify: `test/coze-agent-tuner.test.js`

- [ ] **Step 1: Add failing tests for `set`**

Append to `test/coze-agent-tuner.test.js`:

```js
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
  assert.match(result.stderr, /Unsupported codex effort/);
  assert.equal(fs.existsSync(path.join(home, ".coze-agent-tuner", "config.json")), false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: FAIL because `set` is not implemented.

- [ ] **Step 3: Implement `set`**

Add these helpers in `scripts/coze-agent-tuner.js`:

```js
function saveTunerConfig(home, config) {
  writeJson(pathsFor(home).tunerConfig, config);
}

function normalizeFramework(value) {
  if (value === "claude") return "claude-code";
  if (value === "codex" || value === "claude-code") return value;
  throw new Error(`Unknown framework: ${value}`);
}

function setConfig(home, frameworkArg, model, effort) {
  const framework = normalizeFramework(frameworkArg);
  if (!model) throw new Error("Missing --model");
  if (!effort) throw new Error("Missing --effort");

  if (framework === "codex" && !CODEX_EFFORTS.has(effort)) {
    throw new Error(`Unsupported codex effort: ${effort}`);
  }
  if (framework === "claude-code" && !CLAUDE_EFFORTS.has(effort)) {
    throw new Error(`Unsupported claude effort: ${effort}`);
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
```

Update `run` to handle `set`:

```js
if (command === "set") {
  return {
    code: 0,
    stdout: setConfig(home, args._[1], args.model, args.effort),
    stderr: ""
  };
}
```

Export the new helpers:

```js
saveTunerConfig,
setConfig
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add scripts/coze-agent-tuner.js test/coze-agent-tuner.test.js
git commit -m "Add Coze agent tuner set command"
```

### Task 3: Codex Apply With Backups

**Files:**
- Modify: `scripts/coze-agent-tuner.js`
- Modify: `test/coze-agent-tuner.test.js`

- [ ] **Step 1: Add failing tests for Codex apply**

Append to `test/coze-agent-tuner.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: FAIL because `apply` is not implemented.

- [ ] **Step 3: Implement backup and TOML update helpers**

Add to `scripts/coze-agent-tuner.js`:

```js
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
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key} = ${quoteTomlString(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key} = ${quoteTomlString(value)}`);
  }
  return `${next.filter((line, index) => line !== "" || index < next.length - 1).join("\n")}\n`;
}
```

- [ ] **Step 4: Implement `apply`**

Add to `scripts/coze-agent-tuner.js`:

```js
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
```

Update `run`:

```js
if (command === "apply") {
  return { code: 0, stdout: applyConfig(home), stderr: "" };
}
```

Export:

```js
applyConfig,
setTopLevelTomlKeys
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/coze-agent-tuner.js test/coze-agent-tuner.test.js
git commit -m "Apply Coze Codex tuner settings"
```

### Task 4: Restore And Secret-Safe Output

**Files:**
- Modify: `scripts/coze-agent-tuner.js`
- Modify: `test/coze-agent-tuner.test.js`

- [ ] **Step 1: Add failing restore and output tests**

Append to `test/coze-agent-tuner.test.js`:

```js
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

test("command output never prints token-like fields from agent config", () => {
  const home = fixtureHome();
  tuner.run(["set", "claude", "--model", "opus", "--effort", "max", "--home", home]);
  const apply = tuner.run(["apply", "--home", home]);
  const status = tuner.run(["status", "--home", home]);

  assert.doesNotMatch(apply.stdout + apply.stderr, /sat_secret_should_not_print/);
  assert.doesNotMatch(status.stdout + status.stderr, /sat_secret_should_not_print/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: FAIL because `restore` is not implemented.

- [ ] **Step 3: Implement latest-backup restore**

Add to `scripts/coze-agent-tuner.js`:

```js
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
```

Update `run`:

```js
if (command === "restore") {
  return { code: 0, stdout: restoreLatest(home), stderr: "" };
}
```

Export:

```js
restoreLatest
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm test -- test/coze-agent-tuner.test.js
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/coze-agent-tuner.js test/coze-agent-tuner.test.js
git commit -m "Add Coze agent tuner restore"
```

### Task 5: Manual Dry Run Against Real Paths

**Files:**
- No code changes expected.

- [ ] **Step 1: Run status against the real home directory**

Run:

```powershell
npm run coze:tuner -- status
```

Expected:

- Exit code 0.
- Shows one `codex` agent and one `claude-code` agent.
- Does not print `patToken`, `sat_`, `bridge.token`, or any secret-like value.

- [ ] **Step 2: Run a tuner-only set for both frameworks**

Run:

```powershell
npm run coze:tuner -- set codex --model gpt-5.5 --effort high
npm run coze:tuner -- set claude --model opus --effort max
npm run coze:tuner -- status
```

Expected:

- Desired config shows Codex `gpt-5.5/high`.
- Desired config shows Claude `opus/max`.
- Coze agent config files are not changed until `apply`.

- [ ] **Step 3: Stop before real apply unless user explicitly approves**

Do not run:

```powershell
npm run coze:tuner -- apply
```

until the user confirms they want the real local Coze/Codex files changed.

- [ ] **Step 4: Commit any documentation note if needed**

If the dry run exposes a wording issue in command output, fix it and run:

```powershell
npm test -- test/coze-agent-tuner.test.js
git add scripts/coze-agent-tuner.js test/coze-agent-tuner.test.js
git commit -m "Clarify Coze agent tuner output"
```

If no changes are needed, skip this commit.

## Self-Review

- Spec coverage:
  - Separate Codex and Claude desired settings: Task 2.
  - Coze agent detection: Task 1.
  - Codex model and reasoning effort apply: Task 3.
  - Claude safe boundary: Task 3 output states effort is saved but not bridge-injected in v1.
  - Backups: Task 3.
  - Restore: Task 4.
  - Secret-safe output: Tasks 1 and 4.
  - No UI/daemon/dependency: file structure and architecture.
- Red-flag scan: no unfinished markers or implementation-free "add tests" steps are used.
- Type consistency: framework keys are `codex` and `claude-code`; user alias `claude` maps to `claude-code`; Codex desired effort field is `reasoning_effort`; Claude desired effort field is `effort`.
