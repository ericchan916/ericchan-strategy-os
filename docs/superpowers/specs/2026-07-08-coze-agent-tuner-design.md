# Coze Agent Tuner Design

## Goal

Build a small local configuration controller that lets the user set separate model and reasoning-effort defaults for Coze's local Codex agent and local Claude Code agent.

The tool should not replace Coze, proxy conversations, or modify Coze's application binary. It should only manage local configuration and make the active Coze bridge use the selected defaults on future agent starts.

## Current Local Shape

Observed local paths and processes:

- Coze bridge daemon: `C:\Users\Administrator\.coze\bridge\lib\index.js --daemon`
- Coze bridge config: `C:\Users\Administrator\.coze\bridge\config.json`
- Coze agent configs: `C:\Users\Administrator\.coze\agents\<agentId>\config.json`
- Codex framework agent: `framework = "codex"`
- Claude framework agent: `framework = "claude-code"`
- Codex ACP package: `@zed-industries/codex-acp`
- Claude executable: `C:\Users\Administrator\.local\bin\claude.exe`

Useful knobs already confirmed:

- Codex CLI and ACP accept `-c key=value` overrides.
- Codex config uses `model` and `model_reasoning_effort`.
- Claude CLI supports `--model <model>` and `--effort low|medium|high|xhigh|max`.
- Coze agent config currently stores `model: "auto"`.

## Non-Goals

- No web UI in the first version.
- No tray app.
- No current-session hot switching.
- No token reading, printing, or rewriting except preserving existing config fields while updating safe settings.
- No Coze binary patching.
- No custom chat client.
- No model catalog auto-discovery in the first version.

## User-Facing Commands

The first version exposes a command line tool named `coze-agent-tuner`.

```powershell
coze-agent-tuner status
coze-agent-tuner set codex --model gpt-5.5 --effort high
coze-agent-tuner set claude --model opus --effort max
coze-agent-tuner apply
coze-agent-tuner restore
```

`status` prints detected agents and the desired tuner configuration.

`set` updates the tuner-owned desired config file only.

`apply` writes the desired values into the relevant local config or startup override surface and creates backups first.

`restore` restores backed-up config where possible and resets tuner config to auto.

## Tuner Config

Store tuner-owned state at:

`C:\Users\Administrator\.coze-agent-tuner\config.json`

Initial shape:

```json
{
  "codex": {
    "model": "auto",
    "reasoning_effort": "high"
  },
  "claude-code": {
    "model": "auto",
    "effort": "high"
  }
}
```

Allowed effort values:

- Codex: `minimal`, `low`, `medium`, `high`
- Claude: `low`, `medium`, `high`, `xhigh`, `max`

If an unsupported value is provided, the tool exits without writing changes.

## Apply Strategy

### Codex

Preferred first-version behavior:

1. Locate the Coze Codex agent by scanning `C:\Users\Administrator\.coze\agents\*\config.json` for `framework = "codex"`.
2. Preserve the full JSON object.
3. Set the safe top-level model field to the requested model, or `auto`.
4. Ensure Codex's effective config includes:
   - `model = "<selected model>"`
   - `model_reasoning_effort = "<selected effort>"`

The first implementation should prefer standard user Codex config if that is what `codex-acp` reads reliably:

`C:\Users\Administrator\.codex\config.toml`

This is the smallest working surface because Codex ACP help states it loads config from `~/.codex/config.toml` and accepts `-c` overrides.

### Claude

Preferred first-version behavior:

1. Locate the Coze Claude agent by scanning `C:\Users\Administrator\.coze\agents\*\config.json` for `framework = "claude-code"`.
2. Preserve the full JSON object.
3. Set the safe top-level model field to the requested model, or `auto`.
4. Apply Claude defaults through the least invasive supported surface:
   - a Claude settings file if it supports persistent model and effort defaults, or
   - a bridge startup override if Coze bridge exposes one.

If neither persistent surface is available after implementation-time verification, version 1 should report that Claude can be detected but cannot be safely applied yet, while still supporting Codex. It should not patch minified bridge code as the default path.

## Backups

Before any write, create timestamped backups under:

`C:\Users\Administrator\.coze-agent-tuner\backups\YYYYMMDD-HHMMSS\`

Back up only files that are about to be modified.

Never back up or print token files such as:

- `bridge.token`
- `pat-token`
- `.env`

Agent config files may contain token fields. The tool may copy the file as a backup, but command output must never print token values.

## Restart Behavior

First version does not kill or restart Coze automatically by default.

After `apply`, print:

- what was changed,
- which agent needs restart,
- a reminder to restart Coze or the Coze bridge.

Add an optional later flag only if needed:

```powershell
coze-agent-tuner apply --restart-bridge
```

This flag is not part of version 1 unless manual restart proves too annoying.

## Error Handling

The tool should fail closed:

- If no Coze agent root exists, print a clear message and exit non-zero.
- If no target framework is detected, print what was scanned and exit non-zero.
- If a config file has invalid JSON/TOML, do not rewrite it.
- If an apply target is ambiguous, ask the user to choose a specific agent ID in a later version. Version 1 may refuse ambiguous writes.
- If Claude persistence cannot be verified, do not guess.

## Verification

Minimum checks before claiming version 1 works:

1. `status` detects both local agents.
2. `set codex` and `set claude` update only tuner-owned config.
3. `apply` creates a backup before writing.
4. `apply` updates Codex's effective model and effort settings.
5. `restore` returns changed files to the previous state.
6. Token-like values are never printed to stdout.

## First Implementation Plan Boundary

Version 1 should be a small Node.js or PowerShell CLI with no extra runtime service. Use Node.js if JSON/TOML parsing and command packaging are easier in the existing machine setup; use PowerShell only if it keeps the implementation smaller and reliable.

Do not add a database, web server, background daemon, or plugin system.
