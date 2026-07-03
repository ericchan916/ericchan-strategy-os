const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// V0.3.4-hotfix-2：
// - 顶部文件 prompts/ask-mode-system-prompt.md 应明确禁用"机械四段式"并允许"自适应回答"。
// - scripts/ask-strategy-os.js 中的 ASK_MODE_SYSTEM_PROMPT_FALLBACK 也应同步。

const ROOT = path.join(__dirname, "..");
const promptPath = path.join(ROOT, "prompts", "ask-mode-system-prompt.md");
const askScriptPath = path.join(ROOT, "scripts", "ask-strategy-os.js");
const promptText = fs.readFileSync(promptPath, "utf8");
const askScriptText = fs.readFileSync(askScriptPath, "utf8");

function extractFallbackPrompt(source) {
  // 提取 const ASK_MODE_SYSTEM_PROMPT_FALLBACK = "..."; 的内容。
  const match = source.match(/ASK_MODE_SYSTEM_PROMPT_FALLBACK\s*=\s*"([\s\S]*?)";/);
  if (!match) return "";
  // 把 \\n \\\\ \" \` 等转义回原始字符
  return match[1]
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, "`");
}

const fallbackText = extractFallbackPrompt(askScriptText);

test("system prompt 明确禁用固定四段式（不要每次都结论/理由/行动/今天不要做）", () => {
  // V0.3.4-hotfix-2 强制要求
  assert.ok(
    /不要每次.*结论.*理由.*行动.*今天不要做|不(是|应|要)每次.*输出.*结论|不要固定输出.*结论|不是模板填空|不要机械/.test(promptText),
    "system prompt 应明确禁止固定套用四段式"
  );
});

test("system prompt 包含自适应回答规则（不同问题类型应选择不同回答形式）", () => {
  // 必须出现至少 3 种"自然回答"场景中的 2 种
  const required = ["概念解释", "界面", "反馈", "比较", "为什么", "确认", "排查", "提示词", "闲聊", "自然回答"];
  const matched = required.filter((w) => promptText.includes(w));
  assert.ok(matched.length >= 2, `system prompt 应列出自适应回答场景；当前匹配 ${matched.join(",")}`);
});

test("system prompt 仍保留 Project Checkup / Kickoff Package 的结构化要求", () => {
  assert.ok(/项目体检|体检/.test(promptText), "system prompt 应保留项目体检结构化要求");
  assert.ok(/开工包|kickoff|开工/.test(promptText), "system prompt 应保留开工包结构化要求");
});

test("system prompt 不再强制必须输出今天不要做", () => {
  // 原版每次都说，今天不要做；新版应有条件才说。
  // 验收：不能含“必须每次写今天不要做”或类似强制语气。
  assert.ok(
    !/必须每次.*今天不要做|每天都要.*今天不要做|一定.*今天不要做/.test(promptText),
    "system prompt 不应强制每次都写今天不要做"
  );
});

test("system prompt 保留 reasoning 清洗与中文硬约束", () => {
  assert.ok(/think|分析|英文|reasoning/.test(promptText), "system prompt 应保留过滤 think/英文/推理的硬约束");
});

test("fallback prompt 同步包含自适应回答规则", () => {
  assert.ok(fallbackText.length > 0, "ASK_MODE_SYSTEM_PROMPT_FALLBACK 必须存在");
  assert.ok(
    /不要每次.*结论|不要机械|不是模板|不要固定|自然回答/.test(fallbackText),
    "fallback prompt 应同步包含自适应回答规则"
  );
});

test("fallback prompt 不再强制套用四段式", () => {
  assert.ok(
    !/必须每次.*今天不要做|每天都要.*今天不要做/.test(fallbackText),
    "fallback prompt 不应强制每次都写今天不要做"
  );
});

test("fallback prompt 仍然禁止输出 think / 英文推理", () => {
  assert.ok(/think|分析|reasoning/i.test(fallbackText), "fallback prompt 应包含 think/reasoning 屏蔽");
});
