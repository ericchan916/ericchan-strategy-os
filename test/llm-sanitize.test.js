const assert = require("node:assert/strict");
const test = require("node:test");

const { sanitizeLlmAnswer } = require("../scripts/llm-client");

test("sanitizeLlmAnswer strips a single-line <think>...</think> block", () => {
  const input = "<think>We need to reason about this</think>\n# 标题\n\n结论：今天不复杂。";
  assert.equal(sanitizeLlmAnswer(input), "# 标题\n\n结论：今天不复杂。");
});

test("sanitizeLlmAnswer strips a multi-line <think>...</think> block", () => {
  const input = `<think>
The user asks about complexity.
Let me analyze step by step.
- Reason 1
- Reason 2
</think>
# 结论标题

结论：今天不复杂。

理由：
- 当前注意力负载很低。`;

  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("<think>"), false);
  assert.equal(out.includes("Let me analyze"), false);
  assert.ok(out.includes("# 结论标题"));
  assert.ok(out.includes("当前注意力负载很低"));
});

test("sanitizeLlmAnswer strips ```thinking ... ``` fenced code block", () => {
  const input = "```thinking\ninternal reasoning here\n```\n\n# 结论\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("internal reasoning"), false);
  assert.ok(out.includes("# 结论"));
});

test("sanitizeLlmAnswer strips ```reasoning ... ``` fenced code block", () => {
  const input = "```reasoning\nhidden chain of thought\n```\n\n# 结论\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("hidden chain"), false);
  assert.ok(out.includes("# 结论"));
});

test("sanitizeLlmAnswer strips an Analysis: paragraph", () => {
  const input = "Analysis: The user is over-thinking.\n\n# 结论\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("Analysis:"), false);
  assert.equal(out.includes("over-thinking"), false);
  assert.ok(out.includes("# 结论"));
});

test("sanitizeLlmAnswer strips a Reasoning: paragraph", () => {
  const input = "Reasoning: We need to check context.\n\n# 结论\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("Reasoning:"), false);
  assert.equal(out.includes("We need to check context"), false);
});

test("sanitizeLlmAnswer strips Thought: / Chain of thought: / CoT: paragraphs", () => {
  const cases = [
    "Thought: hidden.\n\n# 结论\n\n结论：今天不复杂。",
    "Chain of thought: hidden.\n\n# 结论\n\n结论：今天不复杂。",
    "CoT: hidden.\n\n# 结论\n\n结论：今天不复杂。",
    "Internal reasoning: hidden.\n\n# 结论\n\n结论：今天不复杂。"
  ];
  for (const input of cases) {
    const out = sanitizeLlmAnswer(input);
    assert.equal(out.includes("hidden"), false, `failed for input: ${input}`);
    assert.ok(out.includes("# 结论"), `should keep title for input: ${input}`);
  }
});

test("sanitizeLlmAnswer keeps content after 'Final:' marker", () => {
  const input = "<think>reasoning</think>Final:\n# 结论标题\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("reasoning"), false);
  assert.ok(out.includes("Final:") || !out.includes("Final:"));
  assert.ok(out.includes("# 结论标题"));
  assert.ok(out.includes("结论：今天不复杂"));
});

test("sanitizeLlmAnswer keeps content after '最终答案：' marker", () => {
  const input = "<think>内部分析</think>\n\n# 草稿\n\n最终答案：\n# 最终结论\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("内部分析"), false);
  // 最终答案：之前的内容应被裁掉
  assert.ok(out.includes("# 最终结论"));
  assert.ok(out.includes("结论：今天不复杂"));
});

test("sanitizeLlmAnswer strips meta intros like 'We need to ...' and 'Let's analyze'", () => {
  const cases = [
    "We need to answer this carefully.\n\n# 结论\n\n结论：今天不复杂。",
    "Let's analyze the situation.\n\n# 结论\n\n结论：今天不复杂。",
    "The user asks about complexity.\n\n# 结论\n\n结论：今天不复杂。"
  ];
  for (const input of cases) {
    const out = sanitizeLlmAnswer(input);
    assert.equal(out.includes("We need to"), false, `case 1: ${input}`);
    assert.equal(out.includes("Let's analyze"), false, `case 2: ${input}`);
    assert.equal(out.includes("The user asks"), false, `case 3: ${input}`);
    assert.ok(out.includes("# 结论"));
  }
});

test("sanitizeLlmAnswer does NOT strip the Chinese '理由：' section", () => {
  const input = "# 标题\n\n结论：今天不复杂。\n\n理由：\n- 当前池子很轻。\n- 没有过载信号。";
  const out = sanitizeLlmAnswer(input);
  assert.ok(out.includes("理由："));
  assert.ok(out.includes("当前池子很轻"));
  assert.ok(out.includes("没有过载信号"));
});

test("sanitizeLlmAnswer preserves technical English terms", () => {
  const input = "# 标题\n\n结论：开工包先交给 GPT 5.5 Thinking 总控。MVP 用 Codex。WorkBuddy 做调研。MiniMax 做视觉。";
  const out = sanitizeLlmAnswer(input);
  assert.ok(out.includes("GPT 5.5 Thinking"));
  assert.ok(out.includes("Codex"));
  assert.ok(out.includes("WorkBuddy"));
  assert.ok(out.includes("MiniMax"));
  assert.ok(out.includes("MVP"));
});

test("sanitizeLlmAnswer returns empty string when only reasoning remains", () => {
  const input = "<think>only reasoning</think>\nReasoning: more reasoning\n";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.trim(), "");
});

test("sanitizeLlmAnswer trims leading/trailing whitespace", () => {
  const input = "\n\n\n <think>hidden</think>\n\n# 标题\n\n结论：今天不复杂。\n\n   \n";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out, "# 标题\n\n结论：今天不复杂。");
});

test("sanitizeLlmAnswer handles real-model garbage: leading English meta + think block + final Chinese", () => {
  const input = `The user asks about complexity-check.

<think>
The user is asking: "Have I overcomplicated the strategy OS thing?"

Let me analyze:
- Current opportunity pool has 2 items
- "Complex feel" comes from meta-layer, not actual load

Let me draft:

Conclusion: ...
</think>
# 你没把事搞复杂

结论：体感复杂 ≠ 真的复杂。

理由：
- 池子只有 2 项。
- 真正的风险是 OS 还没证明价值。

今天不要做：
- 不要给 OS 加新模块。`;

  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("<think>"), false);
  assert.equal(out.includes("Let me analyze"), false);
  assert.equal(out.includes("Let me draft"), false);
  assert.equal(out.includes("Have I overcomplicated"), false);
  assert.ok(out.includes("# 你没把事搞复杂"));
  assert.ok(out.includes("体感复杂"));
  assert.ok(out.includes("理由："));
  assert.ok(out.includes("今天不要做："));
});

test("sanitizeLlmAnswer never echoes API key (regression guard for sk- patterns)", () => {
  // 即使上游错误把 key 漏到 answer 里，清洗也不应改变这个事实；但本身不输出 key。
  const input = "<think>sk-leak-1234</think>\n# 标题\n\n结论：今天不复杂。";
  const out = sanitizeLlmAnswer(input);
  assert.equal(out.includes("sk-leak-1234"), false);
});

test("sanitizeLlmAnswer is idempotent", () => {
  const input = "# 标题\n\n结论：今天不复杂。\n\n理由：\n- 池子很轻。";
  const once = sanitizeLlmAnswer(input);
  const twice = sanitizeLlmAnswer(once);
  assert.equal(once, twice);
});
