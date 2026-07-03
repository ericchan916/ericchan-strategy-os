const assert = require("node:assert/strict");
const test = require("node:test");

const { sanitizeLlmAnswer, translateInternalTerms } = require("../scripts/llm-client");

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

// ============== translateInternalTerms (V0.3.4-hotfix) ==============
//
// 把 LLM 偶发泄漏的内部状态词 / 字段名转成中文。
// 只对"整词或带空格上下文"做替换；不破坏技术名词白名单。

test("translateInternalTerms: validate → 待验证", () => {
  assert.equal(translateInternalTerms("当前状态是 validate"), "当前状态是 待验证");
});

test("translateInternalTerms: accepted → 已确认", () => {
  assert.equal(translateInternalTerms("状态已 accepted"), "状态已 已确认");
});

test("translateInternalTerms: watch → 观察中; watching → 继续观察", () => {
  assert.equal(translateInternalTerms("只剩 watch 项"), "只剩 观察中 项");
  assert.equal(translateInternalTerms("继续 watching 即可"), "继续 继续观察 即可");
});

test("translateInternalTerms: rejected → 已拒绝", () => {
  assert.equal(translateInternalTerms("已被 rejected"), "已被 已拒绝");
});

test("translateInternalTerms: local-fallback → 本地兜底", () => {
  assert.equal(translateInternalTerms("走 local-fallback 路径"), "走 本地兜底 路径");
});

test("translateInternalTerms: source → 来源", () => {
  assert.equal(translateInternalTerms("source 是 llm"), "来源 是 llm");
});

test("translateInternalTerms: trigger → 触发条件", () => {
  assert.equal(translateInternalTerms("trigger 出现"), "触发条件 出现");
});

test("translateInternalTerms: stageFit → 阶段匹配", () => {
  assert.equal(translateInternalTerms("stageFit 是 now"), "阶段匹配 是 now");
});

test("translateInternalTerms: noNewOpportunitiesToday → 今天没有新机会", () => {
  assert.equal(
    translateInternalTerms("判定 noNewOpportunitiesToday"),
    "判定 今天没有新机会"
  );
});

test("translateInternalTerms: current-project-improvement → 当前项目改进", () => {
  assert.equal(
    translateInternalTerms("归类 current-project-improvement"),
    "归类 当前项目改进"
  );
});

test("translateInternalTerms: new-project-opportunity → 新项目机会", () => {
  assert.equal(
    translateInternalTerms("主题 new-project-opportunity"),
    "主题 新项目机会"
  );
});

test("translateInternalTerms: legacy-learning-material → 旧项目学习材料", () => {
  assert.equal(
    translateInternalTerms("归为 legacy-learning-material"),
    "归为 旧项目学习材料"
  );
});

test("translateInternalTerms: inbox → 待处理, building → 构建中, archived → 已归档, ignore → 忽略", () => {
  assert.equal(translateInternalTerms("放 inbox"), "放 待处理");
  assert.equal(translateInternalTerms("状态 building"), "状态 构建中");
  assert.equal(translateInternalTerms("已 archived"), "已 已归档");
  assert.equal(translateInternalTerms("可以 ignore"), "可以 忽略");
});

test("translateInternalTerms: 保留技术名词白名单 (GPT 5.5 Thinking / Codex / API / MVP / OPC / LLM / WorkBuddy / OpenDesign / MiniMax)", () => {
  const input = "开工包先交给 GPT 5.5 Thinking，再考虑 Codex、API、MVP、OPC、WorkBuddy、LLM、OpenDesign、MiniMax 的使用。";
  const out = translateInternalTerms(input);
  for (const term of [
    "GPT 5.5 Thinking",
    "Codex",
    "API",
    "MVP",
    "OPC",
    "LLM",
    "WorkBuddy",
    "OpenDesign",
    "MiniMax"
  ]) {
    assert.ok(out.includes(term), `技术名词 ${term} 应保留`);
  }
});

test("translateInternalTerms: 不破坏代码块内容", () => {
  const input = "```js\nconst status = 'validate';\nconst source = 'llm';\n```\n\n上面代码不翻译。";
  const out = translateInternalTerms(input);
  assert.ok(out.includes("const status = 'validate';"));
  assert.ok(out.includes("const source = 'llm';"));
  assert.ok(out.includes("上面代码不翻译"));
});

test("translateInternalTerms: 整词匹配不误伤普通英文词", () => {
  // validate / accepted / watch 不能误伤其它含子串的英文
  assert.equal(translateInternalTerms("validateAction"), "validateAction");  // 驼峰里不应被切
  assert.equal(translateInternalTerms("watcher"), "watcher");                  // watcher 不是 watch
  assert.equal(translateInternalTerms("acceptance"), "acceptance");            // acceptance 不是 accepted
  // 但带空格或边界的仍翻译
  assert.equal(translateInternalTerms("watch the door"), "观察中 the door");
});

test("translateInternalTerms: 输入为空 / 非字符串不抛异常", () => {
  assert.equal(translateInternalTerms(""), "");
  assert.equal(translateInternalTerms(null), "");
  assert.equal(translateInternalTerms(undefined), "");
  assert.equal(translateInternalTerms(42), "");
});

test("translateInternalTerms: 多个状态词同时出现在同一段", () => {
  const input = "源 source 是 validate；目标 trigger 出现 stageFit 异常。";
  const out = translateInternalTerms(input);
  assert.ok(out.includes("来源"));
  assert.ok(out.includes("待验证"));
  assert.ok(out.includes("触发条件"));
  assert.ok(out.includes("阶段匹配"));
});
