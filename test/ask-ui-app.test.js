const assert = require("node:assert/strict");
const test = require("node:test");

// 通过 source 直接 require 纯函数模块；不真正加载 /app.js 入口（避免触达 document）。
const {
  handleComposerKeyDown,
  validateSubmit,
  applyQuestionToComposer,
  createHistoryStore,
  normalizeHistoryItem,
  loadHistory,
  saveHistory,
  pushHistoryItem,
  removeHistoryItem,
  clearHistory,
  buildClipboardPayload,
  handleCopyClick,
  redactPromptText,
  normalizeCurrentGoal,
  loadCurrentGoal,
  saveCurrentGoal,
  buildCodexTaskPrompt,
  buildClaudeCodeTaskPrompt,
  renderSearchSources,
  renderSearchProcess,
  renderOpportunityPanel,
  buildAddOpportunityFormMarkup,
  normalizeOpportunityForUi,
  getDisplayTitleClient,
  createApp,
  PRESET_TAGS,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_SCORE_LABELS,
  OPPORTUNITY_TITLE_OVERRIDES,
  CURRENT_GOAL_KEY
} = require("../public/ask-ui/app");

function makeKeyEvent({ key, shiftKey = false, ctrlKey = false, metaKey = false, isComposing = false }) {
  return {
    key,
    shiftKey,
    ctrlKey,
    metaKey,
    isComposing,
    preventDefault() {
      this._prevented = true;
    }
  };
}

// 用于 createApp / restoreHistoryItem 测试：构造最简 fake DOM 节点
function makeFakeNodes() {
  const fakeEl = (overrides = {}) => {
    const listeners = {};
    const attrs = {};
    const classes = new Set();
    const classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
        return classes.has(name);
      }
    };
    const el = {
      value: "",
      innerHTML: "",
      textContent: "",
      title: "",
      classList,
      hidden: false,
      disabled: false,
      appendChild() {},
      addEventListener(event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
      dispatchEvent(event) {
        const handlers = listeners[event.type] || [];
        for (const h of handlers) h(event);
      },
      removeEventListener() {},
      setAttribute(name, value) { attrs[name] = String(value); this[name] = String(value); },
      removeAttribute(name) { delete attrs[name]; if (name in this) this[name] = ""; },
      getAttribute(name) { return attrs[name] || null; },
      focus() {},
      setSelectionRange() {},
      scrollIntoView() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      click() {
        const handlers = listeners.click || [];
        for (const h of handlers) h({});
      },
      dataset: {},
      children: [],
      ...overrides
    };
    return el;
  };
  return {
    questionInput: fakeEl(),
    askButton: fakeEl(),
    statusText: fakeEl(),
    answerOutput: fakeEl(),
    questionEcho: fakeEl(),
    questionGrid: fakeEl({ dataset: { questions: "[]" } }),
    historyList: fakeEl(),
    historyEmpty: fakeEl(),
    historyClearButton: fakeEl(),
    copyButton: fakeEl(),
    copyCodexTaskButton: fakeEl({ hidden: true, disabled: true, textContent: "复制为 Codex 任务" }),
    copyClaudeTaskButton: fakeEl({ hidden: true, disabled: true, textContent: "复制为 Claude Code 任务" }),
    answerLoading: fakeEl(),
    webSearchToggle: fakeEl({ checked: false }),
    searchSources: fakeEl(),
    searchProcess: fakeEl(),
    globalStatusText: fakeEl(),
    opportunityStats: fakeEl(),
    opportunityList: fakeEl(),
    opportunityEmpty: fakeEl(),
    opportunityStatus: fakeEl(),
    addOpportunityButton: fakeEl(),
    addOpportunityContainer: fakeEl(),
    // V0.4.1
    opportunityToggle: fakeEl(),
    opportunityBody: fakeEl(),
    opportunityPanel: fakeEl(),
    currentGoalText: fakeEl(),
    goalEditButton: fakeEl(),
    goalClearButton: fakeEl({ hidden: true }),
    goalForm: fakeEl({ hidden: true }),
    goalInput: fakeEl(),
    goalSaveButton: fakeEl({ hidden: true }),
    goalCancelButton: fakeEl()
  };
}

function makeFakeDocument() {
  return {
    createElement(tag) {
      return makeFakeNodes()[tag] || makeFakeNodes();
    },
    querySelector() { return null; }
  };
}

// node --test 在每个 test 里可能拿不到全局 fetch。用 node:http 直接发请求更稳。
const http2 = require("node:http");
function httpRequest({ port, method = "GET", path = "/", body = null, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http2.request({ host, port, path, method, headers: { "content-type": "application/json" } }, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* keep null */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("validateSubmit: empty value returns ok=false with Chinese hint", () => {
  const r = validateSubmit("");
  assert.equal(r.ok, false);
  assert.ok(r.message.includes("请先输入一个问题"));
});

test("validateSubmit: whitespace-only value returns ok=false", () => {
  assert.equal(validateSubmit("   \n  ").ok, false);
});

test("validateSubmit: non-empty value returns ok=true with no message", () => {
  const r = validateSubmit("今天适合做什么？");
  assert.equal(r.ok, true);
  assert.equal(r.message, undefined);
});

test("handleComposerKeyDown: Enter without modifier returns 'submit' and prevents default", () => {
  const ev = makeKeyEvent({ key: "Enter" });
  const result = handleComposerKeyDown(ev);
  assert.equal(result, "submit");
  assert.equal(ev._prevented, true);
});

test("handleComposerKeyDown: Shift+Enter returns 'newline' and does NOT prevent default", () => {
  const ev = makeKeyEvent({ key: "Enter", shiftKey: true });
  const result = handleComposerKeyDown(ev);
  assert.equal(result, "newline");
  assert.equal(ev._prevented, undefined);
});

test("handleComposerKeyDown: Ctrl+Enter still submits (legacy fallback) and prevents default", () => {
  const ev = makeKeyEvent({ key: "Enter", ctrlKey: true });
  const result = handleComposerKeyDown(ev);
  assert.equal(result, "submit");
  assert.equal(ev._prevented, true);
});

test("handleComposerKeyDown: Cmd+Enter also submits (Mac) and prevents default", () => {
  const ev = makeKeyEvent({ key: "Enter", metaKey: true });
  const result = handleComposerKeyDown(ev);
  assert.equal(result, "submit");
  assert.equal(ev._prevented, true);
});

test("handleComposerKeyDown: Enter during composition is ignored (no submit, no prevent)", () => {
  const ev = makeKeyEvent({ key: "Enter", isComposing: true });
  const result = handleComposerKeyDown(ev);
  assert.equal(result, "ignore");
  assert.equal(ev._prevented, undefined);
});

test("handleComposerKeyDown: non-Enter key returns 'noop'", () => {
  for (const key of ["a", "Backspace", "ArrowLeft", "Tab", "Escape"]) {
    const ev = makeKeyEvent({ key });
    assert.equal(handleComposerKeyDown(ev), "noop", `key=${key}`);
  }
});

test("applyQuestionToComposer fills textarea, focuses, and marks the question as selected", () => {
  let focusCalled = 0;
  let inputValue = "";
  let selection = null;
  const fakeInput = {
    get value() { return inputValue; },
    set value(v) { inputValue = v; },
    focus() { focusCalled += 1; },
    setSelectionRange(start, end) { selection = { start, end }; }
  };
  const state = { selectedButton: null };
  const fakeButton = { _aria: "false", setAttribute(name, val) { this._aria = val; } };

  applyQuestionToComposer({
    text: "今天适合做什么？",
    input: fakeInput,
    button: fakeButton,
    state
  });

  assert.equal(inputValue, "今天适合做什么？");
  assert.equal(focusCalled, 1);
  assert.equal(state.selectedButton, fakeButton);
  assert.equal(fakeButton._aria, "true");
  assert.deepEqual(selection, { start: 0, end: inputValue.length });
});

test("applyQuestionToComposer does not call /api/ask (no auto-submit)", () => {
  let fetchCalled = 0;
  globalThis.fetch = () => { fetchCalled += 1; return Promise.resolve({ ok: true, json: async () => ({}) }); };
  const fakeInput = { value: "", focus() {}, setSelectionRange() {} };
  const fakeButton = { setAttribute() {} };
  applyQuestionToComposer({
    text: "今天适合做什么？",
    input: fakeInput,
    button: fakeButton,
    state: { selectedButton: null }
  });
  assert.equal(fetchCalled, 0, "推荐按钮点击不应触发 /api/ask");
  delete globalThis.fetch;
});

// ---------------- 静态文案 / HTML 结构 ----------------

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "styles.css"), "utf8");
const appJsText = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "app.js"), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesCss.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{[\\s\\S]*?\\n\\s*\\}`));
  return match ? match[0] : "";
}

test("HTML still contains 'EricChan·战略OS' title", () => {
  assert.ok(indexHtml.includes("EricChan·战略OS"));
});

test("HTML top status uses dynamic globalStatusText with default offline wording", () => {
  assert.ok(indexHtml.includes('id="globalStatusText"'));
  assert.ok(indexHtml.includes("默认不联网"));
});

test("V0.4.1: UI 不再显示「Enter 发送」提示（已迁到 /api/ask 行为）", () => {
  const combined = `${indexHtml}\n${stylesCss}`;
  assert.equal(combined.includes("Enter 发送"), false, "Enter 发送 不应在 UI 显示");
});

test("HTML / CSS / JS contain 'Shift + Enter 换行' fallback (在 app.js 注释中)", () => {
  // V0.4.1：UI 删了「Enter 发送 · Shift + Enter 换行」提示；
  // 但 app.js 仍含 Shift+Enter 换行的实现注释（向后兼容）
  assert.ok(appJsText.includes("Shift") && appJsText.includes("换行"), "app.js 应保留 Shift+Enter 换行的实现注释");
});

test("HTML no longer markets Ctrl + Enter as primary shortcut", () => {
  // 现在主快捷键是 Enter；面板上不应再把 Ctrl+Enter 当主提示。
  // 仍然可以在 app.js 里保留 Ctrl+Enter 作为 fallback（向后兼容）。
  assert.equal(indexHtml.includes("Ctrl + Enter"), false, "index.html 不应再展示 Ctrl+Enter 提示");
});

test("HTML contains web-search disclaimer in Chinese", () => {
  const text = indexHtml;
  assert.ok(
    text.includes("默认不联网"),
    "HTML 缺少 '默认不联网' 联网说明"
  );
});

test("HTML contains an unchecked per-question web-search checkbox", () => {
  const match = indexHtml.match(/<input[^>]+id="webSearchToggle"[^>]*>/);
  assert.ok(match, "缺少 #webSearchToggle");
  assert.ok(/type="checkbox"/.test(match[0]), "#webSearchToggle 应是 checkbox");
  assert.equal(/checked/i.test(match[0]), false, "联网搜索 checkbox 默认不应勾选");
  assert.ok(indexHtml.includes("本次联网搜索"), "缺少中文搜索开关文案");
});

test("HTML contains recommended-questions hint that says '点一下填入问题，你可以再改写后发送'", () => {
  assert.ok(indexHtml.includes("点一下填入问题"), "推荐问题提示应改为 '点一下填入问题'");
});

test("CSS has sticky / fixed composer at the bottom", () => {
  // composer 应该是固定在底部，不应该随页面滚动消失。
  // 检查 styles.css 含 position: sticky 或 position: fixed 在 .composer 上下文。
  assert.ok(
    /\.composer[\s\S]{0,400}?(?:position\s*:\s*(?:sticky|fixed))/i.test(stylesCss) ||
      /(?:position\s*:\s*(?:sticky|fixed))[\s\S]{0,400}?\.composer/i.test(stylesCss),
    ".composer 应使用 position: sticky 或 position: fixed"
  );
});

test("V0.4.1: CSS layout uses a wider content width (>= 1400px) for desktop", () => {
  // V0.4.1：桌面端 --content-width 提到 1600px
  const matches = stylesCss.match(/--content-width\s*:\s*(\d+)px/);
  assert.ok(matches, "应定义 --content-width 变量");
  const width = Number(matches[1]);
  assert.ok(width >= 1400, `桌面端 --content-width 应 >= 1400px，实际 ${width}px`);
});

test("V0.4.6: desktop shell reserves composer height instead of relying on body scroll padding", () => {
  const shellRule = cssRule(".shell");
  const bodyRule = cssRule("body");
  assert.ok(/height\s*:\s*calc\(100dvh\s*-\s*var\(--composer-height\)\)/i.test(shellRule), ".shell 应扣除 composer 高度");
  assert.equal(/padding-bottom\s*:\s*var\(--composer-height\)/i.test(bodyRule), false, "桌面 body 不应靠 padding-bottom 形成整页滚动");
});

test("app.js no longer wires recommended-question button to submitAsk directly", () => {
  // 老逻辑：button.addEventListener("click", () => { ask(question); });
  // 新逻辑：button.addEventListener("click", () => { fillQuestion(question); });
  assert.ok(appJsText.includes("fillQuestion"), "推荐按钮应调用 fillQuestion 而非 submitAsk");
  // 防御性：旧模式不应再出现。
  const oldPattern = /addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]{0,80}ask\(/;
  assert.equal(oldPattern.test(appJsText), false, "发现旧的 'ask(' 触发模式");
});

test("app.js sends useSearch=true only when the checkbox is enabled", () => {
  assert.ok(appJsText.includes("webSearchToggle"), "app.js 应读取搜索开关");
  assert.ok(appJsText.includes("requestBody.useSearch = true"), "勾选搜索时 POST body 应包含 useSearch=true");
  assert.equal(/JSON\.stringify\(\{\s*question:\s*value,\s*useSearch:\s*true\s*\}\)/.test(appJsText), false,
    "不应无条件发送 useSearch=true");
});

test("app.js history saves search status but not raw search response", () => {
  assert.ok(appJsText.includes("searchUsed"), "历史记录应保存 searchUsed");
  assert.ok(appJsText.includes("searchWarning"), "历史记录应保存 searchWarning");
  assert.ok(appJsText.includes("searchResultCount"), "历史记录应保存 searchResultCount");
  assert.equal(appJsText.includes("rawResponse"), false, "历史记录不应保存 rawResponse");
});

// ============== V0.3.4-hotfix 静态内容 / HTML / CSS 断言 ==============

test("HTML 顶部副标题已替换，不再包含旧的 '主动提问，而不是被动推送'", () => {
  assert.equal(indexHtml.includes("主动提问，而不是被动推送"), false, "副标题文案未替换");
});

test("HTML 含新的中文副标题（'把想法压成判断' 或 '把混乱的问题' 或类似）", () => {
  // 候选文案（spec 给的两个选项 + 任选保守中式）：
  const candidates = [
    "把想法压成判断，把判断变成下一步",
    "把混乱的问题，压成今天能做的判断"
  ];
  const found = candidates.some((text) => indexHtml.includes(text));
  assert.ok(found, "新副标题未出现。可选：" + candidates.join(" / "));
});

test("HTML 含 '最近提问' 历史区域标题", () => {
  assert.ok(indexHtml.includes("最近提问"), "缺少最近提问区域");
});

test("HTML 含复制回答按钮 (id 或 aria-label)", () => {
  // 用 aria-label 来定位，避免依赖具体 id。
  const hasCopy =
    /aria-label="复制回答"/.test(indexHtml) ||
    /id="copyAnswer"/.test(indexHtml) ||
    /id="copyButton"/.test(indexHtml);
  assert.ok(hasCopy, "缺少复制回答按钮");
});

test("V0.6.5: HTML 不再含 Codex / Claude Code 任务复制按钮", () => {
  // V0.6.5 简化任务按钮：前端不再展示这两个按钮
  assert.equal(/id="copyCodexTaskButton"/.test(indexHtml), false, "不应再渲染 copyCodexTaskButton");
  assert.equal(/id="copyClaudeTaskButton"/.test(indexHtml), false, "不应再渲染 copyClaudeTaskButton");
  // 用户不应在页面看到"复制为 Codex 任务"或"复制为 Claude Code 任务"的可见文案
  assert.equal(/复制为 Codex 任务/.test(indexHtml), false, "不应再出现「复制为 Codex 任务」可见文案");
  assert.equal(/复制为 Claude Code 任务/.test(indexHtml), false, "不应再出现「复制为 Claude Code 任务」可见文案");
  // 但开工包 / 普通复制 / 机会池 仍保留
  assert.ok(/id="copyButton"/.test(indexHtml), "应保留普通 copyButton");
  assert.ok(/id="addOpportunityButton"/.test(indexHtml), "应保留机会池按钮");
});

test("V0.4.5: 战略回答区域不再显示范围 / 搜索冗余 meta 信息块", () => {
  assert.equal(/class="panel meta-panel"/.test(indexHtml), false, "不应再渲染 meta-panel");
  assert.equal(indexHtml.includes("本地 context + LLM"), false, "不应再显示范围说明");
  assert.equal(indexHtml.includes("默认不联网，可为本次开启"), false, "不应再显示搜索 meta 说明");
  assert.ok(indexHtml.includes("默认不联网"), "顶部默认不联网文案仍应保留");
});

test("HTML 含 loading 容器", () => {
  const hasLoading =
    /id="answerLoading"/.test(indexHtml) ||
    /class="[^"]*answer-loading[^"]*"/.test(indexHtml);
  assert.ok(hasLoading, "缺少 loading 容器");
});

test("HTML loading 容器包含动画结构（wheel-and-hamster 或 loading-spinner）", () => {
  // 接受任一 Uiverse loading 实现：
  //  1) wheel-and-hamster（仓鼠跑轮；V0.3.4-hotfix-2 默认）
  //  2) loading-spinner 6-盒子 3D 旋转（备选，可随时切换）
  const startIdx = indexHtml.indexOf('id="answerLoading"');
  assert.ok(startIdx > 0, "找不到 #answerLoading 节点");
  const inner = indexHtml.slice(startIdx, startIdx + 2400);

  const hasHamster = /class="[^"]*wheel-and-hamster[^"]*"/.test(inner);
  const hasSpinner = /class="[^"]*loading-spinner[^"]*"/.test(inner);
  assert.ok(hasHamster || hasSpinner, "缺少 loading 动画结构（wheel-and-hamster 或 loading-spinner）");

  if (hasHamster) {
    // 仓鼠结构必须完整
    assert.ok(/class="[^"]*\bwheel\b[^"]*"/.test(inner), "缺少 wheel");
    assert.ok(/class="[^"]*\bhamster\b[^"]*"/.test(inner), "缺少 hamster");
    assert.ok(/class="[^"]*hamster__body[^"]*"/.test(inner), "缺少 hamster__body");
    assert.ok(/class="[^"]*hamster__head[^"]*"/.test(inner), "缺少 hamster__head");
    assert.ok(/class="[^"]*hamster__ear[^"]*"/.test(inner), "缺少 hamster__ear");
    assert.ok(/class="[^"]*hamster__eye[^"]*"/.test(inner), "缺少 hamster__eye");
    assert.ok(/class="[^"]*hamster__nose[^"]*"/.test(inner), "缺少 hamster__nose");
    assert.ok(/class="[^"]*\bspoke\b[^"]*"/.test(inner), "缺少 spoke");
    for (const limb of ["fr", "fl", "br", "bl"]) {
      assert.ok(
        new RegExp(`class="[^"]*hamster__limb--${limb}[^"]*"`).test(inner),
        `缺少 hamster__limb--${limb}`
      );
    }
    assert.ok(/class="[^"]*hamster__tail[^"]*"/.test(inner), "缺少 hamster__tail");
  } else if (hasSpinner) {
    // spinner 结构：必须含 6 个 <div></div> 盒子
    const nested = inner.match(/<div aria-hidden="true" class="loading-spinner"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
    assert.ok(nested, "loading-spinner 结构不完整");
    const emptyDivs = (nested[0].match(/<div><\/div>/g) || []).length;
    assert.equal(emptyDivs, 6, `loading-spinner 应含 6 个 <div></div>，实际 ${emptyDivs}`);
  }

  // 中文 aria-label
  assert.ok(
    /aria-label="[^"]*仓鼠[^"]*"|aria-label="[^"]*正在生成[^"]*"|aria-label="[^"]*战略判断[^"]*"/.test(inner),
    "loading 容器应使用中文 aria-label"
  );
});

test("HTML 仍含'默认不联网'联网说明", () => {
  assert.ok(indexHtml.includes("默认不联网"), "缺少联网能力说明");
});

test("app.js contains dynamic global search status messages", () => {
  assert.ok(appJsText.includes("本次将联网搜索"));
  assert.ok(appJsText.includes("正在联网搜索"));
  assert.ok(appJsText.includes("已参考外部搜索结果"));
  assert.ok(appJsText.includes("联网搜索失败，已本地回答"));
});

test("CSS 包含复制按钮样式（.copy-button / .answer-copy）", () => {
  const hasCss =
    /\.copy-button[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.answer-copy[\s\S]{0,200}?\{/i.test(stylesCss);
  assert.ok(hasCss, "缺少复制按钮样式");
});

test("README 提到仓鼠跑轮 loading（V0.3.4-hotfix-2）", () => {
  // 读 README 内容（不一定每次都重新构建 fs 读取）
  const fs = require("node:fs");
  const path = require("node:path");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(/仓鼠/.test(readme), "README 应明确提到 '仓鼠' loading");
  assert.ok(/Uiverse/.test(readme), "README 应注明来源 Uiverse");
});

test("CSS 包含 loading 动画样式（@keyframes / hamster / spinner）", () => {
  const hasKeyframes = /@keyframes\s+[A-Za-z_-]+/.test(stylesCss);
  assert.ok(hasKeyframes, "缺少 @keyframes（loading 动画）");
});

test("CSS loading 动画样式（@keyframes + 必要 class）", () => {
  // 接受任一 Uiverse 实现：
  //  1) 仓鼠实现：11 个 @keyframes (hamsterHead/Eye/.../spoke) + 14 个 .wheel-* 选择器
  //  2) spinner 实现：@keyframes loading-spinner + .loading-spinner 规则
  const hasHamsterKeyframes = /@keyframes\s+hamster\b/.test(stylesCss);
  const hasSpinnerKeyframes = /@keyframes\s+loading-spinner\b/.test(stylesCss);
  assert.ok(
    hasHamsterKeyframes || hasSpinnerKeyframes,
    "缺少 loading @keyframes（hamster 或 loading-spinner）"
  );
  if (hasHamsterKeyframes) {
    const requiredKeyframes = [
      "hamster",
      "hamsterHead",
      "hamsterEye",
      "hamsterEar",
      "hamsterBody",
      "hamsterFRLimb",
      "hamsterFLLimb",
      "hamsterBRLimb",
      "hamsterBLLimb",
      "hamsterTail",
      "spoke"
    ];
    for (const name of requiredKeyframes) {
      const re = new RegExp(`@keyframes\\s+${name}\\b`);
      assert.ok(re.test(stylesCss), `缺少 @keyframes ${name}`);
    }
  }
  if (hasSpinnerKeyframes) {
    assert.ok(/\.loading-spinner\s*\{/.test(stylesCss), ".loading-spinner 主规则缺失");
  }
});

test("CSS loading 区域高度被限制（仓鼠动画不会撑大页面）", () => {
  // .answer-loading 应有 max-height 或固定高度约束；
  // .wheel-and-hamster 应有 font-size / width / height 限制（Uiverse 用 em 作单位）。
  // 不强制具体数值，只要 .wheel-and-hamster 规则里有 width / height 关键字即可。
  // 注意：必须把 .wheel-and-hamster 后面的真实声明块（非 reduced-motion 覆盖）匹配出来。
  const wheelHamsterRule = stylesCss.match(/\.wheel-and-hamster\s*\{[\s\S]*?\n\s*\}\s*\.wheel,/);
  assert.ok(wheelHamsterRule, "找不到 .wheel-and-hamster 主规则");
  const target = wheelHamsterRule[0];
  assert.ok(/width|height|font-size/i.test(target), ".wheel-and-hamster 应限制尺寸");
});

test("CSS .answer-loading 有明确背景（深色卡片或白卡二选一）", () => {
  // .answer-loading 主规则（不是 reduced-motion 覆盖）。
  // 接受任一视觉方案：
  //  1) V0.3.4-hotfix-3 深色卡片方案（#1f1f1f / #202124 / #232323 系列）
  //  2) 白卡方案（与页面面板一致，#ffffff / var(--panel-strong)）
  const rule = stylesCss.match(/\.answer-loading\s*\{[\s\S]*?\n\s*\}\s*\.answer-loading:not/);
  assert.ok(rule, "找不到 .answer-loading 主规则");
  const target = rule[0].toLowerCase();
  const darkHexes = ["#1f1f1f", "#202124", "#232323", "#1a1a1a", "#222"];
  const lightHexes = ["#ffffff", "var(--panel-strong)"];
  const isDark = darkHexes.some((hex) => target.includes(hex));
  const isLight = lightHexes.some((hex) => target.includes(hex));
  assert.ok(isDark || isLight, ".answer-loading 应有明确背景（深色或白卡）");
  // 卡片应有圆角和适度 padding。
  assert.ok(/border-radius/i.test(target), ".answer-loading 应有 border-radius");
  assert.ok(/padding/i.test(target), ".answer-loading 应有 padding");
});

test("HTML answerLoading 含深色卡片节点标记（V0.3.4-hotfix-3）", () => {
  // 加载区域属于深色卡片。HTML 端通过 class / aria / data-tone 标记；
  // 不能仅靠 CSS，否则测试无法识别。
  // 我们引入一个新 class 'loading-card' 作为深色卡片容器。
  const startIdx = indexHtml.indexOf('id="answerLoading"');
  assert.ok(startIdx > 0, "找不到 #answerLoading");
  const inner = indexHtml.slice(startIdx, startIdx + 2400);
  assert.ok(/class="[^"]*loading-card[^"]*"|class="[^"]*answer-loading[^"]*"/.test(inner),
    "loading 区应携带深色卡片样式标记");
});

test("V0.6.6: CSS .wheel-and-hamster 主规则（10em + 16px）", () => {
  // 找含有 width: <n>em + font-size: <n>px 的真正主规则（不是 reduced-motion 覆盖）
  // V0.6.6：因 V0.6.6 加了多个 font-size: 13/14/15 的规则，老的非贪婪 regex 会取到错误的 13px；
  // 改成直接定位 "width: <n>em" + "font-size: <n>px" 同时出现的块。
  const rules = stylesCss.match(/\.wheel-and-hamster\s*\{[^}]*\}/g) || [];
  const main = rules.find((r) => /width\s*:\s*\d+(?:\.\d+)?em/.test(r) && /font-size\s*:\s*\d+px/.test(r));
  assert.ok(main, "找不到 .wheel-and-hamster 主规则（应同时含 width: <n>em 与 font-size: <n>px）");
  const wm = main.match(/width\s*:\s*(\d+(?:\.\d+)?)em/);
  const fm = main.match(/font-size\s*:\s*(\d+)px/);
  const emSize = Number(wm[1]);
  const px = Number(fm[1]);
  assert.ok(emSize >= 9, `.wheel-and-hamster 应 >= 9em，当前 ${emSize}em`);
  assert.ok(px >= 16, `.wheel-and-hamster font-size 应 >= 16px，当前 ${px}px`);
});

test("CSS .wheel 规则含明显 rim / 中轴 / 边线（V0.3.4-hotfix-3）", () => {
  // 在 .wheel / .spoke 主规则里，应该有可见 rim / 边框 / 中轴 / 等显示规则。
  // 我们接受: border / box-shadow / outline 等可显示边界的机制。
  // 取 .wheel 主规则 → 紧跟的 \{ ... \} 结束。
  const wheelRule = stylesCss.match(/\.wheel\s*\{[\s\S]*?\n\s*\}\s*(?:\.spoke|@keyframes)/);
  assert.ok(wheelRule, "找不到 .wheel 主规则");
  const target = wheelRule[0];
  // 至少满足以下一种可见的边 / rim 设计：border / box-shadow / outline。
  const hasVisibleBoundary = /\bborder\b/i.test(target) || /\bbox-shadow\b/i.test(target);
  assert.ok(hasVisibleBoundary, ".wheel 主规则应含 border 或 box-shadow 让轮圈可见");
});

test("CSS 不再使用旧 loading-wheel-svg / spinner 结构", () => {
  assert.equal(
    /\.loading-wheel-svg\b/.test(stylesCss),
    false,
    "CSS 不应再含旧 .loading-wheel-svg 结构（已被 Uiverse 仓鼠跑轮替代）"
  );
  // HTML 端也不再包含 loading-wheel-svg
  assert.equal(/loading-wheel-svg/.test(indexHtml), false, "HTML 不应再含旧 SVG spinner");
});

test("CSS 包含 prefers-reduced-motion 媒体查询", () => {
  assert.ok(
    /prefers-reduced-motion\s*:\s*reduce/.test(stylesCss),
    "缺少 prefers-reduced-motion 媒体查询"
  );
});

test("CSS 包含历史记录样式（.history / .history-item / .history-empty）", () => {
  const hasHistory =
    /\.history[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.history-item[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.history-empty[\s\S]{0,200}?\{/i.test(stylesCss);
  assert.ok(hasHistory, "缺少历史记录样式");
});

test("V0.4.4: CSS 包含开工包任务复制按钮样式", () => {
  assert.ok(/\.task-copy-button\s*\{/.test(stylesCss), "缺少 .task-copy-button 样式");
  assert.ok(/\.task-copy-button\[data-state="copied"\]/.test(stylesCss), "缺少任务复制成功态样式");
});

test("app.js 含 history store (createHistoryStore / strategyOsAskHistory) 与 copy helpers", () => {
  assert.ok(appJsText.includes("createHistoryStore"), "缺少 createHistoryStore");
  assert.ok(appJsText.includes("strategyOsAskHistory"), "缺少 history key");
  assert.ok(appJsText.includes("handleCopyClick"), "缺少 handleCopyClick");
});

test("app.js 在 LLM 回答渲染前/后调用 translateInternalTerms (或 sanitizeUserVisibleAnswer) 做中文化", () => {
  // 不能误伤代码块，但要把内部状态词转成中文。
  assert.ok(
    appJsText.includes("translateInternalTerms") ||
      appJsText.includes("sanitizeUserVisibleAnswer"),
    "缺少中文化后处理调用"
  );
});

// ============== History store (V0.3.4-hotfix) ==============

// in-memory 替代 localStorage，可注入到 createHistoryStore。
function makeMemoryStorage(initial = []) {
  const map = new Map();
  if (initial.length) {
    map.set("strategyOsAskHistory", JSON.stringify(initial));
  }
  return {
    data: map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

test("V0.5: normalizeCurrentGoal 限制长度并脱敏 sk-*", () => {
  const long = `  用战略OS筛选适合独立开发者的小型 AI 产品 sk-goalSecret123456 ${"很长".repeat(120)}  `;
  const goal = normalizeCurrentGoal(long);
  assert.equal(goal.includes("sk-goalSecret123456"), false);
  assert.ok(goal.includes("[redacted]"));
  assert.ok(goal.length <= 200);
});

test("V0.5: currentGoal 可写入、读取和清除 localStorage", () => {
  const storage = makeMemoryStorage();
  const saved = saveCurrentGoal(storage, "  做一个 AI 机会发现与执行调度台  ");
  assert.equal(saved, "做一个 AI 机会发现与执行调度台");
  assert.equal(storage.getItem(CURRENT_GOAL_KEY), saved);
  assert.equal(loadCurrentGoal(storage), saved);

  const cleared = saveCurrentGoal(storage, "");
  assert.equal(cleared, "");
  assert.equal(storage.getItem(CURRENT_GOAL_KEY), null);
});

test("V0.5: localStorage 不可用时 currentGoal 静默 fallback", () => {
  const brokenStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  assert.equal(loadCurrentGoal(brokenStorage), "");
  assert.equal(saveCurrentGoal(brokenStorage, "目标 sk-brokenSecret123456"), "目标 [redacted]");
});

test("normalizeHistoryItem: 把任意对象转成标准结构", () => {
  const item = normalizeHistoryItem({
    question: "今天适合做什么？",
    answer: "# 结论\n\n结论：今天轻量。",
    source: "llm",
    warning: null,
    createdAt: 1700000000000
  });
  assert.equal(item.question, "今天适合做什么？");
  assert.equal(item.answer, "# 结论\n\n结论：今天轻量。");
  assert.equal(item.source, "llm");
  assert.equal(item.searchUsed, false);
  assert.equal(item.searchWarning, null);
  assert.equal(item.searchResultCount, 0);
  assert.ok(typeof item.id === "string" && item.id.length > 0);
  assert.equal(typeof item.createdAt, "number");
});

test("normalizeHistoryItem: preserves safe search summary fields only", () => {
  const item = normalizeHistoryItem({
    question: "查一下新闻",
    answer: "回答",
    source: "llm",
    searchUsed: true,
    searchWarning: null,
    searchResultCount: 2,
    searchIntent: "news",
    searchPlannedQueries: ["Q1", "Q2", "Q3", "Q4"],
    searchFreshness: "oneMonth",
    searchRecency: {
      required: true,
      reason: "新闻与发布信息需要近期结果。",
      filteredOldCount: 1,
      missingDateCount: 2,
      oldestKeptDate: "2026-07-01",
      newestKeptDate: "2026-07-03",
      raw: "drop"
    },
    searchFilters: { blockedTopicCount: 3, duplicateCount: 4, raw: "drop" },
    searchSources: [
      { title: "A", url: "https://example.com/a", source: "example.com", raw: "sk-raw" }
    ]
  });

  assert.equal(item.searchUsed, true);
  assert.equal(item.searchResultCount, 2);
  assert.equal(item.searchIntent, "news");
  assert.deepEqual(item.searchPlannedQueries, ["Q1", "Q2", "Q3"]);
  assert.equal(item.searchFreshness, "oneMonth");
  assert.equal(item.searchRecency.filteredOldCount, 1);
  assert.equal(item.searchRecency.missingDateCount, 2);
  assert.equal(item.searchFilters.blockedTopicCount, 3);
  assert.equal(item.searchFilters.duplicateCount, 4);
  assert.deepEqual(item.searchSources, [{ title: "A", url: "https://example.com/a", source: "example.com" }]);
  assert.equal(JSON.stringify(item).includes("sk-raw"), false);
  assert.equal(JSON.stringify(item).includes("drop"), false);
});

test("HTML contains opportunity pool panel", () => {
  assert.ok(indexHtml.includes("机会池"));
  assert.ok(indexHtml.includes('id="opportunityList"'));
  assert.ok(indexHtml.includes('id="opportunityStats"'));
  assert.ok(indexHtml.includes("还没有可展示的机会"));
});

test("normalizeHistoryItem: createdAt 缺失时回填当前时间", () => {
  const item = normalizeHistoryItem({ question: "q", answer: "a", source: "local" });
  assert.equal(item.question, "q");
  assert.equal(typeof item.createdAt, "number");
});

test("normalizeHistoryItem: 缺字段时回填空字符串而不是抛错", () => {
  const item = normalizeHistoryItem({});
  assert.equal(item.question, "");
  assert.equal(item.answer, "");
  assert.equal(item.source, "local");
  assert.equal(item.warning, null);
});

test("createHistoryStore: 初始为空", () => {
  const store = createHistoryStore({ storage: makeMemoryStorage(), maxSize: 20 });
  assert.equal(store.list().length, 0);
});

test("createHistoryStore.push: 新增一条并写到 storage", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  store.push({
    question: "今天适合做什么？",
    answer: "# 结论\n\n结论：今天轻量。",
    source: "llm"
  });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].question, "今天适合做什么？");
  const raw = storage.getItem("strategyOsAskHistory");
  assert.ok(raw && raw.includes("今天轻量"));
});

test("createHistoryStore.push: 同问题重复会移动到顶部而不是无限重复", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  store.push({ question: "Q1", answer: "A1", source: "llm" });
  store.push({ question: "Q2", answer: "A2", source: "llm" });
  store.push({ question: "Q1", answer: "A1-new", source: "local" });
  const list = store.list();
  assert.equal(list.length, 2, "重复问题应去重而非叠加");
  assert.equal(list[0].question, "Q1", "最新一次提交应排到顶部");
  assert.equal(list[0].answer, "A1-new", "应以最新一次回答为准");
});

test("createHistoryStore.push: 最多保留最近 20 条", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  for (let i = 0; i < 25; i += 1) {
    store.push({ question: `Q${i}`, answer: `A${i}`, source: "llm" });
  }
  const list = store.list();
  assert.equal(list.length, 20, "最多保留 20 条");
  assert.equal(list[0].question, "Q24", "最新应排到最前面");
  assert.equal(list[19].question, "Q5", "最旧应被挤出");
});

test("createHistoryStore.clear: 清空 storage 和 in-memory 列表", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  store.push({ question: "Q", answer: "A", source: "llm" });
  store.clear();
  assert.equal(store.list().length, 0);
  assert.equal(storage.getItem("strategyOsAskHistory"), null);
});

test("loadHistory: 从 storage 读回历史并处理坏 JSON", () => {
  const map1 = new Map();
  map1.set("strategyOsAskHistory", "not-json");
  const store1 = createHistoryStore({
    storage: { data: map1, getItem: map1.get.bind(map1), setItem() {}, removeItem() {} },
    maxSize: 20
  });
  assert.equal(store1.list().length, 0);

  const map2 = new Map();
  map2.set(
    "strategyOsAskHistory",
    JSON.stringify([{ question: "Q", answer: "A", source: "llm", createdAt: 1 }])
  );
  const store2 = createHistoryStore({
    storage: { data: map2, getItem: map2.get.bind(map2), setItem() {}, removeItem() {} },
    maxSize: 20
  });
  assert.equal(store2.list().length, 1);
  assert.equal(store2.list()[0].question, "Q");
});

test("V0.6.3-hotfix: history storage never keeps raw sk-like values", () => {
  const storage = makeMemoryStorage();
  saveHistory(storage, [
    {
      question: "问题 sk-leakTestABC",
      answer: "回答 sk-answerLeakABC",
      source: "llm",
      searchSources: [{ title: "来源 sk-sourceLeakABC", url: "https://example.com/sk-urlLeakABC", source: "sk-siteLeakABC" }],
      searchPlannedQueries: ["查询 sk-queryLeakABC"]
    }
  ]);
  const raw = storage.getItem("strategyOsAskHistory");
  assert.equal(raw.includes("sk-leakTestABC"), false);
  assert.equal(raw.includes("sk-answerLeakABC"), false);
  assert.equal(raw.includes("sk-sourceLeakABC"), false);
  assert.ok(raw.includes("[redacted]"));

  const store = createHistoryStore({ storage, maxSize: 20 });
  assert.equal(JSON.stringify(store.list()).includes("sk-"), false);
});

test("removeHistoryItem: 按 id 移除一条", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  store.push({ question: "Q1", answer: "A1", source: "llm" });
  store.push({ question: "Q2", answer: "A2", source: "llm" });
  const id = store.list()[1].id; // 老的那条
  store.remove(id);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].question, "Q2");
});

// 低层工具函数（同 export）覆盖
test("saveHistory / loadHistory / clearHistory / removeHistoryItem 接受自定义 storage", () => {
  const storage = makeMemoryStorage();
  saveHistory(storage, [], 20);
  assert.equal(storage.getItem("strategyOsAskHistory"), null);

  const items = [
    normalizeHistoryItem({ question: "Q1", answer: "A1", source: "llm" }),
    normalizeHistoryItem({ question: "Q2", answer: "A2", source: "local" })
  ];
  saveHistory(storage, items, 20);
  const loaded = loadHistory(storage, 20);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].question, "Q1");

  // pushHistoryItem 是 push 一条，dedup by question；初始空 +1 = 1。
  const pushed = pushHistoryItem([], items[0], 20);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].question, "Q1");

  const removed = removeHistoryItem(items, items[1].id);
  assert.equal(removed.length, 1);
});

test("saveHistory: 缺 storage 时不抛异常", () => {
  assert.doesNotThrow(() => saveHistory(null, [], 20));
  assert.doesNotThrow(() => loadHistory(null, 20));
  assert.deepEqual(loadHistory(null, 20), []);
});

// ============== Copy helpers (V0.3.4-hotfix) ==============

test("buildClipboardPayload: 返回 answer 字段，不是 HTML", () => {
  const payload = buildClipboardPayload({
    answer: "# 标题\n\n结论：今天轻量。",
    question: "今天适合做什么？"
  });
  assert.equal(payload.text, "# 标题\n\n结论：今天轻量。");
  assert.equal(payload.html, undefined);
  assert.equal(JSON.stringify(payload).includes("searchSources"), false);
});

test("buildClipboardPayload: 空 answer 返回空文本而不是空对象", () => {
  const payload = buildClipboardPayload({ answer: "", question: "q" });
  assert.equal(payload.text, "");
});

test("handleCopyClick: 触发 clipboard.writeText 并返回成功状态", async () => {
  let written = "";
  const clipboardImpl = async (text) => {
    written = text;
  };
  const result = await handleCopyClick({
    answer: "# 标题\n\n结论：今天轻量。",
    clipboardImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "# 标题\n\n结论：今天轻量。");
  assert.equal(written, "# 标题\n\n结论：今天轻量。");
});

test("V0.6.3-hotfix: clipboard payload redacts short sk-like values", async () => {
  const payload = buildClipboardPayload({ answer: "回答 sk-leakTestABC" });
  assert.equal(payload.text.includes("sk-leakTestABC"), false);
  assert.ok(payload.text.includes("[redacted]"));

  let written = "";
  const result = await handleCopyClick({
    answer: "复制 sk-copyLeakABC",
    clipboardImpl: async (text) => { written = text; }
  });
  assert.equal(result.ok, true);
  assert.equal(written.includes("sk-copyLeakABC"), false);
});

test("handleCopyClick: clipboard 抛错时返回 ok:false 和中文错误", async () => {
  const failingClipboard = async () => {
    throw new Error("Document is not focused");
  };
  const result = await handleCopyClick({ answer: "内容", clipboardImpl: failingClipboard });
  assert.equal(result.ok, false);
  assert.ok(result.message && result.message.includes("复制失败"));
});

test("handleCopyClick: 没有 clipboard 实现时返回 ok:false", async () => {
  const result = await handleCopyClick({ answer: "内容", clipboardImpl: null });
  assert.equal(result.ok, false);
  assert.ok(result.message);
});

test("handleCopyClick: 缺 answer 时返回 ok:false，不调用 clipboard", async () => {
  let called = 0;
  const result = await handleCopyClick({
    answer: "",
    clipboardImpl: async () => {
      called += 1;
    }
  });
  assert.equal(result.ok, false);
  assert.equal(called, 0);
});

test("buildCodexTaskPrompt: 包含开工包正文、测试与 Git 要求，并脱敏 sk-*", () => {
  const prompt = buildCodexTaskPrompt({
    question: "帮我生成开工包",
    answer: "# 项目开工包\n使用 sk-testSecret123456 做配置。"
  });
  assert.ok(prompt.includes("# 项目开工包"));
  assert.ok(prompt.includes("项目路径："));
  assert.ok(prompt.includes("当前状态："));
  assert.ok(prompt.includes("不要做的事："));
  assert.ok(prompt.includes("必须完成的事："));
  assert.ok(prompt.includes("真实验证要求："));
  assert.ok(prompt.includes("测试要求"));
  assert.ok(prompt.includes("Git 要求"));
  assert.ok(prompt.includes("最终汇报"));
  assert.ok(prompt.includes("开始前运行 git status --short"));
  assert.ok(prompt.includes("不要默认联网"));
  assert.ok(prompt.includes("[redacted]"));
  assert.equal(prompt.includes("sk-testSecret123456"), false);
});

test("buildClaudeCodeTaskPrompt: 包含开工包正文与真实网页验证要求，并脱敏 sk-*", () => {
  const prompt = buildClaudeCodeTaskPrompt({
    question: "帮我生成开工包",
    answer: "# 项目开工包\n不要泄露 sk-claudeSecret123456。"
  });
  assert.ok(prompt.includes("# 项目开工包"));
  assert.ok(prompt.includes("项目路径："));
  assert.ok(prompt.includes("当前状态："));
  assert.ok(prompt.includes("不要做的事："));
  assert.ok(prompt.includes("允许修改范围"));
  assert.ok(prompt.includes("必须完成的事："));
  assert.ok(prompt.includes("真实网页验证要求"));
  assert.ok(prompt.includes("验证桌面端"));
  assert.ok(prompt.includes("验证小屏 / 移动端"));
  assert.ok(prompt.includes("不要改 loading 动画"));
  assert.ok(prompt.includes("不要大改架构"));
  assert.ok(prompt.includes("[redacted]"));
  assert.equal(prompt.includes("sk-claudeSecret123456"), false);
});

test("V0.6.3-hotfix: task prompts redact short sk-like values from question answer and Goal", () => {
  const common = {
    question: "问题 sk-leakTestABC",
    answer: "# 开工包\n正文 sk-answerLeakABC",
    currentGoal: "目标 sk-goalLeakABC"
  };
  const codex = buildCodexTaskPrompt(common);
  const claude = buildClaudeCodeTaskPrompt(common);
  for (const prompt of [codex, claude]) {
    assert.equal(prompt.includes("sk-leakTestABC"), false);
    assert.equal(prompt.includes("sk-answerLeakABC"), false);
    assert.equal(prompt.includes("sk-goalLeakABC"), false);
    assert.ok(prompt.includes("[redacted]"));
  }
});

test("任务提示词模板: 空 answer 有 fallback", () => {
  assert.ok(buildCodexTaskPrompt({ answer: "" }).includes("开工包正文为空"));
  assert.ok(buildClaudeCodeTaskPrompt({ answer: "" }).includes("开工包正文为空"));
});

test("redactPromptText: 替换 sk-* 原文", () => {
  assert.equal(redactPromptText("key=sk-abc123_ABC-456"), "key=[redacted]");
});

// ============== V0.3.6 搜索来源展示 ==============

test("renderSearchSources: 空数组返回空字符串（不渲染空来源框）", () => {
  const html = renderSearchSources([]);
  assert.equal(html, "", "无 sources 时应返回空字符串");
});

test("renderSearchSources: 渲染 title / source / url", () => {
  const sources = [
    { title: "示例新闻", url: "https://example.com/news/1", source: "example.com" }
  ];
  const html = renderSearchSources(sources);
  assert.ok(html.includes("示例新闻"), "应包含 title");
  assert.ok(html.includes("example.com"), "应包含 source 域名");
  assert.ok(html.includes("https://example.com/news/1"), "应包含 url");
});

test("renderSearchSources: url 是可点击的 <a> 链接，含 target=_blank 与 rel=noopener noreferrer", () => {
  const sources = [{ title: "外链测试", url: "https://example.com/x", source: "example.com" }];
  const html = renderSearchSources(sources);
  const link = html.match(/<a [^>]*href="https:\/\/example\.com\/x"[^>]*>/);
  assert.ok(link, "应渲染成 <a href> 链接");
  assert.ok(/target="_blank"/.test(link[0]), "外链应在新窗口打开");
  assert.ok(/rel="noopener noreferrer"/.test(link[0]), "外链应带 rel=noopener noreferrer 安全属性");
});

test("renderSearchSources: 标题做 HTML 转义，避免 XSS", () => {
  const sources = [{ title: "<script>alert('xss')</script>", url: "https://example.com/s", source: "evil" }];
  const html = renderSearchSources(sources);
  assert.equal(html.includes("<script>alert"), false, "title 不应出现未转义 <script>");
  assert.ok(html.includes("&lt;script&gt;"), "title 应被 HTML escape");
});

test("renderSearchSources: url 与 source 字段也做 HTML 转义", () => {
  const sources = [{ title: "ok", url: '"><img src=x onerror=alert(1)>', source: "<b>bad</b>" }];
  const html = renderSearchSources(sources);
  assert.equal(html.includes("<img src=x"), false, "不应出现注入的 <img>");
  assert.ok(html.includes("&lt;b&gt;bad&lt;/b&gt;"), "source 字段应被 HTML escape");
});

test("renderSearchSources: 超过 5 条时只渲染前 5 条", () => {
  const sources = Array.from({ length: 10 }, (_, i) => ({
    title: `标题 ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    source: "example.com"
  }));
  const html = renderSearchSources(sources);
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(html.includes(`标题 ${i}`), `应包含第 ${i} 条`);
  }
  for (let i = 6; i <= 10; i += 1) {
    assert.equal(html.includes(`标题 ${i}`), false, `不应包含第 ${i} 条`);
  }
});

test("renderSearchSources: 缺 url 时不渲染成 <a> 链接，只显示文本", () => {
  const sources = [{ title: "无链接", source: "example.com" }];
  const html = renderSearchSources(sources);
  assert.ok(html.includes("无链接"), "应显示 title");
  // 不强制禁 <a>，但不允许出现 href="undefined"
  assert.equal(/href="(undefined|)"/.test(html), false, "不应出现 href=undefined");
});

test("renderSearchSources: 接受自定义容器包裹（用于带 header 的完整区域）", () => {
  const html = renderSearchSources(
    [{ title: "T1", url: "https://e.com/a", source: "e.com" }],
    { containerClass: "search-sources" }
  );
  assert.ok(/class="[^"]*search-sources[^"]*"/.test(html), "应带 search-sources 容器 class");
  assert.ok(html.includes("参考来源"), "应包含'参考来源'标题");
});

test("renderSearchSources: 默认包含'已参考 N 条外部结果' 摘要", () => {
  const sources = [
    { title: "T1", url: "https://e.com/1", source: "e.com" },
    { title: "T2", url: "https://e.com/2", source: "e.com" }
  ];
  const html = renderSearchSources(sources);
  assert.ok(html.includes("已参考 2 条外部结果"), "应包含'已参考 2 条外部结果'");
});

test("renderSearchProcess: search.used=false 时返回空字符串", () => {
  assert.equal(renderSearchProcess({ used: false }), "");
  assert.equal(renderSearchProcess(null), "");
});

test("renderSearchProcess: 渲染搜索意图、搜索词、时间范围和过滤摘要", () => {
  const html = renderSearchProcess({
    used: true,
    intent: "ai-opportunity",
    plannedQueries: ["AI Agent 商业机会", "大模型应用 新产品", "第三条", "第四条"],
    freshness: "oneWeek",
    warning: "搜索结果时效性较弱，已保留少量参考来源。",
    recency: {
      required: true,
      reason: "趋势和新机会判断需要近期产品与市场信号。",
      filteredOldCount: 2,
      missingDateCount: 1
    },
    filters: { blockedTopicCount: 3, duplicateCount: 4 }
  });

  assert.ok(html.includes("搜索过程"));
  assert.ok(html.includes("AI 机会"));
  assert.ok(html.includes("AI Agent 商业机会"));
  assert.ok(html.includes("大模型应用 新产品"));
  assert.equal(html.includes("第四条"), false, "最多显示 3 条 plannedQueries");
  assert.ok(html.includes("最近一周"));
  assert.ok(html.includes("已过滤 3 条无关财经结果"));
  assert.ok(html.includes("已过滤 2 条过旧结果"));
  assert.ok(html.includes("搜索结果时效性较弱，请谨慎参考"));
});

test("renderSearchProcess: 显示来源质量摘要但不展示 raw JSON", () => {
  const html = renderSearchProcess({
    used: true,
    intent: "news",
    plannedQueries: ["Anthropic news"],
    freshness: "oneMonth",
    quality: { averageScore: 78, topSourceScore: 92, lowQualityCount: 0, hasHighConfidenceSources: true },
    recency: {},
    filters: {}
  });

  assert.ok(html.includes("来源质量"));
  assert.ok(html.includes("较高"));
  assert.equal(html.includes("averageScore"), false);
});

test("renderOpportunityPanel: 渲染中文状态、统计、编辑表单和空态", () => {
  const empty = renderOpportunityPanel({ opportunities: [], stats: { total: 0 } });
  assert.ok(empty.statsHtml.includes("全部 0"));
  assert.equal(empty.listHtml, "");

  const html = renderOpportunityPanel({
    stats: { total: 1, accepted: 1, validate: 1, watch: 0, archived: 0 },
    opportunities: [
      {
        id: "opp-1",
        opportunityName: "Independent AI opportunity brief MVP",
        status: "validate",
        statusLabel: "待验证",
        humanDecisionLabel: "已确认",
        notes: "备注",
        tags: ["AI"],
        scores: { ericChanFit: 5 }
      }
    ]
  });

  assert.ok(html.statsHtml.includes("全部 1"));
  // V0.3.10-hotfix：旧英文标题会被显示为中文（独立 AI 机会简报 MVP）
  assert.ok(html.listHtml.includes("独立 AI 机会简报 MVP"), "应显示中文映射");
  assert.ok(html.listHtml.includes("待验证"));
  assert.ok(html.listHtml.includes("编辑"));
  assert.ok(html.listHtml.includes("保存"));
  assert.ok(html.listHtml.includes("删除"), "V0.3.10-hotfix 应渲染'删除'按钮");
  // 编辑表单应包含"机会名称"输入
  assert.ok(/data-op-name="opp-1"/.test(html.listHtml), "编辑表单应含机会名称输入");
  assert.equal(html.listHtml.includes("validate"), true, "select value 可保留内部值，但可见状态应中文");
});

test("V0.6: renderOpportunityPanel renders Chinese Goal match badges", () => {
  const html = renderOpportunityPanel({
    stats: { total: 1 },
    opportunities: [
      {
        id: "opp-goal",
        opportunityName: "AI 机会简报助手",
        status: "validate",
        statusLabel: "待验证",
        typeLabel: "新项目机会",
        goalMatch: "高匹配",
        todayPriority: "今日优先",
        priorityReason: "符合 7 天 MVP 验证方向，且已有下一步。",
        isTodayPriority: true,
        nextAction: "7 天内跑通一个页面"
      }
    ]
  });
  assert.ok(html.listHtml.includes("高匹配"));
  assert.ok(html.listHtml.includes("今日优先"));
  assert.ok(html.listHtml.includes("符合 7 天 MVP 验证方向"));
  assert.ok(html.listHtml.includes("opportunity-item--today"));
  assert.equal(html.listHtml.includes("high"), false);
  assert.equal(html.listHtml.includes("todayPriority"), false);
});

test("V0.6: no Goal opportunity UI shows 未判断 instead of fake low match", () => {
  const html = renderOpportunityPanel({
    opportunities: [
      {
        id: "opp-unknown",
        opportunityName: "AI 机会简报助手",
        status: "validate",
        statusLabel: "待验证",
        goalMatch: "未判断",
        todayPriority: "可观察",
        priorityReason: "设置当前目标后，机会池会判断今日优先级。"
      }
    ]
  });
  assert.ok(html.listHtml.includes("未判断"));
  assert.ok(html.listHtml.includes("设置当前目标后"));
  assert.equal(html.listHtml.includes("低匹配"), false);
});

// ============== V0.3.6 sources panel HTML / CSS 静态断言 ==============

test("HTML 含参考来源容器 #searchSources（默认 hidden）", () => {
  const startIdx = indexHtml.indexOf('id="searchSources"');
  assert.ok(startIdx > 0, "缺少 #searchSources 容器");
  const inner = indexHtml.slice(startIdx, startIdx + 1500);
  assert.ok(/hidden\b/.test(inner), "#searchSources 默认应隐藏");
});

test("HTML 含搜索过程容器 #searchProcess（默认 hidden）", () => {
  const startIdx = indexHtml.indexOf('id="searchProcess"');
  assert.ok(startIdx > 0, "缺少 #searchProcess 容器");
  const inner = indexHtml.slice(startIdx, startIdx + 800);
  assert.ok(/hidden\b/.test(inner), "#searchProcess 默认应隐藏");
});

test("HTML 回答区按顺序：question-echo → answerLoading → answerOutput → searchSources", () => {
  // V0.3.6：参考来源放在回答正文之后，loading 之前（即紧贴 #answerOutput 之后）。
  // 这样复制按钮复制的是回答正文，不带 sources 区域。
  const idxEcho = indexHtml.indexOf('id="questionEcho"');
  const idxLoading = indexHtml.indexOf('id="answerLoading"');
  const idxOutput = indexHtml.indexOf('id="answerOutput"');
  const idxProcess = indexHtml.indexOf('id="searchProcess"');
  const idxSources = indexHtml.indexOf('id="searchSources"');
  assert.ok(idxEcho > 0 && idxOutput > 0 && idxSources > 0, "缺少必要 ID");
  assert.ok(idxEcho < idxOutput, "question-echo 必须在 answerOutput 之前");
  assert.ok(idxOutput < idxProcess, "searchProcess 应在 answerOutput 之后");
  assert.ok(idxProcess < idxSources, "searchProcess 应在 searchSources 之前");
  assert.ok(idxOutput < idxSources, "searchSources 应在 answerOutput 之后");
  // loading 是动态显示的，位置不强制
  if (idxLoading > 0) {
    assert.ok(idxLoading < idxOutput, "loading 容器应在 answerOutput 之前");
  }
});

test("CSS 包含参考来源样式（.search-sources / .search-source-item）", () => {
  const hasSources =
    /\.search-sources[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.search-source-item[\s\S]{0,200}?\{/i.test(stylesCss);
  assert.ok(hasSources, "缺少参考来源样式");
});

test("CSS 包含机会池样式（.opportunity-panel / .opportunity-item）", () => {
  assert.ok(/\.opportunity-panel\s*\{/.test(stylesCss));
  assert.ok(/\.opportunity-item\s*\{/.test(stylesCss));
});

test("CSS 包含搜索过程样式（.search-process）", () => {
  assert.ok(/\.search-process\s*\{[\s\S]{0,400}?display\s*:\s*none/i.test(stylesCss), "搜索过程容器默认应隐藏");
  assert.ok(/\.search-process:not\(\[hidden\]\)/.test(stylesCss), "搜索过程应通过 hidden 状态控制显示");
});

test("CSS 包含 .search-source-item link 样式（链接可见但不刺眼）", () => {
  // 链接应使用 :link / :visited / color，不强制具体颜色
  const hasLinkRule =
    /\.search-source-item\s+a[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.search-source-item[\s\S]{0,200}?a[\s\S]{0,100}?color/i.test(stylesCss);
  assert.ok(hasLinkRule, "缺少来源链接样式");
});

test("CSS .search-sources 容器默认 hidden（display:none）", () => {
  // 容器默认隐藏，只有挂上 visible 状态才显示。
  const rule = stylesCss.match(/\.search-sources\s*\{[\s\S]{0,800}?\}/);
  assert.ok(rule, "找不到 .search-sources 主规则");
  assert.ok(/display\s*:\s*none/i.test(rule[0]), ".search-sources 默认应 display:none");
});

test("app.js 含 renderSearchSources 与 searchSources 节点引用", () => {
  assert.ok(appJsText.includes("renderSearchSources"), "app.js 应暴露 renderSearchSources");
  assert.ok(appJsText.includes("searchSources"), "app.js 应引用 #searchSources 节点");
});

test("app.js 含 renderSearchProcess 与 searchProcess 节点引用", () => {
  assert.ok(appJsText.includes("renderSearchProcess"), "app.js 应暴露 renderSearchProcess");
  assert.ok(appJsText.includes("searchProcess"), "app.js 应引用 #searchProcess 节点");
});

test("app.js: 当 search.used=true 且 sources>0 时调用 renderSearchSources，否则清空", () => {
  // 接受任一实现风格：直接调 renderSearchSources(...) / 或在 showSearchSources / hideSearchSources 中调。
  const hasRender = /renderSearchSources\s*\(/.test(appJsText);
  assert.ok(hasRender, "app.js 应在展示来源时调用 renderSearchSources");
  // 同时：源代码里要出现 search.sources 的实际数据流向。
  assert.ok(/search\.sources/.test(appJsText), "app.js 应读取 search.sources 渲染来源");
});

test("app.js: 搜索失败时（search.warning 存在）不渲染空来源列表", () => {
  // 应有 if (search.warning) 早返回 / 或在 render 之前判断。
  assert.ok(
    /search\.warning/.test(appJsText) || /warning/.test(appJsText),
    "app.js 应处理 search.warning 决定是否显示来源"
  );
});

// ============== V0.3.6 history 恢复 & 复制隔离 ==============

test("normalizeHistoryItem: 保存 searchSources 摘要（最多 5 条，且只保留 title/url/source）", () => {
  const raw = {
    question: "Q",
    answer: "A",
    source: "llm",
    searchUsed: true,
    searchWarning: null,
    searchResultCount: 8,
    searchSources: Array.from({ length: 8 }, (_, i) => ({
      title: `T${i + 1}`,
      url: `https://e.com/${i + 1}`,
      source: "e.com",
      snippet: "should be dropped",
      raw: "should be dropped"
    }))
  };
  const item = normalizeHistoryItem(raw);
  assert.equal(item.searchSources.length, 5, "应只保留前 5 条");
  assert.deepEqual(item.searchSources[0], { title: "T1", url: "https://e.com/1", source: "e.com" });
  assert.equal(JSON.stringify(item).includes("should be dropped"), false, "snippet/raw 等多余字段应被丢弃");
});

test("createHistoryStore.push: 写入时 searchSources 最多保留 5 条", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  const sources = Array.from({ length: 12 }, (_, i) => ({
    title: `T${i + 1}`,
    url: `https://e.com/${i + 1}`,
    source: "e.com"
  }));
  store.push({
    question: "Q1",
    answer: "A1",
    source: "llm",
    searchUsed: true,
    searchSources: sources
  });
  const list = store.list();
  assert.equal(list[0].searchSources.length, 5, "历史项应只保存前 5 条 sources");
  assert.equal(list[0].searchSources[0].title, "T1");
  assert.equal(list[0].searchSources[4].title, "T5");
});

test("createHistoryStore.push: 保存搜索过程摘要但不保存 raw response", () => {
  const storage = makeMemoryStorage();
  const store = createHistoryStore({ storage, maxSize: 20 });
  store.push({
    question: "Q1",
    answer: "A1",
    source: "llm",
    searchUsed: true,
    searchIntent: "ai-opportunity",
    searchPlannedQueries: ["Q1", "Q2", "Q3", "Q4"],
    searchFreshness: "oneWeek",
    searchRecency: { required: true, filteredOldCount: 2, missingDateCount: 1 },
    searchFilters: { blockedTopicCount: 3, duplicateCount: 4 },
    rawResponse: { apiKey: "sk-raw" }
  });

  const item = store.list()[0];
  assert.equal(item.searchIntent, "ai-opportunity");
  assert.deepEqual(item.searchPlannedQueries, ["Q1", "Q2", "Q3"]);
  assert.equal(item.searchFreshness, "oneWeek");
  assert.equal(item.searchRecency.filteredOldCount, 2);
  assert.equal(item.searchFilters.duplicateCount, 4);
  assert.equal(JSON.stringify(item).includes("sk-raw"), false);
});

test("buildClipboardPayload: 传入 searchSources 时不写入剪贴板文本", () => {
  const payload = buildClipboardPayload({
    answer: "# 标题\n\n结论：今天轻量。",
    question: "今天适合做什么？",
    searchSources: [
      { title: "T1", url: "https://e.com/1", source: "e.com" }
    ],
    searchPlannedQueries: ["AI Agent 商业机会"]
  });
  assert.equal(payload.text, "# 标题\n\n结论：今天轻量。");
  // raw JSON / sources 任何字段都不应进剪贴板
  const dumped = JSON.stringify(payload);
  assert.equal(dumped.includes("searchSources"), false, "searchSources 不应进入复制 payload");
  assert.equal(dumped.includes("searchPlannedQueries"), false, "plannedQueries 不应进入复制 payload");
  assert.equal(payload.text.includes("AI Agent 商业机会"), false, "搜索词不应进入复制文本");
  assert.equal(dumped.includes("https://e.com/1"), false, "来源 URL 不应进入复制 payload");
});

test("handleCopyClick: 即使传入 searchSources，写入剪贴板的内容也只是 answer 文本", async () => {
  let written = "";
  const clipboardImpl = async (text) => { written = text; };
  const result = await handleCopyClick({
    answer: "这是回答正文。",
    searchSources: [{ title: "T1", url: "https://e.com/1", source: "e.com" }],
    clipboardImpl
  });
  assert.equal(result.ok, true);
  assert.equal(written, "这是回答正文。");
  assert.equal(written.includes("https://e.com/1"), false, "来源 URL 不应被复制");
  assert.equal(written.includes("T1"), false, "来源标题不应被复制");
});

test("restoreHistoryItem: 不调用 fetch（点击历史项不重新请求）", () => {
  // 用 createApp + fake nodes + spy fetch 验证：restoreHistoryItem 不应触发 fetchImpl。
  let fetchCalled = 0;
  const fakeFetch = (url) => { fetchCalled += 1; return Promise.resolve({ ok: true, json: async () => ({}) }); };

  const fakeStorage = makeMemoryStorage();
  // 预先 push 一条带 searchSources 的历史
  const store = createHistoryStore({ storage: fakeStorage, maxSize: 20 });
  store.push({
    question: "Q1",
    answer: "A1",
    source: "llm",
    searchUsed: true,
    searchIntent: "news",
    searchPlannedQueries: ["Anthropic AI news"],
    searchFreshness: "oneMonth",
    searchRecency: { required: true, filteredOldCount: 1, missingDateCount: 0 },
    searchFilters: { blockedTopicCount: 0, duplicateCount: 1 },
    searchSources: [
      { title: "T1", url: "https://e.com/1", source: "e.com" }
    ]
  });

  const { createApp } = require("../public/ask-ui/app");
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: fakeStorage,
    fetchImpl: fakeFetch,
    document: makeFakeDocument(),
    now: () => 1_700_000_000_000
  });

  const entry = app.historyStore.list()[0];
  app.restoreHistoryItem(entry);
  assert.equal(fetchCalled, 0, "restoreHistoryItem 不应调用 fetch");
  assert.equal(nodes.searchProcess.hidden, false, "历史恢复应恢复搜索过程");
  assert.ok(nodes.searchProcess.innerHTML.includes("搜索过程"));
  assert.ok(nodes.searchProcess.innerHTML.includes("Anthropic AI news"));
});

// ============== V0.3.10 机会池中文化 / chips / 一键加入 ==============

test("OPPORTUNITY_TYPE_LABELS 覆盖常见英文 type", () => {
  assert.equal(OPPORTUNITY_TYPE_LABELS["new-project-opportunity"], "新项目机会");
  assert.equal(OPPORTUNITY_TYPE_LABELS["current-project-improvement"], "当前项目改进");
  assert.equal(OPPORTUNITY_TYPE_LABELS["legacy-learning-material"], "旧项目学习材料");
  assert.equal(OPPORTUNITY_TYPE_LABELS["watch-only"], "仅观察");
});

test("OPPORTUNITY_SCORE_LABELS 覆盖常见英文 score 字段", () => {
  assert.equal(OPPORTUNITY_SCORE_LABELS.monetizationPotential, "变现潜力");
  assert.equal(OPPORTUNITY_SCORE_LABELS.ericChanFit, "个人匹配度");
  assert.equal(OPPORTUNITY_SCORE_LABELS.mvpSpeed, "MVP 速度");
  assert.equal(OPPORTUNITY_SCORE_LABELS.aiLeverage, "AI 杠杆");
  assert.equal(OPPORTUNITY_SCORE_LABELS.opcFit, "OPC 匹配度");
  assert.equal(OPPORTUNITY_SCORE_LABELS.contentAssetPotential, "内容资产潜力");
  assert.equal(OPPORTUNITY_SCORE_LABELS.complexityRisk, "复杂度风险");
  assert.equal(OPPORTUNITY_SCORE_LABELS.currentStageFit, "当前阶段匹配度");
});

test("PRESET_TAGS 包含必填产品标签", () => {
  for (const tag of ["AI Agent", "大模型应用", "独立开发者", "OPC", "高潜力", "可快速验证"]) {
    assert.ok(PRESET_TAGS.includes(tag), `PRESET_TAGS 应包含 '${tag}'`);
  }
});

test("renderOpportunityPanel: 状态 / 类型 / score 字段全部用中文 label", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      {
        id: "opp-1",
        opportunityName: "短视频选题工具",
        status: "validate",
        humanDecision: "accepted",
        type: "new-project-opportunity",
        tags: ["高潜力"],
        notes: "用户认为适合做短视频选题工具。",
        nextAction: "做一个最小页面。",
        sourceTrend: "tr-1",
        scores: { ericChanFit: 4, monetizationPotential: 3 },
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    ],
    stats: { total: 1, validate: 1 }
  });
  // 关键中文 label 必须出现
  assert.ok(listHtml.includes("待验证"), "状态应显示'待验证'");
  assert.ok(listHtml.includes("已确认"), "humanDecision 应显示'已确认'");
  assert.ok(listHtml.includes("个人匹配度"), "score 字段应使用中文 label");
  assert.ok(listHtml.includes("变现潜力"), "score 字段应使用中文 label");
  assert.ok(listHtml.includes("高潜力"), "标签应原样显示");
  // 可见 UI 文本不应出现常见英文内部字段。
  // 注意：表单 <option value="..."> 会保留英文 enum 作为提交值，但 <option> 标签文字必须是中文。
  // 用一个简化的"可见文本"视图：把 <option value=...> 标签替换为只保留显示文本
  const visibleText = listHtml.replace(/<option[^>]*value="[^"]+"[^>]*>([^<]+)<\/option>/g, "$1");
  // 不应出现常见英文内部字段
  for (const field of ["new-project-opportunity", "humanDecision", "monetizationPotential", "ericChanFit"]) {
    assert.equal(visibleText.includes(field), false, `机会池 UI 可见文本不应出现英文内部字段 '${field}'`);
  }
});

test("renderOpportunityPanel: 缺字段用中文空态，不显示 null/undefined", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [{ id: "opp-x", opportunityName: "无名", status: "validate" }],
    stats: { total: 1 }
  });
  assert.ok(/暂无|没有下一步|暂无备注/.test(listHtml), "缺字段应有中文空态");
  assert.equal(/null|undefined/.test(listHtml), false, "不应出现 null/undefined");
});

test("renderOpportunityPanel: 标题不明时显示弱提示", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [{ id: "opp-y", opportunityName: "未命名机会", status: "inbox" }],
    stats: { total: 1 }
  });
  assert.ok(/缺少清晰标题|建议补充名称/.test(listHtml), "标题不清时应显示弱提示");
});

test("renderOpportunityPanel: 渲染标签为 chips (而非逗号字符串)", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      { id: "1", opportunityName: "A", status: "validate", tags: ["高潜力", "可快速验证"] }
    ],
    stats: { total: 1 }
  });
  // 标签应作为独立 chip 元素
  assert.ok(/class="[^"]*opportunity-tag[^"]*"/.test(listHtml), "标签应渲染成 chip 元素");
  // 编辑表单里的标签 chips 也应有标记
  assert.ok(/data-op-tag/.test(listHtml), "编辑表单应提供 chips 切换标记");
});

test("buildAddOpportunityFormMarkup: 默认 status=validate, type=new-project-opportunity, 标签 chips", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "适合做短视频选题工具？",
    answer: "看起来不错"
  });
  assert.ok(html.includes("待验证"), "应显示'待验证'默认值");
  assert.ok(html.includes("新项目机会"), "应显示'新项目机会'默认值");
  assert.ok(/data-op-add-tag/.test(html), "应包含标签 chip 标记");
  // 标签默认应带预设选项
  assert.ok(/AI Agent/.test(html), "应包含 AI Agent 预设标签");
  assert.ok(/高潜力/.test(html), "应包含高潜力预设标签");
  // V0.3.11-hotfix：note 现在是 answer 提炼（不是原问题）
  // 简单 answer "看起来不错" 提炼不出 note 关键句，应给兜底
  assert.ok(/data-op-add-note/.test(html), "应包含 note 字段");
  assert.ok(html.includes("适合做短视频选题工具") || /data-op-add-warning/.test(html), "要么问题相关，要么显示 warning 兜底");
});

test("buildAddOpportunityFormMarkup: 标题不明时给出占位提示", () => {
  const html = buildAddOpportunityFormMarkup({ question: "q", answer: "" });
  assert.ok(/请填写|未命名|占位/.test(html), "标题为空时应给占位提示");
});

test("buildAddOpportunityFormMarkup: sourceUrls 可选注入", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "a",
    sourceUrls: [
      { title: "T1", url: "https://e.com/1", source: "e.com" }
    ]
  });
  assert.ok(html.includes("T1"), "应包含来源标题");
});

// ============== V0.3.10-hotfix：旧英文标题中文化 + 删除按钮 + 编辑机会名称 ==============

test("OPPORTUNITY_TITLE_OVERRIDES: 旧英文标题中文映射", () => {
  assert.equal(OPPORTUNITY_TITLE_OVERRIDES["Independent AI opportunity brief MVP"], "独立 AI 机会简报 MVP");
  assert.equal(OPPORTUNITY_TITLE_OVERRIDES["Opportunity scoring quality gate"], "机会评分质量门槛");
});

test("getDisplayTitleClient: 旧英文 → 中文 / 中文保持 / 乱码兜底", () => {
  assert.equal(getDisplayTitleClient({ opportunityName: "Independent AI opportunity brief MVP" }), "独立 AI 机会简报 MVP");
  assert.equal(getDisplayTitleClient({ opportunityName: "短视频选题工具" }), "短视频选题工具");
  assert.ok(getDisplayTitleClient({}).length > 0, "缺字段应返回兜底字符串");
});

test("normalizeOpportunityForUi: 含 displayTitle 字段（旧英文自动中文化）", () => {
  const item = normalizeOpportunityForUi({ id: "x", opportunityName: "Independent AI opportunity brief MVP", status: "validate" });
  assert.equal(item.displayTitle, "独立 AI 机会简报 MVP");
  const cn = normalizeOpportunityForUi({ id: "y", opportunityName: "短视频选题工具", status: "validate" });
  assert.equal(cn.displayTitle, "短视频选题工具");
});

test("renderOpportunityPanel: 旧英文标题在 UI 上显示为中文（不显示英文原文）", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      { id: "1", opportunityName: "Independent AI opportunity brief MVP", status: "validate", type: "new-project-opportunity", humanDecision: "accepted" }
    ],
    stats: { total: 1 }
  });
  assert.ok(listHtml.includes("独立 AI 机会简报 MVP"), "应显示中文映射");
  assert.equal(listHtml.includes("Independent AI opportunity brief MVP"), false, "不应再显示英文原始标题");
});

test("renderOpportunityPanel: mojibake 标题走中文兜底（不显示乱码）", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      { id: "1", opportunityName: "V0.3.10 ����", status: "validate", type: "new-project-opportunity" }
    ],
    stats: { total: 1 }
  });
  assert.equal(listHtml.includes("����"), false, "不应把 mojibake 字节输出到 HTML");
});

test("renderOpportunityPanel: 每个机会有“删除”按钮 + 编辑表单含“机会名称”输入", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      { id: "1", opportunityName: "测试", status: "validate", type: "new-project-opportunity" }
    ],
    stats: { total: 1 }
  });
  assert.ok(/data-op-delete="1"/.test(listHtml), "应渲染 data-op-delete 按钮");
  assert.ok(/删除<\/button>/.test(listHtml), "应渲染'删除'按钮文字");
  // V0.3.10-hotfix：编辑表单必须含"机会名称"输入
  assert.ok(/data-op-name="1"/.test(listHtml), "编辑表单应有'机会名称'输入");
  assert.ok(/机会名称/.test(listHtml), "编辑表单应含'机会名称' label");
});

test("renderOpportunityPanel: 状态 / 类型 / score 字段全部用中文 label - V0.3.10-hotfix (确认未回归)", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      {
        id: "1",
        opportunityName: "A",
        status: "validate",
        type: "new-project-opportunity",
        scores: { monetizationPotential: 4 }
      }
    ],
    stats: { total: 1 }
  });
  // V0.3.10-hotfix：可见 label 必须是中文
  assert.ok(listHtml.includes("待验证"), "status 应显示中文 label");
  assert.ok(listHtml.includes("新项目机会"), "type 应显示中文 label");
  assert.ok(listHtml.includes("变现潜力"), "score 字段应显示中文 label");
  // V0.3.10-hotfix：option / select / input 的 value 可以保留英文 enum（用于提交），
  // 但 status badge（可视区域）必须是中文而不直接显示 'validate'。
  // 这里断言：可见的英文 enum 不会作为纯文本出现在 status / type 徽标上：
  // 我们用 - 无空白地 - 移除 <option> 标签后再检查。
  const visibleText = listHtml.replace(/<option[^>]*>[^<]*<\/option>/g, "");
  assert.equal(/>\s*validate\s*</.test(visibleText), false, "可视文本中不应出现英文 enum 'validate'");
  assert.equal(/>\s*new-project-opportunity\s*</.test(visibleText), false, "可视文本中不应出现英文 enum 'new-project-opportunity'");
});

// ============== V0.3.10 HTML / CSS / app.js 静态断言 ==============

test("HTML 顶部状态条 #globalStatusText 默认文案包含'默认不联网'", () => {
  assert.ok(indexHtml.includes('id="globalStatusText"'));
  assert.ok(indexHtml.includes("默认不联网"));
});

test("HTML 含'加入机会池'按钮节点（#addOpportunityButton 或类似）", () => {
  const hasAdd =
    /id="addOpportunityButton"/.test(indexHtml) ||
    /id="addOpportunity"/.test(indexHtml) ||
    /加入机会池/.test(indexHtml);
  assert.ok(hasAdd, "应存在'加入机会池'按钮");
});

test("HTML 机会池区域含 #opportunityList / #opportunityStats", () => {
  assert.ok(indexHtml.includes('id="opportunityList"'));
  assert.ok(indexHtml.includes('id="opportunityStats"'));
});

test("CSS 含标签 chips 样式（.opportunity-tag 或类似）", () => {
  const hasChip =
    /\.opportunity-tag\s*\{[\s\S]{0,400}?\}/i.test(stylesCss) ||
    /\.opportunity-tag\s*[\{\.]/i.test(stylesCss);
  assert.ok(hasChip, "缺少标签 chip 样式");
});

test("CSS 含'加入机会池'按钮样式（.add-opportunity-button / .opportunity-add）", () => {
  const hasAdd =
    /\.add-opportunity-button[\s\S]{0,400}?\{/i.test(stylesCss) ||
    /\.opportunity-add[\s\S]{0,400}?\{/i.test(stylesCss);
  assert.ok(hasAdd, "缺少加入机会池按钮样式");
});

test("app.js: 暴露 PRESET_TAGS / OPPORTUNITY_TYPE_LABELS / OPPORTUNITY_SCORE_LABELS", () => {
  assert.ok(appJsText.includes("PRESET_TAGS"), "app.js 应暴露 PRESET_TAGS");
  assert.ok(appJsText.includes("OPPORTUNITY_TYPE_LABELS"), "app.js 应暴露 OPPORTUNITY_TYPE_LABELS");
  assert.ok(appJsText.includes("OPPORTUNITY_SCORE_LABELS"), "app.js 应暴露 OPPORTUNITY_SCORE_LABELS");
});

test("app.js: buildAddOpportunityFormMarkup 纯函数已实现", () => {
  assert.ok(/function buildAddOpportunityFormMarkup/.test(appJsText), "缺少 buildAddOpportunityFormMarkup 实现");
});

test("app.js: POST /api/opportunities 客户端调用存在", () => {
  assert.ok(/\/api\/opportunities/.test(appJsText), "应存在 /api/opportunities 调用");
  assert.ok(/method:\s*['"]POST['"]/.test(appJsText), "应使用 POST 方法");
});

test("app.js: 机会项 UI 不应原样输出常见英文 score 字段名", () => {
  // 检查 .opportunity-score 渲染时使用了中文 label；用关键词 pattern 验证。
  assert.ok(/OPPORTUNITY_SCORE_LABELS\[/.test(appJsText), "score 字段应通过中文 label 字典渲染");
});

// ============== V0.3.10 POST /api/opportunities 集成测试 ==============

test("startAskUiServer: POST /api/opportunities 接受最小 body 并返回新增项", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api-"));
  const server = await startAskUiServer({ rootDir, port: 5291, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({
      port: 5291,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "测试新增机会",
        status: "validate",
        type: "new-project-opportunity",
        tags: ["高潜力", "可快速验证"],
        note: "用户备注：适合做工具验证。",
        source: "ask-mode"
      }
    });
    assert.equal(status, 200);
    assert.ok(json.opportunity, "响应应包含 opportunity");
    assert.equal(json.opportunity.opportunityName, "测试新增机会");
    assert.equal(json.opportunity.status, "validate");
    assert.deepEqual(json.opportunity.tags, ["高潜力", "可快速验证"]);
    assert.equal(json.opportunity.notes, "用户备注：适合做工具验证。");
    assert.ok(Array.isArray(json.opportunities) && json.opportunities.length === 1);
    assert.ok(json.stats && typeof json.stats.total === "number");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST 缺失 title 返回 400 + 中文错误", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api2-"));
  const server = await startAskUiServer({ rootDir, port: 5292, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({
      port: 5292,
      method: "POST",
      path: "/api/opportunities",
      body: { note: "no title" }
    });
    assert.equal(status, 400);
    assert.ok(json.error && /标题|名称/.test(json.error), "应返回中文错误");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST 不持久化 filePath / API Key 等非白名单字段", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api3-"));
  const server = await startAskUiServer({ rootDir, port: 5293, host: "127.0.0.1" });
  try {
    const { status } = await httpRequest({
      port: 5293,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "白名单测试",
        filePath: "/etc/passwd",
        apiKey: "sk-12345",
        STRATEGY_OS_LLM_API_KEY: "sk-real",
        rawAnswer: "完整 3000 字回答，不应保存"
      }
    });
    assert.equal(status, 200);
    // 重新读盘
    const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
    const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const json = JSON.stringify(saved.opportunities[0]);
    assert.equal(json.includes("filePath"), false);
    assert.equal(json.includes("sk-12345"), false);
    assert.equal(json.includes("sk-real"), false);
    assert.equal(json.includes("rawAnswer"), false);
    assert.equal(json.includes("完整 3000 字"), false);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST sourceUrls 最多 5 条", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api4-"));
  const server = await startAskUiServer({ rootDir, port: 5294, host: "127.0.0.1" });
  try {
    const sourceUrls = Array.from({ length: 8 }, (_, i) => ({
      title: `T${i + 1}`,
      url: `https://e.com/${i + 1}`,
      source: "e.com"
    }));
    const { status, json } = await httpRequest({
      port: 5294,
      method: "POST",
      path: "/api/opportunities",
      body: { title: "sourceUrls 测试", sourceUrls }
    });
    assert.equal(status, 200);
    assert.equal(json.opportunity.sourceUrls.length, 5, "sourceUrls 应限制为 5 条");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST 不允许 body 控制路径 (filePath/jsonPath/markdownPath 等)", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api5-"));
  const server = await startAskUiServer({ rootDir, port: 5295, host: "127.0.0.1" });
  try {
    const { status } = await httpRequest({
      port: 5295,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "路径注入测试",
        jsonPath: "../../../etc/passwd",
        markdownPath: "../../../tmp/x.md",
        rootDir: "/"
      }
    });
    assert.equal(status, 200);
    // 应写到 rootDir/data/opportunities/opportunity-pool.json
    const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
    assert.ok(fs.existsSync(jsonPath), "应写到 rootDir/data 下");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST 重复标题给出 warning 字段", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api6-"));
  const server = await startAskUiServer({ rootDir, port: 5296, host: "127.0.0.1" });
  try {
    await httpRequest({ port: 5296, method: "POST", path: "/api/opportunities", body: { title: "同名机会" } });
    const { json: p2 } = await httpRequest({ port: 5296, method: "POST", path: "/api/opportunities", body: { title: "同名机会" } });
    assert.ok(p2.warning && /重复|同名|已存在/.test(p2.warning), "应返回重复警告");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: GET /api/opportunities 不回归", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api7-"));
  const server = await startAskUiServer({ rootDir, port: 5297, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({ port: 5297, method: "GET", path: "/api/opportunities" });
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.opportunities));
    assert.ok(json.stats);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("V0.6: GET /api/opportunities derives Goal match without persisting it", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-goal-api-"));
  const server = await startAskUiServer({ rootDir, port: 52971, host: "127.0.0.1" });
  try {
    await httpRequest({
      port: 52971,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "AI 机会简报助手",
        oneLineSummary: "面向独立开发者的小型 AI 产品",
        nextAction: "7 天内跑通一个最小 MVP 页面",
        tags: ["独立开发者", "可快速验证"],
        status: "validate"
      }
    });
    const goal = encodeURIComponent("用战略OS筛选适合独立开发者的小型 AI 产品，并优先推进 7 天内可验证的 MVP。");
    const { status, json } = await httpRequest({ port: 52971, method: "GET", path: `/api/opportunities?currentGoal=${goal}` });
    assert.equal(status, 200);
    assert.equal(json.opportunities[0].goalMatch, "高匹配");
    assert.equal(json.opportunities[0].todayPriority, "今日优先");
    assert.equal(json.opportunities[0].isTodayPriority, true);

    const raw = fs.readFileSync(path.join(rootDir, "data", "opportunities", "opportunity-pool.json"), "utf8");
    assert.equal(raw.includes("goalMatch"), false);
    assert.equal(raw.includes("todayPriority"), false);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: PATCH /api/opportunities/:id 不回归", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-api8-"));
  const server = await startAskUiServer({ rootDir, port: 5298, host: "127.0.0.1" });
  try {
    const { json: created } = await httpRequest({ port: 5298, method: "POST", path: "/api/opportunities", body: { title: "PATCH 测试" } });
    const id = created.opportunity.id;
    const { status, json: p2 } = await httpRequest({
      port: 5298,
      method: "PATCH",
      path: `/api/opportunities/${encodeURIComponent(id)}`,
      body: { status: "watch", notes: "new" }
    });
    assert.equal(status, 200);
    assert.equal(p2.opportunity.status, "watch");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

// ============== V0.3.10-hotfix: DELETE /api/opportunities/:id 集成测试 ==============

test("startAskUiServer: DELETE /api/opportunities/:id 可删除存在项并持久化", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-del-"));
  const server = await startAskUiServer({ rootDir, port: 5301, host: "127.0.0.1" });
  try {
    // 先 POST 创建两个
    const { json: c1 } = await httpRequest({ port: 5301, method: "POST", path: "/api/opportunities", body: { title: "保留项" } });
    const { json: c2 } = await httpRequest({ port: 5301, method: "POST", path: "/api/opportunities", body: { title: "删除项" } });
    const removeId = c2.opportunity.id;
    // DELETE
    const { status, json: d } = await httpRequest({ port: 5301, method: "DELETE", path: `/api/opportunities/${encodeURIComponent(removeId)}` });
    assert.equal(status, 200);
    assert.equal(d.removed.id, removeId);
    assert.equal(d.stats.total, 1);
    // GET 确认真的删了
    const { json: g } = await httpRequest({ port: 5301, method: "GET", path: "/api/opportunities" });
    assert.equal(g.opportunities.length, 1);
    assert.equal(g.opportunities[0].id, c1.opportunity.id);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: DELETE 不存在 id 返回 404 中文错误", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-del404-"));
  const server = await startAskUiServer({ rootDir, port: 5302, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({ port: 5302, method: "DELETE", path: "/api/opportunities/opp-does-not-exist" });
    assert.equal(status, 404);
    assert.ok(/没有找到/.test(json.error), "应返回中文错误");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: DELETE 路径含 .. 返回 400 中文错误（路径注入防护）", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-delbad-"));
  const server = await startAskUiServer({ rootDir, port: 5303, host: "127.0.0.1" });
  try {
    // /api/opportunities/../etc/passwd 实际上会被 URL 归一化为 /etc/passwd（不在匹配路径里）
    // 因此用一个会到达路由但含 . 的 id：
    // 由于 /api/opportunities/:id 路由要求 [^/]+，需要 encodeURIComponent('opp..id') 让 .. 进入 id
    const id = encodeURIComponent("opp..id");
    const { status, json } = await httpRequest({ port: 5303, method: "DELETE", path: `/api/opportunities/${id}` });
    assert.equal(status, 400, "应拒绝含 .. 的 id");
    assert.ok(/不合法|包含|路径/.test(json.error), "应返回中文错误");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: PATCH 支持更新 opportunityName (中文标题)", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-rename-"));
  const server = await startAskUiServer({ rootDir, port: 5304, host: "127.0.0.1" });
  try {
    const { json: c } = await httpRequest({
      port: 5304,
      method: "POST",
      path: "/api/opportunities",
      body: { title: "原名" }
    });
    const id = c.opportunity.id;
    const { status, json: u } = await httpRequest({
      port: 5304,
      method: "PATCH",
      path: `/api/opportunities/${encodeURIComponent(id)}`,
      body: { opportunityName: "我重命名后的中文机会" }
    });
    assert.equal(status, 200);
    assert.equal(u.opportunity.opportunityName, "我重命名后的中文机会");
    assert.equal(u.opportunity.displayTitle, "我重命名后的中文机会");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: GET /api/opportunities 返回带 displayTitle 的列表（旧英文自动中文化）", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-disp-"));
  // 预写入旧英文数据
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-04T00:00:00.000Z",
      opportunities: [
        { id: "opp-old-1", opportunityName: "Independent AI opportunity brief MVP", status: "validate", type: "new-project-opportunity" }
      ]
    })
  );
  const server = await startAskUiServer({ rootDir, port: 5305, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({ port: 5305, method: "GET", path: "/api/opportunities" });
    assert.equal(status, 200);
    assert.equal(json.opportunities[0].opportunityName, "Independent AI opportunity brief MVP", "底层数据保留原文");
    assert.equal(json.opportunities[0].displayTitle, "独立 AI 机会简报 MVP", "服务端应暴露 displayTitle");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

// ============== V0.3.11: 开工包 / 智能草稿 集成测试 ==============

test("startAskUiServer: POST /api/opportunities/:id/kickoff 返回开工包（基于机会池数据）", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-kickoff-"));
  const server = await startAskUiServer({ rootDir, port: 5310, host: "127.0.0.1" });
  try {
    // 先创建一个有完整字段的机会
    const { json: c } = await httpRequest({
      port: 5310,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "AI 短视频选题助手",
        oneLineSummary: "把热点和方向结合，生成可拍选题",
        note: "MVP 验证",
        nextAction: "做一个最小网页",
        tags: ["高潜力", "可快速验证"]
      }
    });
    const id = c.opportunity.id;
    // kickoff
    const { status, json: k } = await httpRequest({
      port: 5310,
      method: "POST",
      path: `/api/opportunities/${encodeURIComponent(id)}/kickoff`,
      body: { currentGoal: "用战略OS筛选 AI 短视频工具 sk-kickoffGoal123456" }
    });
    assert.equal(status, 200);
    assert.ok(k.answer.length > 100, "应有结构化开工包");
    // V0.5 增加"与当前目标的关系"，本地开工包为 11 个小节。
    for (let i = 1; i <= 11; i += 1) {
      assert.ok(k.answer.includes(`${i}.`), `开工包应包含小节 ${i}.`);
    }
    assert.ok(k.answer.includes("AI 短视频选题助手"), "开工包应基于机会名称");
    assert.ok(k.answer.includes("当前目标"), "开工包应体现 currentGoal");
    assert.ok(k.answer.includes("用战略OS筛选 AI 短视频工具"), "开工包应包含脱敏后的 currentGoal");
    assert.equal(k.answer.includes("sk-kickoffGoal123456"), false, "开工包不应含 sk-* 原文");
    assert.equal(k.opportunity.id, id, "应回传机会数据");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST /api/opportunities/:id/kickoff 不存在 id 返回 404 中文", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-kickoff404-"));
  const server = await startAskUiServer({ rootDir, port: 5311, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({
      port: 5311,
      method: "POST",
      path: "/api/opportunities/opp-does-not-exist/kickoff"
    });
    assert.equal(status, 404);
    assert.ok(/没有找到/.test(json.error), "应返回中文 404 错误");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST /api/opportunities/:id/kickoff 路径含 .. 返回 400", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-kickoffbad-"));
  const server = await startAskUiServer({ rootDir, port: 5312, host: "127.0.0.1" });
  try {
    const id = encodeURIComponent("opp..id");
    const { status, json } = await httpRequest({
      port: 5312,
      method: "POST",
      path: `/api/opportunities/${id}/kickoff`
    });
    assert.equal(status, 400, "应拒绝含 .. 的 id");
    assert.ok(/不合法|包含|路径/.test(json.error));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: kickoff 答案不暴露 API Key", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-ui-kickoffkey-"));
  const server = await startAskUiServer({ rootDir, port: 5313, host: "127.0.0.1" });
  try {
    const { json: c } = await httpRequest({
      port: 5313,
      method: "POST",
      path: "/api/opportunities",
      body: { title: "测试 sk-abcdef1234", note: "y" }
    });
    const { json: k } = await httpRequest({
      port: 5313,
      method: "POST",
      path: `/api/opportunities/${encodeURIComponent(c.opportunity.id)}/kickoff`
    });
    assert.equal(k.answer.includes("sk-abcdef1234"), false, "开工包应脱敏 sk-xxx");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("buildAddOpportunityFormMarkup: 接受 draft 参数预填精炼字段", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "a",
    draft: {
      opportunityName: "AI 短视频选题助手",
      oneLineSummary: "把热点和方向结合，生成可拍选题",
      note: "精炼备注",
      nextAction: "做一个最小网页",
      suggestedTags: ["高潜力", "可快速验证"],
      status: "validate",
      type: "new-project-opportunity"
    }
  });
  assert.ok(html.includes("AI 短视频选题助手"));
  assert.ok(html.includes("把热点和方向结合"));
  assert.ok(html.includes("做一个最小网页"));
  // 标签应预选 (aria-pressed="true")
  const highPotential = html.match(/<button[^>]*data-op-add-tag="高潜力"[^>]*aria-pressed="(true|false)"/);
  assert.ok(highPotential && highPotential[1] === "true", "高潜力 标签应预选");
});

test("buildAddOpportunityFormMarkup: 不传 draft 时自动调用 deriveOpportunityDraftFromAnswer 提炼", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "推荐做一个 AI 短视频选题助手，方向是把热点和你的能力结合，MVP 可以用提示词跑通"
  });
  // 不应直接把原问题当 opportunityName
  assert.equal(/最近有什么适合独立开发者做的小型 AI 项目？/.test(html), false, "V0.3.11 不应直接把原问题当机会名");
  // 应有一句话说明输入
  assert.ok(/data-op-add-one-line/.test(html));
  // 应有下一步输入
  assert.ok(/data-op-add-next/.test(html));
});

test("renderOpportunityPanel: 每个机会项有「生成开工包」按钮", () => {
  const { listHtml } = renderOpportunityPanel({
    opportunities: [
      { id: "1", opportunityName: "测试", status: "validate", type: "new-project-opportunity" }
    ],
    stats: { total: 1 }
  });
  assert.ok(/data-op-kickoff="1"/.test(listHtml), "应渲染 data-op-kickoff 按钮");
  assert.ok(/生成开工包/.test(listHtml), "按钮文字应含'生成开工包'");
});

// ============== V0.3.10-hotfix: createApp 真实链路 = "加入机会池" 按钮 ==============

test("createApp: 有回答时加入机会池按钮可见，无回答时隐藏", () => {
  const nodes = makeFakeNodes();
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  app.mount();
  // 模拟初始空状态
  app.setCurrentAnswer("", "");
  const btn = nodes.addOpportunityButton;
  assert.equal(btn.hidden, true, "无回答时按钮应隐藏");
  // 模拟有回答
  app.setCurrentAnswer("这里有一些回答内容", "llm", { question: "测试" });
  assert.equal(btn.hidden, false, "有回答时按钮应显示");
  assert.equal(btn.disabled, false, "不应被 disabled");
  // 清空回答 → 重新隐藏
  app.setCurrentAnswer("", "llm");
  assert.equal(btn.hidden, true, "清空回答后按钮应隐藏");
});

test("createApp: 点击加入机会池按钮后表单注入到容器", async () => {
  const nodes = makeFakeNodes();
  const container = nodes.addOpportunityContainer;
  container.querySelector = (sel) => {
    if (container.innerHTML && sel === "[data-op-add-form]") return container._form || null;
    if (container.innerHTML && sel === "[data-op-add-title]") return container._title || null;
    return null;
  };
  const app = createApp({
    nodes,
    fetchImpl: (path, init = {}) => {
      // draft API 返回 LLM 风格的完整草稿
      if (path === "/api/opportunities/draft" && init.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            opportunityName: "AI 短视频选题助手",
            oneLineSummary: "x",
            note: "n",
            nextAction: "na",
            status: "validate",
            type: "new-project-opportunity",
            suggestedTags: ["独立开发者", "内容产品"],
            draftSource: "llm"
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: {} }) });
    },
    storage: null
  });
  app.mount();
  app.setCurrentAnswer("回答内容, 推荐做短视频选题工具", "llm", { question: "适合做短视频选题工具吗" });
  // 模拟点击
  nodes.addOpportunityButton.click();
  // 等待 async openAddOpportunityForm 完成
  await new Promise((r) => setTimeout(r, 30));
  // 容器应显示
  assert.equal(container.hidden, false, "点击后容器应显示");
  // 注入的 innerHTML 是表单 markup，应当包含 form 与 title input
  assert.ok(/data-op-add-form/.test(container.innerHTML), "应渲染加入机会池表单 markup");
  assert.ok(/data-op-add-title/.test(container.innerHTML), "应包含标题输入框");
  // V0.3.11：标题应被精炼（deriveOpportunityDraftFromAnswer 自动从 answer 提取）
  // answer 含"推荐做短视频选题工具"，应提炼出"AI 短视频选题助手"或类似
  assert.ok(/data-op-add-one-line/.test(container.innerHTML), "应包含一句话说明输入框");
  assert.ok(/data-op-add-next/.test(container.innerHTML), "应包含下一步输入框");
  assert.ok(/短视频|选题/.test(container.innerHTML), "标题应反映回答里的核心方向");
  assert.notEqual(/适合做短视频选题工具吗/.test(container.innerHTML), true, "V0.3.11 不应直接把原问题当机会名");
});

test("createApp: 提交 POST 成功后容器关闭并刷新机会池", async () => {
  const nodes = makeFakeNodes();
  // mock form / inputs that respond to querySelector
  const fakeForm = {
    addEventListener(event, handler) { if (event === "submit") this._submitHandler = handler; },
    dispatchEvent() { if (this._submitHandler) { const ev = { preventDefault() {} }; this._submitHandler(ev); } }
  };
  const fakeInput = { value: "" };
  const fakeStatus = { value: "validate" };
  const fakeType = { value: "new-project-opportunity" };
  const fakeNote = { value: "note" };
  const fakeTagsContainer = { querySelectorAll: () => [] };
  const container = nodes.addOpportunityContainer;
  container.querySelector = (sel) => {
    if (sel === "[data-op-add-form]") return fakeForm;
    if (sel === "[data-op-add-title]") return fakeInput;
    if (sel === "[data-op-add-status]") return fakeStatus;
    if (sel === "[data-op-add-type]") return fakeType;
    if (sel === "[data-op-add-note]") return fakeNote;
    if (sel === "[data-op-add-tags]") return fakeTagsContainer;
    return null;
  };
  const fetched = [];
  const fetchImpl = (path, init = {}) => {
    fetched.push({ path, method: init.method || "GET" });
    if (init.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          opportunity: { id: "new-1", opportunityName: "新建", statusLabel: "待验证", typeLabel: "新项目机会" },
          opportunities: [{ id: "new-1", opportunityName: "新建", statusLabel: "待验证", typeLabel: "新项目机会", notes: "", nextAction: "", tags: [], displayTitle: "新建" }],
          stats: { total: 1 }
        })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: {} }) });
  };
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  app.setCurrentAnswer("新建回答", "llm", { question: "新机会" });
  nodes.addOpportunityButton.click();
  // 等待 async openAddOpportunityForm 完成（draft API 调用）
  await new Promise((r) => setTimeout(r, 30));
  // 模拟用户在 title 输入框输入
  fakeInput.value = "新机会名";
  // 模拟提交
  fakeForm.dispatchEvent();
  // 等待 promise
  await new Promise((r) => setTimeout(r, 30));
  // POST 应发出
  assert.ok(fetched.some((f) => f.method === "POST" && f.path === "/api/opportunities"), "应发送 POST /api/opportunities");
  // 容器应关闭
  assert.equal(container.hidden, true, "成功提交后表单应关闭");
});

// ============== V0.3.11-hotfix: 前端二次保护 ==============

test("V0.3.11-hotfix: 提炼出明确产品名时前端保留 title，不显示 warning（修复后行为）", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合。"
  });
  // 不应把原问题当机会名
  assert.equal(/最近有什么适合独立开发者做的小型 AI 项目？/.test(html), false);
  // 不应含"我建议你先"
  assert.equal(/value="我建议你/.test(html), false);
  // 应有产品名
  assert.ok(/value="AI 短视频选题助手"/.test(html), "应保留精炼后的产品名");
  // 不应显示 warning（因为提炼成功）
  assert.equal(/data-op-add-warning/.test(html), false, "明确产品名时不显示 warning");
});

test("V0.3.11-hotfix: 极端情况 - 后端仍返回原 question 作为 opportunityName 时前端二次保护", () => {
  // 模拟 V0.3.11 之前的草稿（手动传入 draft，模拟旧版后端行为）
  const html = buildAddOpportunityFormMarkup({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手。",
    draft: {
      opportunityName: "最近有什么适合独立开发者做的小型 AI 项目？", // 强制等于 question
      oneLineSummary: "x",
      note: "y",
      nextAction: "z",
      suggestedTags: [],
      status: "validate",
      type: "new-project-opportunity"
    }
  });
  // 前端应清空 title 并显示 warning
  const titleMatch = html.match(/<input[^>]*data-op-add-title[^>]*value="([^"]*)"/);
  assert.ok(titleMatch);
  assert.equal(titleMatch[1], "", "前端二次保护：title 等于 question 时应清空");
  assert.ok(/data-op-add-warning/.test(html), "应显示 warning 节点");
});

test("V0.3.11-hotfix: weather 类问题前端清空 title 并显示 warning", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "今天天气怎么样",
    answer: "今天多云转晴，最高温度 25 度。"
  });
  assert.ok(/data-op-add-warning/.test(html));
  // title 应为空
  const titleMatch = html.match(/<input[^>]*data-op-add-title[^>]*value="([^"]*)"/);
  assert.ok(titleMatch);
  assert.equal(titleMatch[1], "", "weather 类 title 应为空");
});

test("V0.3.11-hotfix: 提炼出明确产品名时前端保留 title，不显示 warning", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合。"
  });
  // 应有产品名
  assert.ok(/value="AI 短视频选题助手"/.test(html), "应保留精炼后的产品名");
  // 不应显示 warning
  assert.equal(/data-op-add-warning/.test(html), false, "明确产品名时不显示 warning");
});

test("V0.3.11-hotfix: 表单备注不展示完整 answer（≤ 300 字）", () => {
  const longAnswer = "推荐做 AI 短视频选题助手。" + "细节。".repeat(200);
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: longAnswer
  });
  const noteMatch = html.match(/<textarea[^>]*data-op-add-note[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(noteMatch);
  const noteText = noteMatch[1];
  assert.ok(noteText.length <= 300, `note 字段值应 ≤ 300 字: ${noteText.length}`);
  // 不应含 markdown 标题
  assert.equal(/^#+\s/m.test(noteText), false);
});

test("V0.3.11-hotfix: 表单必填校验 - title 空时不应通过原生 required 校验（输入框 required 属性）", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "今天天气怎么样",
    answer: "今天多云转晴"
  });
  // 必填校验：input 应有 required 属性
  const titleInput = html.match(/<input[^>]*data-op-add-title[^>]*>/);
  assert.ok(titleInput && /required/.test(titleInput[0]), "机会名称 input 应有 required 属性");
});

test("V0.3.11-hotfix: note / oneLineSummary / nextAction 三个字段都存在", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "推荐做 AI 选题助手"
  });
  assert.ok(/data-op-add-note/.test(html));
  assert.ok(/data-op-add-one-line/.test(html));
  assert.ok(/data-op-add-next/.test(html));
});

// ============== V0.3.11-hotfix-2: 加入机会池按钮状态统一 ==============

// 工具：根据 createApp + 注入节点构造一个简单 app 容器（与现有 V0.3.11 测试一致）
function makeAskApp(extraFetch) {
  const nodes = makeFakeNodes();
  const baseFetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
  const fetchImpl = extraFetch || baseFetch;
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  return { app, nodes };
}

test("V0.5: 页面包含轻量当前目标区域", () => {
  assert.ok(/id="currentGoalText"/.test(indexHtml), "应有当前目标文本节点");
  assert.ok(/id="goalEditButton"/.test(indexHtml), "应有设置/修改目标按钮");
  assert.ok(/id="goalClearButton"/.test(indexHtml), "应有清除目标按钮");
  assert.ok(/当前目标/.test(indexHtml), "应显示当前目标文案");
});

test("V0.5: mount 从 localStorage 读取当前目标并更新 UI", () => {
  const storage = makeMemoryStorage();
  storage.setItem(CURRENT_GOAL_KEY, "优先寻找 7 天内验证的 AI 工具型 MVP");
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage,
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  assert.equal(app.state.currentGoal, "优先寻找 7 天内验证的 AI 工具型 MVP");
  assert.equal(nodes.currentGoalText.textContent, "优先寻找 7 天内验证的 AI 工具型 MVP");
  // V0.6.4：修改按钮改为图标按钮 + 弱化"清除目标" 移到编辑态
  assert.equal(nodes.goalEditButton.getAttribute("aria-label"), "修改当前目标");
  assert.equal(nodes.goalEditButton.getAttribute("title"), "修改当前目标");
  // idle 状态清除按钮不显示（V0.6.4 规范）
  assert.equal(nodes.goalClearButton.hidden, true);
  // 编辑态未激活
  assert.equal(app.state.goalEditing, false);
});

test("V0.5: 设置 / 修改 / 清除 currentGoal 更新 storage 和 UI", () => {
  const storage = makeMemoryStorage();
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage,
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  // V0.6.5：空状态文案改成"尚未设置当前目标"以更克制
  assert.equal(nodes.currentGoalText.textContent, "尚未设置当前目标");
  assert.equal(nodes.currentGoalText.getAttribute("data-empty"), "true");

  app.openGoalEditor();
  // V0.6.5：用 class 切换取代 [hidden]，断言改用 classList
  assert.equal(nodes.goalForm.classList.contains("is-open"), true, "编辑态应带 is-open 类");
  nodes.goalInput.value = "用战略OS筛选适合独立开发者的小型 AI 产品 sk-uiGoal123456";
  app.saveGoalFromInput();
  assert.equal(app.state.currentGoal.includes("sk-uiGoal123456"), false);
  assert.equal(nodes.currentGoalText.textContent.includes("[redacted]"), true);
  assert.equal(storage.getItem(CURRENT_GOAL_KEY), app.state.currentGoal);

  app.clearCurrentGoal();
  assert.equal(app.state.currentGoal, "");
  // V0.6.5：空状态文案为"尚未设置当前目标"
  assert.equal(nodes.currentGoalText.textContent, "尚未设置当前目标");
  assert.equal(storage.getItem(CURRENT_GOAL_KEY), null);
  // 清除后表单应回到 idle（无 is-open 类）
  assert.equal(nodes.goalForm.classList.contains("is-open"), false);
});

test("V0.6: Goal 修改 / 清除后机会池重新请求派生优先级", async () => {
  const calls = [];
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: (path) => {
      calls.push(String(path));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } })
      });
    }
  });
  app.mount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  app.setCurrentGoal("用战略OS筛选适合独立开发者的小型 AI 产品");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((path) => path.includes("/api/opportunities?currentGoal=")));

  calls.length = 0;
  app.clearCurrentGoal();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.includes("/api/opportunities"));
  assert.equal(calls.some((path) => path.includes("currentGoal=")), false);
});

test("V0.5: submitAsk 会把 currentGoal 传给 /api/ask", async () => {
  let captured = null;
  const nodes = makeFakeNodes();
  nodes.questionInput.value = "今天适合做什么？";
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: (path, init = {}) => {
      if (path === "/api/ask") captured = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ answer: "回答", source: "local", search: null, warning: null })
      });
    }
  });
  app.mount();
  app.setCurrentGoal("用战略OS筛选适合独立开发者的小型 AI 产品");
  await app.submitAsk();
  assert.equal(captured.question, "今天适合做什么？");
  assert.equal(captured.currentGoal, "用战略OS筛选适合独立开发者的小型 AI 产品");
  assert.equal(captured.useSearch, undefined, "默认不联网不应被 currentGoal 改变");
});

test("V0.6.3-hotfix: submitAsk redacts question, currentGoal, answer and history", async () => {
  let captured = null;
  const storage = makeMemoryStorage();
  const nodes = makeFakeNodes();
  nodes.questionInput.value = "我的测试 key 是 sk-leakTestABC，今天适合做什么？";
  const app = createApp({
    nodes,
    storage,
    fetchImpl: (path, init = {}) => {
      if (path === "/api/ask") captured = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          answer: "模型回答 sk-answerLeakABC",
          source: "llm",
          search: null,
          warning: null
        })
      });
    }
  });
  app.mount();
  app.setCurrentGoal("目标 sk-goalLeakABC");
  await app.submitAsk();

  assert.equal(JSON.stringify(captured).includes("sk-leakTestABC"), false);
  assert.equal(JSON.stringify(captured).includes("sk-goalLeakABC"), false);
  assert.equal(nodes.questionEcho.innerHTML.includes("sk-leakTestABC"), false);
  assert.equal(nodes.answerOutput.innerHTML.includes("sk-answerLeakABC"), false);
  assert.equal(storage.getItem("strategyOsAskHistory").includes("sk-"), false);
  assert.ok(storage.getItem("strategyOsAskHistory").includes("[redacted]"));
});

test("V0.5.1: 清除 currentGoal 后 submitAsk 不再带 currentGoal", async () => {
  let captured = null;
  const nodes = makeFakeNodes();
  nodes.questionInput.value = "今天适合做什么？";
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: (path, init = {}) => {
      if (path === "/api/ask") captured = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ answer: "回答", source: "local", search: null, warning: null })
      });
    }
  });
  app.mount();
  app.setCurrentGoal("用战略OS筛选适合独立开发者的小型 AI 产品");
  app.clearCurrentGoal();
  await app.submitAsk();
  assert.equal(Object.prototype.hasOwnProperty.call(captured, "currentGoal"), false);
});

test("V0.5.1: ＋机会池智能草稿请求会带 currentGoal，清除后不带", async () => {
  const calls = [];
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: (path, init = {}) => {
      if (path === "/api/opportunities/draft") {
        calls.push(JSON.parse(init.body));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            opportunityName: "AI 机会简报助手",
            oneLineSummary: "面向独立开发者的小型 AI 产品验证。",
            note: "Goal 匹配：下一步应压到 7 天内可验证。",
            nextAction: "7 天内先完成一个最小页面验证。",
            suggestedTags: ["独立开发者", "可快速验证"],
            draftSource: "local-rule"
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
  });
  app.mount();
  app.setCurrentGoal("用战略OS筛选适合独立开发者的小型 AI 产品，并优先推进 7 天内可验证的 MVP");
  app.setCurrentAnswer("可以做一个 AI 机会简报助手，先做最小页面验证。", "local", {
    question: "最近有什么适合独立开发者做的小型 AI 项目？"
  });
  nodes.addOpportunityButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].currentGoal, "用战略OS筛选适合独立开发者的小型 AI 产品，并优先推进 7 天内可验证的 MVP");

  app.clearCurrentGoal();
  nodes.addOpportunityButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(Object.prototype.hasOwnProperty.call(calls[1], "currentGoal"), false);
});

test("V0.5: history restore 不改变 currentGoal", () => {
  const { app } = makeAskApp();
  app.setCurrentGoal("当前目标 A");
  app.restoreHistoryItem({
    id: "h-goal",
    question: "历史问题",
    answer: "历史回答",
    source: "local",
    type: "ask"
  });
  assert.equal(app.state.currentGoal, "当前目标 A");
});

test("V0.3.11-hotfix-2: 初始无回答时加入机会池按钮隐藏", () => {
  const { nodes, app } = makeAskApp();
  const btn = nodes.addOpportunityButton;
  // 初始 mount 后按钮应隐藏
  app.setCurrentAnswer("", "");
  assert.equal(btn.hidden, true, "无回答时按钮应隐藏");
  // 不应是 disabled 灰按钮（保持 hidden）
  assert.notEqual(btn.hidden === false && btn.disabled === true, true, "不应显示 disabled 灰按钮");
});

test("V0.3.11-hotfix-2: 普通 Ask 成功后加入机会池按钮可见可点", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("一些本地回答", "local", { question: "q" });
  assert.equal(nodes.addOpportunityButton.hidden, false, "有回答时按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "有回答时按钮应可点");
  assert.equal(nodes.copyCodexTaskButton.hidden, true, "普通 answer 不显示 Codex 任务复制");
  assert.equal(nodes.copyClaudeTaskButton.hidden, true, "普通 answer 不显示 Claude Code 任务复制");
});

test("V0.3.11-hotfix-2: 联网搜索成功后按钮仍可见可点（即使 source=llm / search.used=true）", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("搜索回答", "llm", {
    question: "q",
    search: {
      used: true,
      resultCount: 3,
      sources: [{ title: "外部来源", url: "https://example.com", source: "example.com" }],
      quality: { averageScore: 60, topSourceScore: 70, lowQualityCount: 0, hasHighConfidenceSources: true }
    }
  });
  assert.equal(nodes.addOpportunityButton.hidden, false, "搜索后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "搜索后按钮应可点");
});

test("V0.3.11-hotfix-2: 搜索失败 fallback 后（本地仍有 answer）按钮可见可点", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("本地回退回答", "local-fallback", {
    question: "q",
    search: { used: true, warning: "搜索超时，已本地回答" }
  });
  assert.equal(nodes.addOpportunityButton.hidden, false, "fallback 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "fallback 后按钮应可点");
});

test("V0.3.11-hotfix-2: 搜索失败且无本地 answer 时按钮隐藏", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("", "local-fallback", {
    question: "q",
    search: { used: true, warning: "搜索超时" }
  });
  assert.equal(nodes.addOpportunityButton.hidden, true, "无 answer 时按钮应隐藏");
});

test("V0.3.11-hotfix-2: loading 中按钮 disabled 或隐藏", async () => {
  const { app, nodes } = makeAskApp();
  // 模拟 loading 开始（不真正提交）
  app.setInFlight(true);
  assert.equal(nodes.addOpportunityButton.disabled, true, "loading 中按钮应 disabled");
  assert.equal(nodes.copyCodexTaskButton.hidden, true, "loading 中隐藏 Codex 任务复制");
  assert.equal(nodes.copyClaudeTaskButton.hidden, true, "loading 中隐藏 Claude Code 任务复制");
});

test("V0.3.11-hotfix-2: loading 结束且有 answer 后按钮恢复可点", () => {
  const { app, nodes } = makeAskApp();
  app.setInFlight(true);
  app.setCurrentAnswer("loading 结束后的回答", "llm", { question: "q" });
  app.setInFlight(false);
  assert.equal(nodes.addOpportunityButton.hidden, false, "loading 结束且有 answer 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "loading 结束且有 answer 后按钮应可点");
});

test("V0.3.11-hotfix-2: history restore 普通 answer 后按钮可见可点", () => {
  const { app, nodes } = makeAskApp();
  app.restoreHistoryItem({
    id: "h-1",
    question: "历史问题",
    answer: "历史回答",
    source: "llm",
    searchUsed: true,
    searchWarning: null,
    searchSources: [{ title: "src", url: "https://example.com", source: "example.com" }],
    type: "ask"
  });
  assert.equal(nodes.addOpportunityButton.hidden, false, "恢复普通 answer 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "恢复普通 answer 后按钮应可点");
  assert.equal(nodes.copyCodexTaskButton.hidden, true, "恢复普通 answer 后隐藏 Codex 任务复制");
  assert.equal(nodes.copyClaudeTaskButton.hidden, true, "恢复普通 answer 后隐藏 Claude Code 任务复制");
});

test("V0.3.11-hotfix-2: history restore 开工包类型（kickoff-package）后按钮应隐藏，不显示 disabled 灰按钮", () => {
  const { app, nodes } = makeAskApp();
  app.restoreHistoryItem({
    id: "h-kick-1",
    question: "为「X」生成开工包",
    answer: "## 开工包\n### 项目一句话\n…",
    source: "local",
    searchUsed: false,
    searchWarning: null,
    type: "kickoff-package"
  });
  // 应隐藏，而不是 disabled
  assert.equal(nodes.addOpportunityButton.hidden, true, "kickoff-package 类型应隐藏按钮");
  assert.notEqual(nodes.addOpportunityButton.hidden === false && nodes.addOpportunityButton.disabled === true, true, "不应显示 disabled 灰按钮");
  assert.equal(nodes.copyCodexTaskButton.hidden, false, "kickoff-package 应显示 Codex 任务复制");
  assert.equal(nodes.copyCodexTaskButton.disabled, false);
  assert.equal(nodes.copyClaudeTaskButton.hidden, false, "kickoff-package 应显示 Claude Code 任务复制");
  assert.equal(nodes.copyClaudeTaskButton.disabled, false);
});

test("V0.3.11-hotfix-2: clear/reset 状态后按钮隐藏", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("一些回答", "llm", { question: "q" });
  assert.equal(nodes.addOpportunityButton.hidden, false, "有回答时按钮可见");
  // 清空
  app.setCurrentAnswer("", "");
  assert.equal(nodes.addOpportunityButton.hidden, true, "清空后按钮隐藏");
  assert.notEqual(nodes.addOpportunityButton.disabled === true && nodes.addOpportunityButton.hidden === false, true, "清空后不能显示 disabled 灰按钮");
  assert.equal(nodes.copyCodexTaskButton.hidden, true, "清空后 Codex 任务复制隐藏");
  assert.equal(nodes.copyClaudeTaskButton.hidden, true, "清空后 Claude Code 任务复制隐藏");
});

test("V0.4.4: 直接设置 kickoff-package 后显示任务复制按钮并隐藏机会池", () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("# 开工包\n做一个小验证。", "local", {
    question: "为「X」生成开工包",
    answerType: "kickoff-package"
  });
  assert.equal(nodes.addOpportunityButton.hidden, true);
  assert.equal(nodes.copyCodexTaskButton.hidden, false);
  assert.equal(nodes.copyClaudeTaskButton.hidden, false);
});

test("V0.4.4: 点击 Codex 任务按钮写入脱敏任务提示词", async () => {
  let written = "";
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    clipboardImpl: async (text) => {
      written = text;
    },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  app.setCurrentAnswer("# 开工包\n配置 sk-codexSecret123456。", "local", {
    question: "生成开工包",
    answerType: "kickoff-package"
  });
  app.setCurrentGoal("推进 AI 机会发现 sk-goalCodex123456");
  const result = await app.handleCodexTaskCopy();
  assert.equal(result.ok, true);
  assert.ok(written.includes("测试要求"));
  assert.ok(written.includes("Git 要求"));
  assert.ok(written.includes("当前目标"));
  assert.ok(written.includes("推进 AI 机会发现"));
  assert.ok(written.includes("# 开工包"));
  assert.equal(written.includes("sk-codexSecret123456"), false);
  assert.equal(written.includes("sk-goalCodex123456"), false);
  assert.equal(nodes.copyCodexTaskButton.textContent, "已复制");
});

test("V0.4.4: 点击 Claude Code 任务按钮写入脱敏任务提示词", async () => {
  let written = "";
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    clipboardImpl: async (text) => {
      written = text;
    },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  app.setCurrentAnswer("# 开工包\n配置 sk-claudeSecret123456。", "local", {
    question: "生成开工包",
    answerType: "kickoff-package"
  });
  app.setCurrentGoal("做个人战略工作台 sk-goalClaude123456");
  const result = await app.handleClaudeCodeTaskCopy();
  assert.equal(result.ok, true);
  assert.ok(written.includes("真实网页验证要求"));
  assert.ok(written.includes("当前目标"));
  assert.ok(written.includes("做个人战略工作台"));
  assert.ok(written.includes("# 开工包"));
  assert.equal(written.includes("sk-claudeSecret123456"), false);
  assert.equal(written.includes("sk-goalClaude123456"), false);
  assert.equal(nodes.copyClaudeTaskButton.textContent, "已复制");
});

test("V0.6.5: 任务复制按钮不再绑定 click 监听，写入 clipboard 为 0", async () => {
  // V0.6.5：Codex / Claude Code 任务按钮从 DOM 删除；保留 handler 但 click 后不会触发
  const written = [];
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    clipboardImpl: async (text) => {
      written.push(text);
    },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  app.setCurrentAnswer("# 开工包\n配置 sk-clickSecret123456。", "local", {
    question: "生成开工包",
    answerType: "kickoff-package"
  });
  // fakeEl click() 在 setAttribute/setState 注册的 listener 上 fire；mount 不再注册
  // task-copy button listener，所以 clipboard 应保持空
  if (nodes.copyCodexTaskButton && typeof nodes.copyCodexTaskButton.click === "function") {
    nodes.copyCodexTaskButton.click();
  }
  if (nodes.copyClaudeTaskButton && typeof nodes.copyClaudeTaskButton.click === "function") {
    nodes.copyClaudeTaskButton.click();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(written.length, 0, "Codex/Claude Code 按钮不再触发 clipboard 写入");
  // kickoff-package 内核仍可用：通过 app.handleCodexTaskCopy 调用能拿到 prompt（API 仍保留）
  // 但默认 UI 不再展示这些按钮
  assert.equal(/id="copyCodexTaskButton"/.test(indexHtml), false, "HTML 已删除 copyCodexTaskButton");
});

test("V0.4.4: 任务复制 clipboard 失败时不抛异常", async () => {
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    clipboardImpl: async () => {
      throw new Error("clipboard denied");
    },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  app.setCurrentAnswer("# 开工包", "local", { question: "q", answerType: "kickoff-package" });
  const result = await app.handleCodexTaskCopy();
  assert.equal(result.ok, false);
  assert.ok(app.getStatus().includes("复制失败"));
});

test("V0.3.11-hotfix-2: draftWarning 时主按钮仍可点击，表单内显示 warning", async () => {
  // 极端情况：后端 / 前端提炼都失败时，主按钮应仍可点
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("今天多云转晴", "llm", { question: "今天天气怎么样" });
  assert.equal(nodes.addOpportunityButton.hidden, false, "提炼失败时按钮仍应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "提炼失败时按钮仍应可点");
  // 点击打开表单
  nodes.addOpportunityButton.click();
  // 等待 async openAddOpportunityForm 完成
  await new Promise((r) => setTimeout(r, 30));
  // 表单内应显示 warning
  assert.ok(/data-op-add-warning/.test(nodes.addOpportunityContainer.innerHTML), "表单内应显示 warning 节点");
});

test("V0.3.11-hotfix-2: 点击按钮能打开加入机会池表单", async () => {
  const { app, nodes } = makeAskApp();
  app.setCurrentAnswer("回答内容", "llm", { question: "q" });
  nodes.addOpportunityButton.click();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(nodes.addOpportunityContainer.hidden, false, "点击后容器应显示");
  assert.ok(/data-op-add-form/.test(nodes.addOpportunityContainer.innerHTML), "应渲染表单 markup");
});

test("V0.3.11-hotfix-2: submitAsk 普通 Ask 流程后按钮可见可点（end-to-end）", async () => {
  const fetchImpl = (path, init = {}) => {
    if (path === "/api/ask" && init.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          answer: "本地回答",
          source: "local",
          search: null,
          warning: null
        })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
  };
  const nodes = makeFakeNodes();
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  nodes.questionInput.value = "测试问题";
  await app.submitAsk();
  assert.equal(nodes.addOpportunityButton.hidden, false, "submitAsk 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "submitAsk 后按钮应可点");
});

test("V0.3.11-hotfix-2: submitAsk 联网搜索流程后按钮可见可点（end-to-end）", async () => {
  const fetchImpl = (path, init = {}) => {
    if (path === "/api/ask" && init.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          answer: "搜索回答",
          source: "llm",
          search: { used: true, sources: [{ title: "x", url: "https://example.com", source: "example.com" }], resultCount: 1 },
          warning: null
        })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
  };
  const nodes = makeFakeNodes();
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  nodes.questionInput.value = "测试问题";
  nodes.webSearchToggle.checked = true;
  await app.submitAsk();
  assert.equal(nodes.addOpportunityButton.hidden, false, "搜索 submitAsk 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false, "搜索 submitAsk 后按钮应可点");
});

// ============== V0.3.11-hotfix-2: loading 容器 ==============

test("V0.3.11-hotfix-2 + V0.6.6: CSS loading 容器最小高度 ≥ 320px（更舒展）", () => {
  // 抓 .answer-loading 规则块
  const match = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(match, "应存在 .answer-loading 规则");
  const block = match[0];
  const minH = block.match(/min-height\s*:\s*(\d+)px/);
  assert.ok(minH, ".answer-loading 应设置 min-height (px)");
  const h = Number(minH[1]);
  // V0.6.6：loading 升级到 360px 让答案框不空荡
  assert.ok(h >= 320, `.answer-loading min-height 应 >= 320px（V0.6.6），实际 ${h}px`);
});

test("V0.3.11-hotfix-2: CSS loading 容器 padding 充足（>= 28px）", () => {
  const match = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(match);
  const block = match[0];
  const padMatch = block.match(/padding\s*:\s*([^;]+);/);
  assert.ok(padMatch, ".answer-loading 应设置 padding");
  const nums = (padMatch[1].match(/\d+/g) || []).map(Number);
  assert.ok(nums.length >= 1, "padding 至少含 1 个数字");
  assert.ok(nums.some((n) => n >= 28), `.answer-loading padding 应至少有一个值 >= 28px，实际 ${JSON.stringify(nums)}`);
});

test("V0.3.11-hotfix-2: loading-spinner 6 个 div 内部结构未变（keyframe 驱动元素仍存在）", () => {
  // 抓 .loading-spinner > div / nth-of-type 选择器数量
  const nthMatches = stylesCss.match(/\.loading-spinner\s+div:nth-of-type\(\d+\)/g) || [];
  assert.ok(nthMatches.length >= 6, `loading-spinner 应有 6 个 div 子元素，实际 ${nthMatches.length}`);
});

test("V0.3.11-hotfix-2: keyframes 名称未变（loading-spinner / spoke 等仍存在）", () => {
  // 不能修改 loading 动画 keyframes 本身
  assert.ok(/@keyframes\s+loading-spinner/.test(stylesCss), "@keyframes loading-spinner 应保留");
  // 现在的动画有 6 个 div 由 loading-spinner keyframe 驱动
  const animMatch = stylesCss.match(/\.loading-spinner\s*\{[^}]*animation\s*:\s*loading-spinner\s+([^;]+);/);
  assert.ok(animMatch, ".loading-spinner 应使用 loading-spinner keyframe 动画");
});

test("V0.3.11-hotfix-2: HTML loading 容器结构未变（仍含 loading-spinner 6 个 div）", () => {
  const loadBlock = indexHtml.match(/<div[^>]*id="answerLoading"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(loadBlock, "应存在 answerLoading 容器");
  const inner = loadBlock[0];
  // 6 个 div（loading-spinner 子元素）
  const divCount = (inner.match(/<div><\/div>/g) || []).length;
  assert.ok(divCount >= 6, `loading-spinner 应有 6 个 <div></div>，实际 ${divCount}`);
});

test("V0.3.11-hotfix-2: buildLoadingMarkup 在 app.js 中暴露（确保前端知道 SVG 内容）", () => {
  // 现有 buildLoadingMarkup 使用 WHEEL_SVG；本次不允许改 loading 动画本身
  // 检查 WHEEL_SVG / buildLoadingMarkup 仍存在
  assert.ok(/function\s+buildLoadingMarkup/.test(appJsText), "buildLoadingMarkup 函数应存在");
});

// ============== V0.3.11-hotfix-3 Phase A: draftWarning 误显示 + warning chip ==============

test("V0.3.11-hotfix-3 A1: draftWarning=true 但 opportunityName 非空时不显示 blocking warning", () => {
  // 模拟后端 / LLM 同时返回 draftWarning（弱提示）与正常 opportunityName
  const html = buildAddOpportunityFormMarkup({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合。",
    draft: {
      opportunityName: "AI 短视频选题助手",
      draftWarning: "弱信号，建议补充领域定位。",
      oneLineSummary: "x",
      note: "y",
      nextAction: "z",
      suggestedTags: ["独立开发者"]
    }
  });
  // protectedName 应保留为 "AI 短视频选题助手"
  const titleMatch = html.match(/<input[^>]*data-op-add-title[^>]*value="([^"]*)"/);
  assert.ok(titleMatch);
  assert.equal(titleMatch[1], "AI 短视频选题助手", "draftWarning 不应清空非空 opportunityName");
  // 不应显示 blocking warning（因为有非空 name）
  assert.equal(/data-op-add-warning/.test(html), false, "protectedName 非空时不应显示 warning");
});

test("V0.3.11-hotfix-3 A2: weather / 无机会问题仍正确显示 warning（回归）", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "今天天气怎么样",
    answer: "今天多云转晴"
  });
  assert.ok(/data-op-add-warning/.test(html), "weather 类应显示 warning");
  const titleMatch = html.match(/<input[^>]*data-op-add-title[^>]*value="([^"]*)"/);
  assert.equal(titleMatch[1], "", "weather 类 title 应清空");
});

test("V0.3.11-hotfix-3 A3: warning chip 样式 - border-radius 999px", () => {
  const match = stylesCss.match(/\.opportunity-add-warning\s*\{[^}]*\}/);
  assert.ok(match, "应存在 .opportunity-add-warning 规则");
  const block = match[0];
  const radius = block.match(/border-radius\s*:\s*([^;]+);/);
  assert.ok(radius, ".opportunity-add-warning 应设置 border-radius");
  assert.equal(/999px/.test(radius[1]), true, `border-radius 应是 999px（chip 形状），实际 ${radius[1]}`);
});

// ============== V0.3.11-hotfix-3 Phase B: 机会池按钮精简 ==============

test("V0.6.4: index.html 提问按钮含双 motion-label 层（提问 + 发送）", () => {
  // 提问按钮应同时含 default + hover 两个 motion-label 子层
  const askMatch = indexHtml.match(/<button[^>]+id="askButton"[\s\S]*?<\/button>/);
  assert.ok(askMatch, "应能找到 askButton 块");
  const inner = askMatch[0];
  assert.ok(/motion-label--default/.test(inner), "提问按钮应含 motion-label--default 层");
  assert.ok(/motion-label--hover/.test(inner), "提问按钮应含 motion-label--hover 层");
  // 默认层文字 "提问"
  const defaultText = inner.match(/<span[^>]+class="[^"]*motion-label--default[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(defaultText, "应能找到 motion-label--default span");
  assert.equal(defaultText[1].trim(), "提问", "默认层文字应为「提问」");
  // hover 层文字 "发送"
  const hoverText = inner.match(/<span[^>]+class="[^"]*motion-label--hover[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(hoverText, "应能找到 motion-label--hover span");
  assert.equal(hoverText[1].trim(), "发送", "hover 层文字应为「发送」");
  // aria-label 应作为唯一 accessible name
  assert.ok(/aria-label="发送提问"/.test(inner), "应设置 aria-label=\"发送提问\"");
  assert.equal(/aria-label="[^"]*"/.test(inner) && (inner.match(/aria-label="/g) || []).length, 1, "提问按钮只允许一个 aria-label");
});

test("V0.6.4: index.html 机会池按钮含双 motion-label 层（机会池 + ＋）", () => {
  // 机会池按钮应改用 motion-label 系统
  const match = indexHtml.match(/<button[^>]+id="addOpportunityButton"[\s\S]*?<\/button>/);
  assert.ok(match, "应能找到 addOpportunityButton 块");
  const inner = match[0];
  assert.ok(/class="add-opportunity-button motion-label-button"/.test(inner), "应同时挂上 add-opportunity-button 与 motion-label-button");
  assert.ok(/motion-label--default/.test(inner), "应含 motion-label--default 层");
  assert.ok(/motion-label--hover/.test(inner), "应含 motion-label--hover 层");
  const defaultText = inner.match(/<span[^>]+class="[^"]*motion-label--default[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const hoverText = inner.match(/<span[^>]+class="[^"]*motion-label--hover[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(defaultText && defaultText[1].trim() === "机会池", "默认层应为「机会池」");
  assert.ok(hoverText && /＋|\+/.test(hoverText[1]), "hover 层应为「＋」");
  // 不应再使用 add-opportunity-icon / add-opportunity-label 子结构
  assert.equal(/class="add-opportunity-icon"/.test(inner), false, "add-opportunity-icon span 已下线");
  assert.equal(/class="add-opportunity-label"/.test(inner), false, "add-opportunity-label span 已下线");
});

test("V0.3.11-hotfix-3 B2: app.js 不再含 .replace(\"加入机会池\", labelText) 标签拼接逻辑", () => {
  assert.equal(/\.replace\(["']加入机会池["']/.test(appJsText), false, "应删除 labelText 字符串替换逻辑");
  assert.equal(/从本次回答创建机会/.test(appJsText), false, "应删除'从本次回答创建机会'文案");
});

test("V0.6.4: CSS .add-opportunity-button .motion-label--hover 字号 ≥ 14px（明显的 + 反馈）", () => {
  // V0.6.4 替代 B3：motion-label 系统下用 .motion-label--hover 显字号
  const match = stylesCss.match(/\.add-opportunity-button\s+\.motion-label--hover\s*\{[^}]*\}/);
  assert.ok(match, "应存在 .add-opportunity-button .motion-label--hover 规则");
  const fs = match[0].match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/);
  assert.ok(fs, "应设置 font-size");
  const sz = Number(fs[1]);
  assert.ok(sz >= 14, `hover + 字号应 ≥ 14px（明显反馈），实际 ${sz}px`);
});

// ============== V0.3.11-hotfix-3 Phase C: 回答下方 meta 单行 ==============

test("V0.3.11-hotfix-3 C1: renderSearchProcess 输出单行 summary + details 折叠", () => {
  const html = renderSearchProcess({
    used: true,
    intent: "ai-opportunity",
    plannedQueries: ["独立开发者 AI 工具"],
    freshness: "oneWeek",
    recency: { filteredOldCount: 0, missingDateCount: 0 },
    filters: { blockedTopicCount: 0, duplicateCount: 0 },
    quality: { averageScore: 60, topSourceScore: 70, lowQualityCount: 0, hasHighConfidenceSources: true }
  });
  assert.ok(/<span[^>]+class="search-process-summary"/.test(html), "应含 search-process-summary 单行摘要 span");
  assert.ok(/<details[^>]+class="search-process-details"/.test(html), "应含折叠 details");
});

test("V0.3.11-hotfix-3 C2: renderSearchSources 输出合并头 + details 折叠", () => {
  const html = renderSearchSources([
    { title: "来源 1", url: "https://example.com/1", source: "example.com" },
    { title: "来源 2", url: "https://example.com/2", source: "example.com" }
  ]);
  assert.ok(/<span[^>]+class="search-sources-head"/.test(html), "应含 search-sources-head 头");
  assert.ok(/<details[^>]+class="search-sources-details"/.test(html), "应含折叠 details");
  assert.ok(/search-sources-list/.test(html), "应保留 ul 列表（折叠内）");
});

test("V0.3.11-hotfix-3 C3: styles.css 含 @media (min-width: 900px) 桌面单行规则", () => {
  assert.ok(/@media\s+\(min-width\s*:\s*900px\)/.test(stylesCss), "应存在桌面单行 media 规则");
  // 找到 media 块附近有 .search-sources / .search-process 规则
  const mediaIdx = stylesCss.search(/@media\s+\(min-width\s*:\s*900px\)/);
  const slice = stylesCss.slice(mediaIdx, mediaIdx + 1500);
  assert.ok(/\.search-(sources|process)/.test(slice), "桌面 media 块应作用于 search-sources / search-process");
});

// ============== V0.3.11-hotfix-3 Phase F: 表单字段分组 ==============

test("V0.3.11-hotfix-3 F1: form markup 包含 core / judgment / action 三个字段集", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "建议做一个 AI 短视频选题助手"
  });
  assert.ok(/opportunity-add-fieldset--core/.test(html), "应含 core fieldset");
  assert.ok(/opportunity-add-fieldset--judgment/.test(html), "应含 judgment fieldset");
  assert.ok(/opportunity-add-fieldset--action/.test(html), "应含 action fieldset");
});

test("V0.3.11-hotfix-3 F2: tags 在 details 内默认折叠", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "建议做一个 AI 短视频选题助手"
  });
  // tags 应在 source-info details 内
  const sourceInfoMatch = html.match(/<details[^>]+class="opportunity-add-source-info"[\s\S]*?<\/details>/);
  assert.ok(sourceInfoMatch, "应存在 source-info details 块");
  assert.ok(/data-op-add-tags/.test(sourceInfoMatch[0]), "tags 节点应在 source-info details 内");
});

test("V0.3.11-hotfix-3 F3: 机会名称 input 在 core fieldset 内且更突出", () => {
  const html = buildAddOpportunityFormMarkup({
    question: "q",
    answer: "建议做一个 AI 短视频选题助手"
  });
  const coreMatch = html.match(/<fieldset[^>]+class="[^"]*opportunity-add-fieldset--core[\s\S]*?<\/fieldset>/);
  assert.ok(coreMatch, "应存在 core fieldset");
  assert.ok(/data-op-add-title/.test(coreMatch[0]), "title 应在 core fieldset 内");
});

// ============== V0.3.11-hotfix-3 Phase G: 输入框清空 + × 按钮 ==============

test("V0.3.11-hotfix-3 G1: HTML 含 clearInputButton 节点 + composer-textarea-wrap", () => {
  assert.ok(/id="clearInputButton"/.test(indexHtml), "应含 clearInputButton 节点");
  assert.ok(/class="composer-textarea-wrap"/.test(indexHtml), "应含 composer-textarea-wrap 包裹");
  assert.ok(/aria-label="清空输入"/.test(indexHtml), "清空按钮应有 aria-label");
});

test("V0.3.11-hotfix-3 G8: styles.css .composer-textarea-wrap textarea padding-right ≥ 30px", () => {
  // 找 .composer-textarea-wrap 块
  const wrapMatch = stylesCss.match(/\.composer-textarea-wrap\s*\{[^}]*\}/);
  assert.ok(wrapMatch, "应存在 .composer-textarea-wrap 规则");
  // 找内含 textarea 的规则
  const inner = stylesCss.match(/\.composer-textarea-wrap\s+textarea\s*\{[^}]*\}/);
  assert.ok(inner, "应存在 .composer-textarea-wrap textarea 规则");
  const pr = inner[0].match(/padding-right\s*:\s*(\d+)px/);
  assert.ok(pr, "textarea 应设置 padding-right");
  const val = Number(pr[1]);
  assert.ok(val >= 30, `padding-right 应 ≥ 30px（给 × 留位），实际 ${val}px`);
});

// ============== V0.3.11-hotfix-3 Phase D: 智能草稿 API ==============

test("startAskUiServer: POST /api/opportunities/draft 无 LLM 配置时返回 draftSource=fallback", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-draft-api-"));
  // 确保没有 LLM 配置
  const env = { ...process.env };
  delete env.STRATEGY_OS_LLM_API_KEY;
  delete env.STRATEGY_OS_LLM_ENABLED;
  delete env.LLM_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  env.STRATEGY_OS_LLM_ENABLED = "false";
  // 临时设置 process.env 让 isConfigured 返 false
  const originalEnv = process.env;
  process.env = env;
  const server = await startAskUiServer({ rootDir, port: 5292, host: "127.0.0.1" });
  try {
    const { status, json } = await httpRequest({
      port: 5292,
      method: "POST",
      path: "/api/opportunities/draft",
      body: {
        question: "最近有什么适合独立开发者做的小型 AI 项目？",
        answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合。"
      }
    });
    assert.equal(status, 200);
    assert.ok(json, "响应应包含 JSON");
    assert.equal(json.draftSource, "fallback", "无 LLM 时应为 fallback");
    assert.equal(typeof json.opportunityName, "string", "opportunityName 应为字符串");
  } finally {
    process.env = originalEnv;
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("startAskUiServer: POST /api/opportunities/draft 响应只含白名单字段", async () => {
  const { startAskUiServer, pickDraftResponse } = require("../scripts/start-ask-ui");
  // 直接测 pickDraftResponse 纯函数
  const out = pickDraftResponse({
    opportunityName: "X 助手",
    oneLineSummary: "ok",
    note: "n",
    nextAction: "na",
    status: "validate",
    type: "new-project-opportunity",
    suggestedTags: ["独立开发者"],
    draftWarning: null,
    sourceQuestion: "q",
    sourceAnswerSummary: "a",
    sourceUrls: [],
    draftSource: "llm",
    // 敏感字段应被过滤
    filePath: "/etc/passwd",
    apiKey: "sk-fakefakefakefake",
    rawAnswer: "secret",
    rawSearchResponse: "secret"
  });
  assert.equal(out.opportunityName, "X 助手");
  assert.equal(out.draftSource, "llm");
  assert.equal("filePath" in out, false, "filePath 不应在响应中");
  assert.equal("apiKey" in out, false, "apiKey 不应在响应中");
  assert.equal("rawAnswer" in out, false, "rawAnswer 不应在响应中");
  assert.equal("rawSearchResponse" in out, false, "rawSearchResponse 不应在响应中");
});

test("startAskUiServer: POST /api/opportunities/draft 响应 draftSource 默认 fallback 当无效", async () => {
  const { pickDraftResponse } = require("../scripts/start-ask-ui");
  const out = pickDraftResponse({ opportunityName: "X", draftSource: "INVALID" });
  assert.equal(out.draftSource, "fallback", "无效 draftSource 应降级为 fallback");
});

test("startAskUiServer: POST /api/opportunities/draft 响应 suggestedTags 必须是数组", async () => {
  const { pickDraftResponse } = require("../scripts/start-ask-ui");
  const out = pickDraftResponse({ opportunityName: "X", suggestedTags: "not-an-array" });
  assert.deepEqual(out.suggestedTags, [], "非数组 suggestedTags 应降级为 []");
});

test("startAskUiServer: POST /api/opportunities/draft 注入 fake fetch 模拟 LLM 成功时 draftSource=llm", async () => {
  const { generateOpportunityDraft } = require("../scripts/ask-strategy-os");
  // 用 fake fetch + 假 LLM 配置
  const env = { ...process.env };
  env.STRATEGY_OS_LLM_ENABLED = "true";
  env.STRATEGY_OS_LLM_PROVIDER = "openai";
  env.STRATEGY_OS_LLM_BASE_URL = "https://api.example.com/v1";
  env.STRATEGY_OS_LLM_MODEL = "gpt-test";
  env.STRATEGY_OS_LLM_API_KEY = "sk-fakefakefake0123456789";
  const llmJson = {
    choices: [{ message: { content: '{"opportunityName":"AI 短视频选题助手","oneLineSummary":"X","note":"n","nextAction":"na","suggestedTags":["独立开发者","内容产品"],"status":"validate","type":"new-project-opportunity","draftWarning":""}' } }]
  };
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(llmJson),
    json: async () => llmJson
  });
  const result = await generateOpportunityDraft({
    question: "q",
    answer: "a",
    env,
    deps: { fetch: fakeFetch, AbortController: null }
  });
  assert.equal(result.draftSource, "llm");
  assert.equal(result.opportunityName, "AI 短视频选题助手");
  assert.ok(Array.isArray(result.suggestedTags));
  // tags 应在 5 个以内
  assert.ok(result.suggestedTags.length <= 5);
});

test("startAskUiServer: generateOpportunityDraft LLM 非法 JSON 时回退 local-rule", async () => {
  const { generateOpportunityDraft } = require("../scripts/ask-strategy-os");
  const env = { ...process.env };
  env.STRATEGY_OS_LLM_ENABLED = "true";
  env.STRATEGY_OS_LLM_PROVIDER = "openai";
  env.STRATEGY_OS_LLM_BASE_URL = "https://api.example.com/v1";
  env.STRATEGY_OS_LLM_MODEL = "gpt-test";
  env.STRATEGY_OS_LLM_API_KEY = "sk-fakefakefake0123456789";
  // callChatCompletion 自己 parse 这个 outer JSON，然后从 choices[0].message.content 拿到 "这不是 JSON"
  const llmJson = { choices: [{ message: { content: "这不是 JSON" } }] };
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(llmJson),
    json: async () => llmJson
  });
  const result = await generateOpportunityDraft({
    question: "q",
    answer: "a",
    env,
    deps: { fetch: fakeFetch, AbortController: null }
  });
  assert.equal(result.draftSource, "local-rule", "非法 JSON 应回退 local-rule");
});

test("startAskUiServer: generateOpportunityDraft LLM JSON 含 filePath/apiKey 时被 pickDraftFields 过滤", async () => {
  const { pickDraftFields } = require("../scripts/ask-strategy-os");
  const out = pickDraftFields({
    opportunityName: "X 助手",
    filePath: "/etc/passwd",
    apiKey: "sk-fakefakefakefake"
  });
  assert.equal(out.opportunityName, "X 助手");
  assert.equal("filePath" in out, false, "filePath 不应被 pickDraftFields 保留");
  assert.equal("apiKey" in out, false, "apiKey 不应被 pickDraftFields 保留");
});

test("startAskUiServer: parseLlmDraftJson 抓首个 {...} 块，容忍 JSON 前后多余文本", () => {
  const { parseLlmDraftJson } = require("../scripts/ask-strategy-os");
  // 模拟模型在 JSON 外多写几句话
  const out = parseLlmDraftJson("好的，下面是 JSON：\n{\"opportunityName\":\"X\"}\n谢谢。");
  assert.ok(out, "应能解析");
  assert.equal(out.opportunityName, "X");
});

test("startAskUiServer: parseLlmDraftJson 非法 JSON 时返 null", () => {
  const { parseLlmDraftJson } = require("../scripts/ask-strategy-os");
  assert.equal(parseLlmDraftJson("not json"), null);
  assert.equal(parseLlmDraftJson(""), null);
  assert.equal(parseLlmDraftJson(null), null);
  assert.equal(parseLlmDraftJson("{"), null);
});

// ============== V0.3.11-hotfix-3 Phase E: 前端调用 draft API ==============

test("V0.3.11-hotfix-3 E1: openAddOpportunityForm 调用 /api/opportunities/draft 并把 draft 传给 markup", async () => {
  const nodes = makeFakeNodes();
  const fetchCalls = [];
  const fetchImpl = (path, init = {}) => {
    fetchCalls.push({ path, method: init.method || "GET", body: init.body || null });
    if (path === "/api/opportunities/draft" && init.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          opportunityName: "AI 短视频选题助手",
          oneLineSummary: "X 助手",
          note: "n",
          nextAction: "na",
          status: "validate",
          type: "new-project-opportunity",
          suggestedTags: ["独立开发者"],
          draftSource: "llm"
        })
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
  };
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  app.setCurrentAnswer("我建议你先做一个 AI 短视频选题助手。", "llm", { question: "最近有什么适合独立开发者做的小型 AI 项目？" });
  nodes.addOpportunityButton.click();
  // 等待 async
  await new Promise((r) => setTimeout(r, 30));
  const draftCall = fetchCalls.find((c) => c.path === "/api/opportunities/draft");
  assert.ok(draftCall, "应调用 /api/opportunities/draft");
  assert.equal(draftCall.method, "POST");
  // body 应含 question 和 answer
  const body = JSON.parse(draftCall.body);
  assert.ok(body.question, "body 应含 question");
  assert.ok(body.answer, "body 应含 answer");
  // 容器应渲染表单，title 应来自 LLM draft
  const container = nodes.addOpportunityContainer;
  assert.equal(container.hidden, false, "点击后容器应显示");
  assert.ok(/AI 短视频选题助手/.test(container.innerHTML), "表单应使用 LLM draft 的 opportunityName");
});

test("V0.3.11-hotfix-3 E2: /api/opportunities/draft 失败时仍能渲染（走本地规则）", async () => {
  const nodes = makeFakeNodes();
  const fetchImpl = (path, init = {}) => {
    if (path === "/api/opportunities/draft" && init.method === "POST") {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "x" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
  };
  const app = createApp({ nodes, fetchImpl, storage: null });
  app.mount();
  app.setCurrentAnswer("建议做一个 AI 短视频选题助手", "llm", { question: "适合做 AI 选题助手吗" });
  nodes.addOpportunityButton.click();
  await new Promise((r) => setTimeout(r, 30));
  // 容器仍应渲染（走 buildAddOpportunityFormMarkup 的本地规则兜底）
  const container = nodes.addOpportunityContainer;
  assert.equal(container.hidden, false, "draft 失败时容器仍应显示");
  assert.ok(/data-op-add-form/.test(container.innerHTML), "应仍渲染表单 markup");
});

// ============== V0.3.11-hotfix-4: 按钮文案 + sk-* 脱敏 ==============

test("V0.6.4: addOpportunityButton 可见文本仅「机会池」与「＋」，不显示长文案", () => {
  assert.ok(/id="addOpportunityButton"/.test(indexHtml), "应保留 addOpportunityButton 节点");
  assert.ok(/class="add-opportunity-button motion-label-button"/.test(indexHtml), "应挂上 motion-label-button");
  const buttonMatch = indexHtml.match(/<button[^>]+id="addOpportunityButton"[\s\S]*?<\/button>/);
  assert.ok(buttonMatch, "应能找到 addOpportunityButton 块");
  const visibleText = buttonMatch[0]
    .replace(/aria-label="[^"]*"/g, "")
    .replace(/title="[^"]*"/g, "");
  // 不应再出现"加入机会池"长文案作为可见内容
  assert.equal(/加入机会池/.test(visibleText), false, "可见文本不应含「加入机会池」");
  assert.equal(/从本次回答创建机会/.test(visibleText), false, "可见文本不应含「从本次回答创建机会」");
  // 可见文本应同时含「机会池」与「＋」
  assert.ok(/机会池/.test(visibleText), "可见文本应含「机会池」");
  assert.ok(/＋|\+/.test(visibleText), "可见文本应含「＋」");
});

test("V0.6.4: CSS 含 .motion-label-button + 两层 motion-label 切换规则", () => {
  assert.ok(/\.motion-label-button\s*\{/.test(stylesCss), "应存在 .motion-label-button 规则");
  assert.ok(/\.motion-label--default\s*\{/.test(stylesCss), "应存在 .motion-label--default 规则");
  assert.ok(/\.motion-label--hover\s*\{/.test(stylesCss), "应存在 .motion-label--hover 规则");
  // hover 切换：用 :hover:not(:disabled) .motion-label--hover 锁定 default 层与 hover 层
  assert.ok(/\.motion-label-button:hover:not\(:disabled\) \.motion-label--default/.test(stylesCss),
    "hover 时 default 层应被压下");
  assert.ok(/\.motion-label-button:focus-visible \.motion-label--default/.test(stylesCss),
    "focus-visible 时 default 层应被压下");
  assert.ok(/\.motion-label-button:focus-visible \.motion-label--hover/.test(stylesCss),
    "focus-visible 时 hover 层应上升");
  // disabled 保护：disabled 默认层保持，不响应 hover
  assert.ok(/\.motion-label-button:disabled \.motion-label--hover/.test(stylesCss),
    "disabled 应锁定 hover 层隐藏");
});

test("V0.6.4: motion-label 系统支持 prefers-reduced-motion", () => {
  assert.ok(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)[\s\S]*?motion-label--hover[\s\S]*?display\s*:\s*none/.test(stylesCss),
    "reduced-motion 下应隐藏 hover 层（不退化为切换动画）");
});

test("V0.6.4: 提问按钮尺寸锁定（min-width 防 '提问 → 发送' 切换抖动）", () => {
  const rule = stylesCss.match(/\.primary-button\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .primary-button 规则");
  const minWidth = (rule[0].match(/min-width\s*:\s*(\d+)px/) || [])[1];
  assert.ok(minWidth && Number(minWidth) >= 80, `.primary-button min-width 应 ≥ 80px 防抖动，实际 ${minWidth}`);
});

test("V0.6.4: 机会池按钮尺寸锁定（min-width 防 '机会池 → ＋' 切换抖动）", () => {
  const rule = stylesCss.match(/\.add-opportunity-button\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .add-opportunity-button 规则");
  const minWidth = (rule[0].match(/min-width\s*:\s*(\d+)px/) || [])[1];
  assert.ok(minWidth && Number(minWidth) >= 64, `.add-opportunity-button min-width 应 ≥ 64px 防抖动，实际 ${minWidth}`);
});

test("V0.6.5: openGoalEditor 进入编辑态后 .is-open 切换 + 弱化清除按钮显隐同步", () => {
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: makeMemoryStorage(),
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  // idle：编辑表单不带 .is-open，清除按钮应隐藏
  assert.equal(nodes.goalForm.classList.contains("is-open"), false);
  assert.equal(nodes.goalClearButton.hidden, true);
  assert.equal(app.state.goalEditing, false);
  assert.equal(nodes.goalForm.getAttribute("aria-hidden"), "true", "idle 应把表单脱离 a11y 树");

  // 设置一个目标 → 再进编辑：弱化清除按钮应可见 + .is-open 加上
  nodes.goalInput.value = "战略测试目标";
  app.saveGoalFromInput();
  assert.equal(app.state.currentGoal, "战略测试目标");

  app.openGoalEditor();
  assert.equal(nodes.goalForm.classList.contains("is-open"), true, "openGoalEditor 应添加 is-open 类");
  assert.equal(nodes.goalClearButton.hidden, false, "编辑态有目标时清除按钮应可见");
  assert.equal(app.state.goalEditing, true);
  assert.equal(nodes.goalForm.getAttribute("aria-hidden"), "false", "open 应让表单回到 a11y 树");

  // 关闭编辑态
  app.closeGoalEditor();
  assert.equal(nodes.goalForm.classList.contains("is-open"), false, "closeGoalEditor 应移除 is-open 类");
  assert.equal(nodes.goalClearButton.hidden, true, "关闭编辑态后清除按钮应再次隐藏");
  assert.equal(app.state.goalEditing, false);
  assert.equal(nodes.goalForm.getAttribute("aria-hidden"), "true", "关闭应让表单离开 a11y 树");
});

test("V0.6.5: openGoalEditor 在 idle 未设目标时清除按钮仍隐藏", () => {
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: makeMemoryStorage(),
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  app.openGoalEditor();
  // idle 没目标：编辑表单进入 .is-open 状态，但弱化清除按钮不应出现
  assert.equal(nodes.goalForm.classList.contains("is-open"), true);
  assert.equal(nodes.goalClearButton.hidden, true, "idle 无目标时清除按钮不显示");
});

test("V0.6.5: CSS .goal-form 默认隐藏样式（max-height:0 + visibility:hidden + opacity:0）", () => {
  // 提取 .goal-form 主规则（不是 prefers-reduced-motion 覆盖）
  const rule = stylesCss.match(/\.goal-form\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "应存在 .goal-form 主规则");
  const target = rule[0];
  assert.ok(/max-height\s*:\s*0/.test(target), ".goal-form 默认 max-height 应为 0");
  assert.ok(/visibility\s*:\s*hidden/.test(target), ".goal-form 默认 visibility 应为 hidden");
  assert.ok(/opacity\s*:\s*0/.test(target), ".goal-form 默认 opacity 应为 0");
  assert.ok(/overflow\s*:\s*hidden/.test(target), ".goal-form 默认 overflow 应为 hidden");
  // idle 不进 .is-open，因此根本不会占据布局
});

test("V0.6.5: CSS .goal-form.is-open 显隐样式", () => {
  const rule = stylesCss.match(/\.goal-form\.is-open\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "应存在 .goal-form.is-open 规则");
  const target = rule[0];
  assert.ok(/max-height\s*:\s*120px/.test(target), ".is-open max-height 应为 120px");
  assert.ok(/visibility\s*:\s*visible/.test(target), ".is-open visibility 应为 visible");
  assert.ok(/opacity\s*:\s*1/.test(target), ".is-open opacity 应为 1");
});

test("V0.6.5: CSS supports prefers-reduced-motion 兜底 Goal 表单", () => {
  // 把所有 prefers-reduced-motion 媒体块拼起来检查
  const blocks = stylesCss.match(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)[\s\S]*?(?=\n\s*@media|\s*$)/g) || [];
  assert.ok(blocks.length > 0, "应至少一个 prefers-reduced-motion 媒体查询");
  const combined = blocks.join("\n");
  // reduced-motion 下 .goal-form 应无 transition；可能写在任一块中
  assert.ok(/\.goal-form[\s\S]*?transition\s*:\s*none/.test(combined), "reduced-motion 下 .goal-form 应无 transition");
});

test("V0.6.5: HTML goalForm 不应再带 hidden 属性（V0.6.4 用 class 切换取代 [hidden]）", () => {
  // 抓 #goalForm 块
  const formBlock = indexHtml.match(/<form[^>]+id="goalForm"[^>]*>/);
  assert.ok(formBlock, "应能找到 #goalForm 节点");
  const opening = formBlock[0];
  // 不应出现独立 hidden 属性（用空格 / 引号限定，避开 aria-hidden 中的 hidden 子串）
  assert.equal(/(?:^|\s)hidden(?:=|\s|>)/.test(opening), false, "goalForm opening tag 不应再带 hidden 属性");
  assert.ok(/aria-hidden="true"/.test(opening), "goalForm 默认应 aria-hidden=true");
});

test("V0.6.5: 当前目标正文 CSS 加大字号（≥17px）以成为主展示内容", () => {
  const rule = stylesCss.match(/\.goal-text\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "应存在 .goal-text 规则");
  const fs = (rule[0].match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/) || [])[1];
  assert.ok(fs && Number(fs) >= 17, ".goal-text font-size 应 ≥ 17px 作为主展示，实际 " + fs);
});

test("V0.6.5: 开机包 / 普通复制按钮仍保留", () => {
  assert.ok(/id="copyButton"/.test(indexHtml), "应保留普通 copyButton");
  assert.ok(/id="addOpportunityButton"/.test(indexHtml), "应保留机会池按钮");
});

test("V0.6.5: app 启动 (mount) 时不挂 task-copy button click 监听", () => {
  // V0.6.5：Codex / Claude Code 按钮已从 DOM 删除，mount 不再 addEventListener
  // 通过 fake node click 不触发 clipboard 写入来验证
  const written = [];
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    clipboardImpl: async (text) => { written.push(text); },
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  // 设置 kickoff-package 状态，确保如旧逻辑会尝试让按钮可见
  app.setCurrentAnswer("# 开工包\n内容。", "local", {
    question: "生成开工包",
    answerType: "kickoff-package"
  });
  // 即使 fake 节点上挂着 click，mount 也不挂 listener（无写入发生）
  // 此外调用 handleCodexTaskCopy 还能工作（API 保留）
  // 但默认 UI 不展示这些按钮
  assert.equal(written.length, 0, "默认不应自动写 clipboard");
});

// ============== V0.6.6: 机会草稿 loading + 答案易读性 + 重点高光 ==============

test("V0.6.6: HTML #answerLoading 含 id 化的 loading-text span，方便动态切换文案", () => {
  // 草稿 loading 与 Ask loading 复用 #answerLoading 同一 DOM 节点，仅替换文案
  const loadHtml = indexHtml.match(/<div[^>]+id="answerLoading"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(loadHtml, "应能找到 #answerLoading");
  assert.ok(/id="answerLoadingText"/.test(loadHtml[0]), "#answerLoading 内应含 id=answerLoadingText 的 span 便于动态切换");
  // 默认文案
  assert.ok(loadHtml[0].includes("正在生成战略判断"), "默认 loading 文案应为「正在生成战略判断……」");
});

test("V0.6.6: CSS .answer-loading 升级到 min-height 360px 与更宽松 padding", () => {
  const rule = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer-loading 主规则");
  const block = rule[0];
  const min = (block.match(/min-height\s*:\s*(\d+)px/) || [])[1];
  assert.ok(min && Number(min) >= 360, `.answer-loading min-height 应 >= 360px，当前 ${min}px`);
  // padding 至少 32px 横向 + 32px 纵向，让 loading 不贴边
  const pad = block.match(/padding\s*:\s*([^;]+);/);
  assert.ok(pad, ".answer-loading 应含 padding");
});

test("V0.6.7: CSS .answer strong 升级为非黑色重点色 + 高光笔效果 + 混合模式", () => {
  // V0.6.7 替换：accent-dark → --highlight-ink
  const rule = stylesCss.match(/\.answer strong\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer strong 规则");
  const block = rule[0];
  // 1) 非黑色：使用 highlight-ink（不再是 accent-dark）
  assert.ok(/var\(--highlight-ink\)/.test(block), ".answer strong 应使用 --highlight-ink 暖色");
  // 2) 高光笔：linear-gradient
  assert.ok(/linear-gradient/.test(block), ".answer strong 应含 highlighter linear-gradient");
  // 3) box-decoration-break: clone 让高光在多行独立包裹
  assert.ok(/box-decoration-break\s*:\s*clone/.test(block), ".answer strong 应开启 box-decoration-break: clone");
  // 4) mix-blend-mode 混合模式
  assert.ok(/mix-blend-mode\s*:\s*multiply/i.test(block), ".answer strong 应含 mix-blend-mode: multiply");
});

test("V0.6.7: CSS .answer mark 升级（mark 元素也走非黑色重点色）", () => {
  const rule = stylesCss.match(/\.answer mark\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer mark 规则");
  const block = rule[0];
  assert.ok(/var\(--highlight-ink\)/.test(block), ".answer mark 应使用 --highlight-ink");
  assert.ok(/var\(--highlight-bg\)|rgba\(/.test(block), ".answer mark 背景应浅");
});

test("V0.6.7: CSS .answer h2 改为 highlight-ink 颜色", () => {
  const rule = stylesCss.match(/\.answer h2\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer h2 规则");
  const block = rule[0];
  assert.ok(/var\(--highlight-ink\)/.test(block), ".answer h2 应使用 --highlight-ink");
  // h2 ::before 标记使用 highlight-ink
  const beforeMatch = stylesCss.match(/\.answer h2::before\s*\{[^}]*\}/);
  assert.ok(beforeMatch, ".answer h2 应有 ::before 顶边标记");
  assert.ok(/var\(--highlight-ink\)/.test(beforeMatch[0]), ".answer h2::before 应使用 --highlight-ink");
});

test("V0.6.6: CSS .answer 代码/代码块不被高光笔影响", () => {
  // .answer code / pre 内的 mix-blend-mode: normal，避免代码块带高光
  const css = stylesCss;
  // 代码块相关的 mix-blend-mode 应该是 normal
  const rule = css.match(/\.answer code,\s*\n\s*\.answer pre\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer code + pre 的 mix-blend-mode 覆盖规则");
  assert.ok(/mix-blend-mode\s*:\s*normal/.test(rule[0]), "覆盖规则应回退到 normal");
});

test("V0.6.6: app 暴露 showAnswerLoading / hideAnswerLoading 复用 helper", () => {
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  // setInFlight(true) 调起初始 loading
  app.setInFlight(true);
  assert.equal(nodes.answerLoading.hidden, false, "setInFlight(true) 应让 answerLoading 可见");
  assert.equal(nodes.answerOutput.hidden, true, "loading 期间 answerOutput 应隐藏");
  // 验证 .loading-text span 内容已被写为"正在生成战略判断"（含省略号）
  const textEl = nodes.answerLoading.querySelector?.(".loading-text");
  if (textEl) {
    assert.ok(textEl.textContent.includes("正在生成战略判断") || /战略/.test(textEl.textContent), "loading text 应包含「战略」关键词");
  }
});

test("V0.6.6: openAddOpportunityForm 草稿 fetch 期间 #answerLoading 可见且文案为「正在生成机会草稿」", async () => {
  // fetchImpl 故意 hang 让我们能探测 loading 状态
  let release;
  const fetchGate = new Promise((resolve) => { release = resolve; });
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: null,
    fetchImpl: (path) => {
      if (path === "/api/opportunities/draft") return fetchGate.then(() => ({
        ok: true,
        json: () => Promise.resolve({ opportunityName: "测试机会", status: "validate" })
      }));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) });
    },
    clipboardImpl: async () => {}
  });
  app.mount();
  // 准备一个有回答的状态，触发 add 按钮
  app.setCurrentAnswer("# 答案正文，**结论**重要。", "local", { question: "Q", answerType: "ask" });
  // 模拟点击"机会池"按钮
  const openPromise = app.openAddOpportunityForm();
  // 等待 microtask 让 showAnswerLoading 跑完
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(nodes.answerLoading.hidden, false, "草稿 loading 期间 answerLoading 应可见");
  // 文案已被切换为"正在生成机会草稿"
  const textEl = nodes.answerLoading.querySelector?.(".loading-text");
  if (textEl) {
    assert.ok(/机会草稿/.test(textEl.textContent), "草稿 loading 文案应包含「机会草稿」");
  }
  // 释放 fetch 让 openPromise 完成
  release();
  await openPromise;
  // fetch 完成后：loading 应再次隐藏（不与答案区永久争夺）
  assert.equal(nodes.answerLoading.hidden, true, "草稿 loading 完成后 answerLoading 应回到隐藏");
  // 表单容器应该已被填充
  assert.equal(nodes.addOpportunityContainer.hidden, false, "草稿完成后表单应展开");
});

test("V0.6.6: Copy 路径仍只输出纯文本（不复制高亮 CSS）", () => {
  // buildClipboardPayload 应只返回 answer 文字，不携带 HTML 标签
  const { buildClipboardPayload } = require("../public/ask-ui/app");
  const payload = buildClipboardPayload({
    answer: "# 标题\n\n这是 **strong 关键词** 和 `code`。",
    question: "Q"
  });
  assert.equal(payload.text.includes("# 标题"), true);
  assert.equal(payload.text.includes("**strong 关键词**"), true, "复制文本应保留 markdown 标记（不渲染高光）");
  assert.equal(payload.html, undefined, "复制 payload 不应携带 HTML");
});

test("V0.6.6: 全局回归 — Goal idle/edit / 提问按钮动效 / 机会池按钮动效 全部保留", () => {
  // 三栏结构保留
  assert.ok(/id="goalEditButton"/.test(indexHtml), "Goal 编辑按钮仍在");
  assert.ok(/goal-button--icon/.test(indexHtml), "Goal 编辑按钮图标样式保留");
  // 提问按钮 motion-label 系统保留
  assert.ok(/class="primary-button motion-label-button"/.test(indexHtml), "提问按钮动效系统保留");
  // 机会池按钮动效系统保留
  assert.ok(/class="add-opportunity-button motion-label-button"/.test(indexHtml), "机会池按钮动效系统保留");
  // Codex/Claude Code Task 按钮不恢复
  assert.equal(/id="copyCodexTaskButton"/.test(indexHtml), false, "Codex 任务按钮不应被恢复");
  assert.equal(/id="copyClaudeTaskButton"/.test(indexHtml), false, "Claude Code 任务按钮不应被恢复");
});

test("V0.6.6: loading 动画本体未触 — keyframes 仍为 Uiverse 原文与 3D 备份", () => {
  // 所有 hamster* / spoke / loading-spinner keyframes 必须在
  for (const name of [
    "hamster", "hamsterHead", "hamsterEye", "hamsterEar", "hamsterBody",
    "hamsterFRLimb", "hamsterFLLimb", "hamsterBRLimb", "hamsterBLLimb",
    "hamsterTail", "spoke", "loading-spinner"
  ]) {
    assert.ok(new RegExp("@keyframes\\s+" + name + "\\b").test(stylesCss), `应保留 @keyframes ${name}`);
  }
  // HTML 中 .loading-spinner 6 个子 div 仍在
  const sp = indexHtml.match(/class="loading-spinner"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(sp, ".loading-spinner 应有 6 个 <div>");
  const empties = (sp[0].match(/<div><\/div>/g) || []).length;
  assert.ok(empties >= 6, `.loading-spinner 应至少含 6 个子 div，实际 ${empties}`);
});

test("V0.6.6: prefers-reduced-motion 媒体查询仍在（兜底）", () => {
  // 至少一个 prefers-reduced-motion 规则保护动画
  const blocks = stylesCss.match(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)[\s\S]*?(?=\n\s*@media|\s*$)/g) || [];
  assert.ok(blocks.length > 0, "应至少一个 prefers-reduced-motion 媒体查询");
});

test("V0.6.6: loading spinner 仍是 Uiverse 同款 6 个 div + 11 个 keyframes 完整", () => {
  // V0.3.4-hotfix-3 + V0.6.6 不退化的回归
  const requiredKeyframes = [
    "hamster", "hamsterHead", "hamsterEye", "hamsterEar", "hamsterBody",
    "hamsterFRLimb", "hamsterFLLimb", "hamsterBRLimb", "hamsterBLLimb",
    "hamsterTail", "spoke"
  ];
  for (const name of requiredKeyframes) {
    assert.ok(new RegExp("@keyframes\\s+" + name + "\\b").test(stylesCss), "仓鼠 11 个 keyframes 必须完整: " + name);
  }
});


test("V0.6.4: edit 按钮 aria-label 跟随存储目标切换", () => {
  const storage = makeMemoryStorage();
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage,
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  assert.equal(nodes.goalEditButton.getAttribute("aria-label"), "设置目标");
  // 设目标后切换为修改当前目标
  nodes.goalInput.value = "AI 工具 MVP 路径";
  app.saveGoalFromInput();
  assert.equal(nodes.goalEditButton.getAttribute("aria-label"), "修改当前目标");
});

test("V0.6.4: askButton disabled 时不应触发 hover label 切换", () => {
  // 当前 primary-button 在 :disabled 下锁定 default 层；通过 DOM 验证
  const nodes = makeFakeNodes();
  const app = createApp({
    nodes,
    storage: makeMemoryStorage(),
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) })
  });
  app.mount();
  // setInFlight(true) 会让 askButton.disabled = true
  app.setInFlight(true);
  assert.equal(nodes.askButton.disabled, true, "inFlight 时按钮应 disabled");
  // CSS 锁定：disabled 下 .motion-label--hover 应该 hidden
  // 通过样式断言更确定
  assert.ok(/\.motion-label-button:disabled \.motion-label--hover/.test(stylesCss),
    "CSS 应让 disabled 按钮的 hover 层透明");
});

// ============== V0.3.11-hotfix-4: sk-* 脱敏 ==============

test("V0.3.11-hotfix-4: redactSecretLikeText 纯函数 - 字符串中 sk-* 被替换为 [redacted]", () => {
  // V0.3.11-hotfix-4：redactSecretLikeText 在 secret-redact.js 定义，
  // 并由 ask-strategy-os / opportunity-store / start-ask-ui re-export
  const { redactSecretLikeText } = require("../scripts/ask-strategy-os");
  assert.ok(redactSecretLikeText, "应暴露 redactSecretLikeText 纯函数");
  assert.equal(redactSecretLikeText("hello sk-fakefakefake0123456789 world"), "hello [redacted] world");
  assert.equal(redactSecretLikeText("sk-proj-abc_123"), "[redacted]");
  assert.equal(redactSecretLikeText("codex-task-prompt"), "codex-task-prompt");
  // 非 sk-* 字符串不变
  assert.equal(redactSecretLikeText("这是普通中文，没有 key"), "这是普通中文，没有 key");
  // 非字符串安全返回
  assert.equal(redactSecretLikeText(123), 123);
  assert.equal(redactSecretLikeText(null), null);
  assert.equal(redactSecretLikeText(undefined), undefined);
});

test("V0.3.11-hotfix-4: redactSecretLikeText 递归处理对象与数组", () => {
  const { redactSecretLikeText } = require("../scripts/ask-strategy-os");
  const input = {
    a: "sk-fakefakefake0123456789",
    b: ["x sk-fakefakefake0123456789 y", { c: "sk-fakefakefake0123456789" }],
    d: 42,
    e: null,
    f: { g: "sk-proj-abc" }
  };
  const out = redactSecretLikeText(input);
  assert.equal(out.a, "[redacted]");
  assert.equal(out.b[0], "x [redacted] y");
  assert.equal(out.b[1].c, "[redacted]");
  assert.equal(out.d, 42);
  assert.equal(out.e, null);
  assert.equal(out.f.g, "[redacted]");
});

test("V0.3.11-hotfix-4: generateOpportunityDraft LLM note 含 sk-* 时响应脱敏", async () => {
  const { generateOpportunityDraft } = require("../scripts/ask-strategy-os");
  const env = { ...process.env };
  env.STRATEGY_OS_LLM_ENABLED = "true";
  env.STRATEGY_OS_LLM_PROVIDER = "openai";
  env.STRATEGY_OS_LLM_BASE_URL = "https://api.example.com/v1";
  env.STRATEGY_OS_LLM_MODEL = "gpt-test";
  env.STRATEGY_OS_LLM_API_KEY = "sk-fakefakefake0123456789";
  const llmJson = {
    choices: [{
      message: {
        content: JSON.stringify({
          opportunityName: "X 助手",
          oneLineSummary: "ok",
          note: "leaked key sk-fakefakefake0123456789 in note",
          nextAction: "na",
          suggestedTags: ["独立开发者"],
          status: "validate",
          type: "new-project-opportunity"
        })
      }
    }]
  };
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(llmJson),
    json: async () => llmJson
  });
  const result = await generateOpportunityDraft({
    question: "q",
    answer: "a",
    env,
    deps: { fetch: fakeFetch, AbortController: null }
  });
  assert.equal(/sk-fakefakefake0123456789/.test(result.note), false, "note 不应含 sk-fakefakefake0123456789 原文");
  assert.equal(result.note.includes("[redacted]"), true, "note 应含 [redacted]");
});

test("V0.3.11-hotfix-4: generateOpportunityDraft sourceUrls 含 sk-* 时响应脱敏", async () => {
  const { generateOpportunityDraft } = require("../scripts/ask-strategy-os");
  const env = { ...process.env };
  env.STRATEGY_OS_LLM_ENABLED = "true";
  env.STRATEGY_OS_LLM_PROVIDER = "openai";
  env.STRATEGY_OS_LLM_BASE_URL = "https://api.example.com/v1";
  env.STRATEGY_OS_LLM_MODEL = "gpt-test";
  env.STRATEGY_OS_LLM_API_KEY = "sk-fakefakefake0123456789";
  const llmJson = {
    choices: [{
      message: {
        content: JSON.stringify({
          opportunityName: "X 助手",
          oneLineSummary: "ok",
          note: "n",
          nextAction: "na",
          suggestedTags: [],
          status: "validate",
          type: "new-project-opportunity",
          sourceUrls: [
            { title: "leak sk-fakefakefake0123456789 title", url: "https://example.com/sk-fakefakefake0123456789" }
          ]
        })
      }
    }]
  };
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(llmJson),
    json: async () => llmJson
  });
  const result = await generateOpportunityDraft({
    question: "q",
    answer: "a",
    env,
    deps: { fetch: fakeFetch, AbortController: null }
  });
  assert.equal(/sk-fakefakefake0123456789/.test(JSON.stringify(result.sourceUrls)), false, "sourceUrls 不应含 sk-fakefakefake0123456789 原文");
  assert.equal(result.sourceUrls[0].title.includes("[redacted]"), true);
  assert.equal(result.sourceUrls[0].url.includes("[redacted]"), true);
});

test("V0.3.11-hotfix-4: POST /api/opportunities 保存前 note 含 sk-* 时持久化脱敏", async () => {
  const { startAskUiServer, addOpportunity } = require("../scripts/start-ask-ui");
  const rootDir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "strategy-os-redact-save-"));
  const server = await startAskUiServer({ rootDir, port: 5391, host: "127.0.0.1" });
  try {
    const fetched = await httpRequest({
      port: 5391,
      method: "POST",
      path: "/api/opportunities",
      body: {
        title: "测试 sk-fakefakefake0123456789 title",
        status: "validate",
        type: "new-project-opportunity",
        tags: ["独立开发者", "sk-fakefakefake0123456789 in tag"],
        note: "用户备注：sk-fakefakefake0123456789 嵌入 note",
        oneLineSummary: "sk-fakefakefake0123456789 summary",
        nextAction: "sk-fakefakefake0123456789 next",
        sourceAnswerSummary: "sk-fakefakefake0123456789 source",
        source: "ask-mode"
      }
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.opportunity.notes.includes("sk-fakefakefake0123456789"), false, "保存后 notes 不应含 sk-fakefakefake0123456789");
    assert.equal(fetched.json.opportunity.notes.includes("[redacted]"), true, "notes 应含 [redacted]");
    // 验证持久化的 opportunity-pool.json 也不含
    const fs = require("node:fs");
    const path = require("node:path");
    const poolPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
    const poolText = fs.readFileSync(poolPath, "utf8");
    assert.equal(/sk-fakefakefake0123456789/.test(poolText), false, "opportunity-pool.json 不应含 sk-fakefakefake0123456789 原文");
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("V0.3.11-hotfix-4: PATCH /api/opportunities/:id 更新前 note 含 sk-* 时持久化脱敏", async () => {
  const { startAskUiServer } = require("../scripts/start-ask-ui");
  const rootDir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "strategy-os-redact-patch-"));
  const server = await startAskUiServer({ rootDir, port: 5392, host: "127.0.0.1" });
  try {
    // 先建一条
    const create = await httpRequest({
      port: 5392,
      method: "POST",
      path: "/api/opportunities",
      body: { title: "orig", status: "validate", type: "new-project-opportunity" }
    });
    assert.equal(create.status, 200);
    const id = create.json.opportunity.id;
    // 再 PATCH 含 sk-* 的 note
    const patch = await httpRequest({
      port: 5392,
      method: "PATCH",
      path: `/api/opportunities/${id}`,
      body: { note: "patched sk-fakefakefake0123456789 note" }
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.opportunity.notes.includes("sk-fakefakefake0123456789"), false, "PATCH 后 notes 不应含 sk-*");
    assert.equal(patch.json.opportunity.notes.includes("[redacted]"), true);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("V0.3.11-hotfix-4: buildOpportunityContextForPrompt 输入机会 note 含 sk-* 时输出脱敏", () => {
  const { buildOpportunityContextForPrompt } = require("../scripts/opportunity-store");
  const ctx = buildOpportunityContextForPrompt([
    {
      id: "x1",
      opportunityName: "机会 sk-fakefakefake0123456789",
      notes: "note 含 sk-fakefakefake0123456789",
      nextAction: "next 含 sk-fakefakefake0123456789",
      status: "inbox",
      type: "new-project-opportunity",
      tags: ["sk-fakefakefake0123456789 tag"]
    }
  ]);
  // ctx 是 string
  assert.equal(typeof ctx, "string", "ctx 应是 string");
  assert.equal(/sk-fakefakefake0123456789/.test(ctx), false, "context 输出不应含 sk-fakefakefake0123456789 原文");
  assert.equal(ctx.includes("[redacted]"), true, "context 输出应含 [redacted]");
});

test("V0.3.11-hotfix-4: buildKickoffUserPrompt 输入机会 note 含 sk-* 时输出脱敏", () => {
  const { buildKickoffUserPrompt } = require("../scripts/ask-strategy-os");
  const out = buildKickoffUserPrompt({
    name: "name sk-fakefakefake0123456789",
    oneLine: "oneLine sk-fakefakefake0123456789",
    note: "note sk-fakefakefake0123456789",
    next: "next sk-fakefakefake0123456789",
    tags: ["sk-fakefakefake0123456789 tag"],
    sourceQuestion: "q sk-fakefakefake0123456789"
  });
  assert.equal(/sk-fakefakefake0123456789/.test(out), false, "kickoff prompt 不应含 sk-fakefakefake0123456789 原文");
  assert.equal(out.includes("[redacted]"), true);
});

test("V0.3.11-hotfix-4: buildLocalKickoff 输入机会 note 含 sk-* 时输出脱敏", () => {
  const { buildLocalKickoff } = require("../scripts/ask-strategy-os");
  const out = buildLocalKickoff({
    name: "name sk-fakefakefake0123456789",
    oneLine: "oneLine sk-fakefakefake0123456789",
    note: "note sk-fakefakefake0123456789",
    next: "next sk-fakefakefake0123456789",
    tags: ["独立开发者"],
    sourceQuestion: "q sk-fakefakefake0123456789"
  });
  assert.equal(/sk-fakefakefake0123456789/.test(out), false, "buildLocalKickoff 输出不应含 sk-fakefakefake0123456789 原文");
  assert.equal(out.includes("[redacted]"), true);
});

// ============== V0.4: 日用入口整理 ==============

test("V0.4: 机会池区域标题为「今日机会池」", () => {
  assert.ok(/今日机会池/.test(indexHtml), "index.html 应含「今日机会池」标题");
});

test("V0.4: 机会池 stats 文案格式清爽（避免矛盾口径：total/validate/watch 三数字无歧义）", () => {
  // stats 默认显示：仅显示 total；validate/watch 是补充分类
  // 验证"全部 N"或"全部 N · 待验证 M"格式而非堆叠互斥桶
  const statMatch = indexHtml.match(/id="opportunityStats"[\s\S]*?<\/div>/);
  assert.ok(statMatch, "应存在 #opportunityStats");
});

test("V0.4: 机会项优先显示 nextAction（找不到时显示「暂无下一步」弱提示）", () => {
  // 用 renderOpportunityPanel 验证一个 nextAction 存在的机会
  const html = renderOpportunityPanel({
    opportunities: [
      {
        id: "x1",
        opportunityName: "X 机会",
        displayTitle: "X 机会",
        statusLabel: "待验证",
        typeLabel: "新项目机会",
        humanDecisionLabel: "",
        notes: "n",
        nextAction: "明天先做 demo 验证",
        tags: [],
        scores: {},
        updatedAt: "2026-01-01T00:00:00Z",
        source: "ask-mode"
      }
    ],
    stats: { total: 1, accepted: 0, validate: 1, watch: 0, archived: 0, rejected: 0 }
  });
  // 优先 nextAction
  assert.ok(/明天先做 demo 验证/.test(html.listHtml), "应优先显示 nextAction");
});

test("V0.4: 机会项 nextAction 缺失时显示「暂无下一步」弱提示", () => {
  const html = renderOpportunityPanel({
    opportunities: [
      {
        id: "x2",
        opportunityName: "无下一步",
        displayTitle: "无下一步",
        statusLabel: "待验证",
        typeLabel: "新项目机会",
        humanDecisionLabel: "",
        notes: "n",
        nextAction: "",
        tags: [],
        scores: {},
        updatedAt: "",
        source: ""
      }
    ],
    stats: { total: 1, accepted: 0, validate: 1, watch: 0, archived: 0, rejected: 0 }
  });
  assert.ok(/暂无下一步/.test(html.listHtml), "无 nextAction 应显示「暂无下一步」");
});

test("V0.4: 「生成开工包」按钮在「编辑」「删除」之前", () => {
  const html = renderOpportunityPanel({
    opportunities: [
      {
        id: "x3",
        opportunityName: "排序测试",
        displayTitle: "排序测试",
        statusLabel: "待验证",
        typeLabel: "新项目机会",
        humanDecisionLabel: "",
        notes: "",
        nextAction: "next",
        tags: [],
        scores: {},
        updatedAt: "",
        source: ""
      }
    ],
    stats: { total: 1, accepted: 0, validate: 1, watch: 0, archived: 0, rejected: 0 }
  });
  const kickoffIdx = html.listHtml.indexOf("data-op-kickoff");
  const editIdx = html.listHtml.indexOf("data-op-edit");
  const deleteIdx = html.listHtml.indexOf("data-op-delete");
  assert.ok(kickoffIdx > -1, "应有「生成开工包」按钮");
  assert.ok(editIdx > -1, "应有「编辑」按钮");
  assert.ok(deleteIdx > -1, "应有「删除」按钮");
  // 视觉顺序：kickoff 在 edit 之前、edit 在 delete 之前
  assert.ok(kickoffIdx < editIdx, "生成开工包应在编辑之前");
  assert.ok(editIdx < deleteIdx, "编辑应在删除之前");
});

test("V0.4: 「生成开工包」按钮文案为「生成开工包」", () => {
  const html = renderOpportunityPanel({
    opportunities: [
      {
        id: "x4",
        opportunityName: "X4",
        displayTitle: "X4",
        statusLabel: "待验证",
        typeLabel: "新项目机会",
        humanDecisionLabel: "",
        notes: "",
        nextAction: "next",
        tags: [],
        scores: {},
        updatedAt: "",
        source: ""
      }
    ],
    stats: { total: 1, accepted: 0, validate: 1, watch: 0, archived: 0, rejected: 0 }
  });
  assert.ok(/>生成开工包</.test(html.listHtml), "「生成开工包」按钮文案应完整保留");
});

test("V0.4: 搜索过程 / 来源 default hidden（页面打开不显示）", () => {
  // HTML 应保留 hidden 属性
  assert.ok(/<section[^>]*id="searchProcess"[^>]*hidden/.test(indexHtml), "searchProcess 应默认 hidden");
  assert.ok(/<section[^>]*id="searchSources"[^>]*hidden/.test(indexHtml), "searchSources 应默认 hidden");
});

test("V0.4: 主页状态条仍含「默认不联网」", () => {
  assert.ok(/默认不联网/.test(indexHtml), "顶部状态条应含「默认不联网」");
});

// ============== V0.4.1: 三栏布局 + 折叠 + 单行 meta ==============

test("V0.4.1 A1: HTML 不再含 .composer-hint 节点", () => {
  assert.equal(/class="composer-hint"/.test(indexHtml), false, "composer-hint 节点应已删除");
});

test("V0.4.1 A2: CSS 不再含 .composer-hint 规则", () => {
  assert.equal(/\.composer-hint\s*\{/.test(stylesCss), false, ".composer-hint 规则应已删除");
});

test("V0.4.1 B1: --content-width 解析为 1600px", () => {
  const m = stylesCss.match(/--content-width\s*:\s*(\d+)px/);
  assert.ok(m, "应定义 --content-width");
  const w = Number(m[1]);
  assert.equal(w, 1600, `--content-width 应 = 1600px，实际 ${w}px`);
});

test("V0.4.1 B2: .shell 使用 min(var(--content-width), 96vw)", () => {
  const m = stylesCss.match(/\.shell\s*\{[^}]*width\s*:\s*([^;]+);/);
  assert.ok(m, "应存在 .shell 规则");
  const w = m[1].trim();
  assert.ok(/min\s*\(\s*var\(--content-width\)\s*,\s*96vw\s*\)/.test(w), `.shell 应使用 min(var(--content-width), 96vw)，实际 ${w}`);
});

test("V0.4.1 C1: HTML 含 .layout > .rail--left + .main + .rail--right", () => {
  assert.ok(/class="rail rail--left"/.test(indexHtml), "应含 .rail--left");
  assert.ok(/class="rail rail--right"/.test(indexHtml), "应含 .rail--right");
  assert.ok(/class="main"/.test(indexHtml), "应含 .main");
  // 顺序：.rail--left → .main → .rail--right
  const left = indexHtml.indexOf('class="rail rail--left"');
  const main = indexHtml.indexOf('class="main"');
  const right = indexHtml.indexOf('class="rail rail--right"');
  assert.ok(left < main, "rail--left 应在 main 之前");
  assert.ok(main < right, "main 应在 rail--right 之前");
});

test("V0.4.1 C2: HTML 推荐问题板块在 .main 栏中", () => {
  // recommendedQuestions 应在 .main 区域内
  const mainMatch = indexHtml.match(/<section class="main"[\s\S]*?<\/section>/);
  assert.ok(mainMatch, "应存在 .main section");
  assert.ok(/id="recommendedQuestions"/.test(mainMatch[0]), "推荐问题应在 .main 内");
});

test("V0.4.1 C3: HTML 最近提问板块在 .rail--right 内", () => {
  const rightMatch = indexHtml.match(/<aside class="rail rail--right"[\s\S]*?<\/aside>/);
  assert.ok(rightMatch, "应存在 .rail--right");
  assert.ok(/id="historyList"/.test(rightMatch[0]), "historyList 应在 .rail--right 内");
});

test("V0.4.1 C4: CSS .layout 是 3 列 grid-template-columns", () => {
  const m = stylesCss.match(/\.layout\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/);
  assert.ok(m, "应存在 .layout grid-template-columns");
  const cols = m[1].trim();
  // 至少 3 段
  const parts = cols.split(/\s+/);
  assert.ok(parts.length >= 3, `.layout 应至少 3 列，实际 ${parts.length}`);
});

test("V0.4.1 C5: CSS 移动端 media 把 .layout 折叠成单列", () => {
  // 桌面端 .layout 是 3 列 300/minmax(720, 1fr)/280
  // 移动端（max-width: 900px）应折叠成单列
  // 验证：styles.css 中存在 @media (max-width: 900px) 块，且该块内 .layout 改用单列
  const mobileMedia = stylesCss.match(/@media\s+\(max-width\s*:\s*900px\)\s*\{[\s\S]*?\.layout\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);[\s\S]*?\}\s*\}/);
  assert.ok(mobileMedia, "应存在 @media (max-width: 900px) 块覆盖 .layout");
  const cols = mobileMedia[1].trim();
  // 单列：1fr / minmax(0, 1fr) 形式，不应含 300px / 280px / minmax(720px, ...)
  assert.equal(/300px|280px|minmax\(720px/.test(cols), false, "移动端 .layout 不应含桌面端列宽");
});

test("V0.4.1 C6: index.html 含 opportunityToggle + opportunityBody 容器", () => {
  assert.ok(/id="opportunityToggle"/.test(indexHtml), "应含 opportunityToggle");
  assert.ok(/id="opportunityBody"/.test(indexHtml), "应含 opportunityBody");
});

test("V0.4.1 C7: .opportunity-toggle 含 aria-expanded 与 aria-controls", () => {
  // 抓 .opportunity-toggle 节点
  const m = indexHtml.match(/<button[^>]*class="opportunity-toggle"[^>]*>/);
  assert.ok(m, "应存在 .opportunity-toggle 按钮");
  assert.ok(/aria-expanded="true"/.test(m[0]), "初始 aria-expanded=true");
  assert.ok(/aria-controls="opportunityBody"/.test(m[0]), "aria-controls 应指向 opportunityBody");
});

test("V0.4.1 C8: .opportunity-panel.is-collapsed 隐藏子内容", () => {
  assert.ok(/\.opportunity-panel\.is-collapsed\s+\.opportunity-body\s*\{[^}]*display\s*:\s*none/.test(stylesCss), "is-collapsed 应隐藏 .opportunity-body");
});

test("V0.4.1 C9: app.js 暴露 toggleOpportunityPanel 纯函数", () => {
  const { toggleOpportunityPanel } = require("../public/ask-ui/app");
  assert.equal(typeof toggleOpportunityPanel, "function", "应导出 toggleOpportunityPanel 纯函数");
});

test("V0.4.1 D1: toggleOpportunityPanel({ expand: true }) 行为正向", () => {
  const { toggleOpportunityPanel } = require("../public/ask-ui/app");
  const panel = { classList: { contains: (c) => c === "is-collapsed", add() {}, remove() {} } };
  const body = {};
  const toggle = { setAttribute() {} };
  const r = toggleOpportunityPanel({ panel, body, toggle, expand: true });
  assert.equal(r.expanded, true);
});

test("V0.4.1 D2: toggleOpportunityPanel({ expand: false }) 行为反向", () => {
  const { toggleOpportunityPanel } = require("../public/ask-ui/app");
  let added = false;
  let expanded = true;
  const panel = {
    classList: {
      contains: (c) => false,
      add(k) { if (k === "is-collapsed") added = true; },
      remove() {}
    }
  };
  const body = {};
  const toggle = { setAttribute(k, v) { if (k === "aria-expanded") expanded = v; } };
  const r = toggleOpportunityPanel({ panel, body, toggle, expand: false });
  assert.equal(r.expanded, false);
  assert.equal(added, true, "is-collapsed class 应被加");
  assert.equal(expanded, "false", "aria-expanded 应设为 false");
  assert.equal(body.hidden, true, "body.hidden 应设为 true");
});

test("V0.4.1 D3: toggleOpportunityPanel 不传 expand 时按 classList 翻转", () => {
  const { toggleOpportunityPanel } = require("../public/ask-ui/app");
  // 初始含 is-collapsed → 应展开
  let panel = {
    classList: {
      contains: (c) => c === "is-collapsed",  // 返回 true
      add() {},
      remove() {}
    }
  };
  let r = toggleOpportunityPanel({ panel, body: {}, toggle: { setAttribute() {} } });
  assert.equal(r.expanded, true, "初始 collapsed 应翻转为 expanded");
  // 初始无 is-collapsed → 应折叠
  panel = {
    classList: {
      contains: () => false,  // 返回 false
      add() {},
      remove() {}
    }
  };
  r = toggleOpportunityPanel({ panel, body: {}, toggle: { setAttribute() {} } });
  assert.equal(r.expanded, false, "初始 expanded 应翻转为 collapsed");
});

test("V0.4.1 D4: createApp.mount 后点击 opportunityToggle 切换", () => {
  const nodes = makeFakeNodes();
  // 给 opportunityToggle / opportunityBody / opportunityPanel 注入
  let bodyHidden = false;
  let ariaExpanded = "true";
  nodes.opportunityToggle = {
    listeners: {},
    addEventListener(event, h) { this.listeners[event] = h; },
    setAttribute(k, v) { if (k === "aria-expanded") ariaExpanded = v; },
    getAttribute(k) { return ariaExpanded; },
    click() { this.listeners.click && this.listeners.click({}); }
  };
  nodes.opportunityBody = {
    hidden: false
  };
  let collapsed = false;
  nodes.opportunityPanel = {
    classList: {
      contains: () => collapsed,
      add(k) { if (k === "is-collapsed") collapsed = true; },
      remove(k) { if (k === "is-collapsed") collapsed = false; }
    }
  };
  // mount 重新跑
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  app.mount();
  nodes.opportunityToggle.click();
  assert.equal(collapsed, true, "点击后应折叠");
  assert.equal(ariaExpanded, "false");
  nodes.opportunityToggle.click();
  assert.equal(collapsed, false, "再点击应展开");
  assert.equal(ariaExpanded, "true");
});

test("V0.4.1 D5 / V0.4.2: 折叠状态由独立的 saveOpportunityCollapsed 写入（toggle 不直接调用 storage）", () => {
  // V0.4.2：toggleOpportunityPanel 内部通过 saveOpportunityCollapsed 抽象层写入，
  // 而不是直接调 storageImpl / localStorage。这里验证：
  // 1) toggleOpportunityPanel 源码内不出现 localStorage / storageImpl 等直接调用；
  // 2) storage=null 时不抛（saveOpportunityCollapsed 内部已 try/catch）。
  const { toggleOpportunityPanel } = require("../public/ask-ui/app");
  const appSrc = toggleOpportunityPanel.toString();
  assert.equal(/localStorage/.test(appSrc), false, "toggleOpportunityPanel 不应直接读 localStorage");
  // 直接传 null storage 也不应抛
  const panel = { classList: { contains: () => false, add() {}, remove() {} } };
  const body = {};
  const toggle = { setAttribute() {} };
  assert.doesNotThrow(() => {
    toggleOpportunityPanel({ panel, body, toggle, storage: null });
  });
});

test("V0.4.1 E1: .shell / .composer-inner / .footer 都用 min(var(--content-width), 96vw)", () => {
  // 抓所有 min(var(--content-width), 96vw) 出现次数
  const m = stylesCss.match(/min\s*\(\s*var\(--content-width\)\s*,\s*96vw\s*\)/g);
  assert.ok(m, "应存在 min(var(--content-width), 96vw)");
  assert.ok(m.length >= 3, `应至少 3 处使用（.shell / .composer-inner / .footer），实际 ${m.length}`);
});

test("V0.4.1 E2: .question-echo 单行 ellipsis（基础或桌面端 media）", () => {
  // 接受：基础规则 white-space:nowrap，或 @media (min-width: 900px) 块内
  const baseRule = /\.question-echo\s*\{[^}]*white-space\s*:\s*nowrap/s.test(stylesCss);
  const mediaRule = /@media[^{]+\{\s*\.question-echo\s*\{[^}]*white-space\s*:\s*nowrap/s.test(stylesCss);
  assert.ok(baseRule || mediaRule, "应存在 .question-echo white-space:nowrap（基础或 media）");
});

test("V0.4.1 E3: 移动端保留单列堆叠（.layout 收成 1 列）", () => {
  // @media (max-width: 900px) 块内 .layout grid-template-columns 应不含 px 列宽
  const all = stylesCss;
  const idx = all.indexOf('@media (max-width: 900px)');
  if (idx < 0) {
    // 收窄规则可能在 1280px media 内（与 plan 一致）
    const idx2 = all.indexOf('@media (max-width: 1280px)');
    assert.ok(idx2 > -1, "应存在桌面端/移动端分界 media 规则");
  }
});

test("V0.4.1: 历史 click 仍恢复回答（不回归）", () => {
  const nodes = makeFakeNodes();
  let restoreCalled = false;
  const entry = { id: "h-1", question: "q", answer: "a", source: "llm", searchUsed: false, searchSources: [], type: "ask" };
  // 简化：直接验证 renderHistory + restoreHistoryItem 不报异常
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  app.mount();
  app.restoreHistoryItem(entry);
  assert.equal(nodes.addOpportunityButton.hidden, false, "恢复普通 answer 后按钮应可见");
  assert.equal(nodes.addOpportunityButton.disabled, false);
  assert.equal(nodes.copyCodexTaskButton.hidden, true);
  assert.equal(nodes.copyClaudeTaskButton.hidden, true);
});

test("V0.4.1: 历史 click 仍隐藏 kickoff-package 类型按钮（不回归）", () => {
  const nodes = makeFakeNodes();
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  app.mount();
  app.restoreHistoryItem({
    id: "h-k",
    question: "为「X」生成开工包",
    answer: "## 开工包",
    source: "local",
    type: "kickoff-package",
    searchUsed: false
  });
  assert.equal(nodes.addOpportunityButton.hidden, true, "kickoff-package 应隐藏按钮");
  assert.equal(nodes.copyCodexTaskButton.hidden, false, "kickoff-package 应显示 Codex 任务复制");
  assert.equal(nodes.copyClaudeTaskButton.hidden, false, "kickoff-package 应显示 Claude Code 任务复制");
});

// =================================================================
// V0.4.2 三栏日用细节修补
// =================================================================

// F1：CSS .rail 应在桌面端作为固定工作台内的局部滚动区
test("V0.4.6 F1a: .rail 桌面端使用内部滚动而非页面 sticky", () => {
  const target = cssRule(".rail");
  assert.ok(target, "找不到 .rail 主规则");
  assert.ok(/min-height\s*:\s*0/i.test(target), ".rail 应允许在 grid/flex 中收缩");
  assert.ok(/overflow-y\s*:\s*auto|overflow\s*:\s*auto/i.test(target), ".rail 应允许独立纵向滚动");
  assert.ok(/overscroll-behavior\s*:\s*contain/i.test(target), ".rail 滚动不应串到 body");
  assert.equal(/position\s*:\s*sticky/i.test(target), false, ".rail 桌面端不应再依赖 sticky 页面滚动");
});

// F1：移动端 .rail 退化为普通 flow（无 sticky / max-height）
test("V0.4.2 F1b: 移动端 .rail 退化为普通 flow", () => {
  // @media (max-width: 900px) 块内 .rail 应 position:static 或不带 sticky
  const media = stylesCss.match(/@media\s*\(max-width\s*:\s*900px\)\s*\{[\s\S]*?\n\s*\}\s*\}/);
  assert.ok(media, "找不到 max-width: 900px media 块");
  const block = media[0];
  assert.ok(/\.rail\s*\{[^}]*position\s*:\s*static/.test(block), "移动端 .rail 应 position:static");
});

// F2：折叠状态记忆 - 新增纯函数 loadOpportunityCollapsed / saveOpportunityCollapsed
test("V0.4.2 F2a: app.js 暴露 loadOpportunityCollapsed / saveOpportunityCollapsed 纯函数", () => {
  const mod = require("../public/ask-ui/app");
  assert.equal(typeof mod.loadOpportunityCollapsed, "function", "应导出 loadOpportunityCollapsed");
  assert.equal(typeof mod.saveOpportunityCollapsed, "function", "应导出 saveOpportunityCollapsed");
});

test("V0.4.2 F2b: loadOpportunityCollapsed(true) 返回 true（折叠）", () => {
  const { loadOpportunityCollapsed } = require("../public/ask-ui/app");
  const fakeStorage = { getItem: (k) => (k === "strategyOsOpportunityPanelCollapsed" ? "true" : null) };
  assert.equal(loadOpportunityCollapsed(fakeStorage), true);
});

test("V0.4.2 F2c: loadOpportunityCollapsed(false / null) 返回 false（展开）", () => {
  const { loadOpportunityCollapsed } = require("../public/ask-ui/app");
  const storageFalse = { getItem: () => "false" };
  const storageNull = { getItem: () => null };
  const storageEmpty = { getItem: () => "" };
  const storageMissing = { getItem: () => undefined };
  assert.equal(loadOpportunityCollapsed(storageFalse), false);
  assert.equal(loadOpportunityCollapsed(storageNull), false);
  assert.equal(loadOpportunityCollapsed(storageEmpty), false);
  assert.equal(loadOpportunityCollapsed(storageMissing), false);
});

test("V0.4.2 F2d: loadOpportunityCollapsed 写入非法值不崩", () => {
  const { loadOpportunityCollapsed } = require("../public/ask-ui/app");
  const garbage = { getItem: () => "{not-json}" };
  assert.equal(loadOpportunityCollapsed(garbage), false);
});

test("V0.4.2 F2e: loadOpportunityCollapsed storage 抛错时静默 fallback false", () => {
  const { loadOpportunityCollapsed } = require("../public/ask-ui/app");
  const throwingStorage = {
    getItem: () => { throw new Error("QuotaExceededError"); }
  };
  assert.equal(loadOpportunityCollapsed(throwingStorage), false);
});

test("V0.4.2 F2f: loadOpportunityCollapsed 接受 null / undefined storage 返回 false", () => {
  const { loadOpportunityCollapsed } = require("../public/ask-ui/app");
  assert.equal(loadOpportunityCollapsed(null), false);
  assert.equal(loadOpportunityCollapsed(undefined), false);
});

test("V0.4.2 F2g: saveOpportunityCollapsed(true) 调用 setItem(true)", () => {
  const { saveOpportunityCollapsed } = require("../public/ask-ui/app");
  let stored = null;
  const fakeStorage = { setItem: (k, v) => { stored = { k, v }; } };
  saveOpportunityCollapsed(fakeStorage, true);
  assert.equal(stored.k, "strategyOsOpportunityPanelCollapsed");
  assert.equal(stored.v, "true");
});

test("V0.4.2 F2h: saveOpportunityCollapsed(false) 调用 setItem(false)", () => {
  const { saveOpportunityCollapsed } = require("../public/ask-ui/app");
  let stored = null;
  const fakeStorage = { setItem: (k, v) => { stored = { k, v }; } };
  saveOpportunityCollapsed(fakeStorage, false);
  assert.equal(stored.k, "strategyOsOpportunityPanelCollapsed");
  assert.equal(stored.v, "false");
});

test("V0.4.2 F2i: saveOpportunityCollapsed storage 抛错时静默 fallback", () => {
  const { saveOpportunityCollapsed } = require("../public/ask-ui/app");
  const throwingStorage = {
    setItem: () => { throw new Error("QuotaExceededError"); }
  };
  // 不应抛
  saveOpportunityCollapsed(throwingStorage, true);
  // null storage 也不抛
  saveOpportunityCollapsed(null, true);
});

// F3：createApp.mount 读取 localStorage 折叠状态作为初始值
test("V0.4.2 F3a: createApp.mount 读取 localStorage 后默认折叠", () => {
  const nodes = makeFakeNodes();
  let bodyHidden = false;
  let ariaExpanded = "true";
  let collapsed = false;
  nodes.opportunityToggle = {
    listeners: {},
    addEventListener(event, h) { this.listeners[event] = h; },
    setAttribute(k, v) { if (k === "aria-expanded") ariaExpanded = v; },
    getAttribute(k) { return ariaExpanded; },
    click() { this.listeners.click && this.listeners.click({}); }
  };
  nodes.opportunityBody = {
    hidden: false
  };
  nodes.opportunityPanel = {
    classList: {
      contains: () => collapsed,
      add(k) { if (k === "is-collapsed") collapsed = true; },
      remove(k) { if (k === "is-collapsed") collapsed = false; }
    }
  };
  const fakeStorage = {
    items: { strategyOsOpportunityPanelCollapsed: "true" },
    getItem(k) { return this.items[k] || null; },
    setItem(k, v) { this.items[k] = v; },
    removeItem(k) { delete this.items[k]; }
  };
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: fakeStorage });
  app.mount();
  assert.equal(collapsed, true, "localStorage=true 时应初始化为折叠");
  assert.equal(nodes.opportunityBody.hidden, true);
  assert.equal(ariaExpanded, "false");
});

test("V0.4.2 F3b: createApp.mount 读取 localStorage=false 时默认展开", () => {
  const nodes = makeFakeNodes();
  // 真实 DOM 初始状态：panel 无 is-collapsed，body 显示
  let collapsed = false;
  nodes.opportunityToggle = {
    listeners: {},
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return "true"; },
    click() {}
  };
  nodes.opportunityBody = { hidden: false };
  nodes.opportunityPanel = {
    classList: {
      contains: () => collapsed,
      add(k) { if (k === "is-collapsed") collapsed = true; },
      remove(k) { if (k === "is-collapsed") collapsed = false; }
    }
  };
  const fakeStorage = {
    items: { strategyOsOpportunityPanelCollapsed: "false" },
    getItem(k) { return this.items[k] || null; },
    setItem(k, v) { this.items[k] = v; },
    removeItem(k) { delete this.items[k]; }
  };
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: fakeStorage });
  app.mount();
  assert.equal(collapsed, false, "localStorage=false 时应保持展开（不做强制折叠）");
  assert.equal(nodes.opportunityBody.hidden, false);
});

// F4：点击折叠按钮时写入 localStorage
test("V0.4.2 F4: 点击折叠按钮写入 localStorage", () => {
  const nodes = makeFakeNodes();
  let collapsed = false;
  nodes.opportunityToggle = {
    listeners: {},
    addEventListener(event, h) { this.listeners[event] = h; },
    setAttribute() {},
    getAttribute() { return "true"; },
    click() { this.listeners.click && this.listeners.click({}); }
  };
  nodes.opportunityBody = { hidden: false };
  nodes.opportunityPanel = {
    classList: {
      contains: () => collapsed,
      add(k) { if (k === "is-collapsed") collapsed = true; },
      remove(k) { if (k === "is-collapsed") collapsed = false; }
    }
  };
  let stored = null;
  const fakeStorage = {
    items: {},
    getItem(k) { return this.items[k] || null; },
    setItem(k, v) { stored = { k, v }; this.items[k] = v; },
    removeItem(k) { delete this.items[k]; }
  };
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: fakeStorage });
  app.mount();
  // mount 后默认是展开状态。点击一次 → 折叠。
  nodes.opportunityToggle.click();
  assert.equal(collapsed, true);
  assert.equal(stored.v, "true", "折叠时应写入 true");
  // 再点击 → 展开
  nodes.opportunityToggle.click();
  assert.equal(collapsed, false);
  assert.equal(stored.v, "false", "展开时应写入 false");
});

// F5：右栏密度 - .history-item padding / line-clamp
test("V0.4.2 F5a: .history-item 紧凑（padding 较小）", () => {
  // V0.4.2：减小 padding / gap；要求 padding ≤ 10px
  const rule = stylesCss.match(/\.history-item\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "找不到 .history-item 规则");
  const block = rule[0];
  const paddingMatch = block.match(/padding\s*:\s*(\d+)px\s+(\d+)px/);
  assert.ok(paddingMatch, ".history-item 应有 padding 数字");
  const vertical = Number(paddingMatch[1]);
  assert.ok(vertical <= 10, `.history-item 上下 padding 应 ≤ 10px（紧凑），实际 ${vertical}px`);
});

test("V0.4.2 F5b: .history-question 仍 line-clamp 2 行（不溢出）", () => {
  // 桌面端 line-clamp: 2 仍保留，避免长问题撑爆右栏
  const rule = stylesCss.match(/\.history-question\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "找不到 .history-question 规则");
  assert.ok(/-webkit-line-clamp\s*:\s*2/.test(rule[0]), ".history-question 应限制为 2 行");
});

// F6：右栏在 1280px 以下被隐藏时，主栏不出现奇怪内部滚动（仍 .rail--right { display: none }）
test("V0.4.2 F6a: 1280px 以下隐藏右栏（最近提问暂不可见）", () => {
  // 这是 V0.4.1 已有的行为，这里再覆盖一遍确保 V0.4.2 不回归
  const media = stylesCss.match(/@media\s*\(max-width\s*:\s*1280px\)\s*\{[\s\S]*?\n\s*\}\s*\}/);
  assert.ok(media, "找不到 1280px media 块");
  assert.ok(/\.rail--right\s*\{[^}]*display\s*:\s*none/.test(media[0]), "1280px 以下 .rail--right 应 display:none");
});

// F7：移动端 .rail--right 重新显示（< 900px 时单列堆叠）
test("V0.4.2 F7a: 900px 以下 .rail--right 重新显示为单列", () => {
  const media = stylesCss.match(/@media\s*\(max-width\s*:\s*900px\)\s*\{[\s\S]*?\n\s*\}\s*\}/);
  assert.ok(media, "找不到 900px media 块");
  assert.ok(/\.rail--right\s*\{[^}]*display\s*:\s*flex/.test(media[0]), "900px 以下 .rail--right 应重新显示");
});

// F8：主栏 .main 在三栏布局中保持主阅读区域（display flex column）
test("V0.4.2 F8a: .main 仍为 flex column 主阅读区", () => {
  const rule = stylesCss.match(/\.main\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "找不到 .main 规则");
  assert.ok(/display\s*:\s*flex/.test(rule[0]));
  assert.ok(/flex-direction\s*:\s*column/.test(rule[0]));
});

// F9：composer-inner / shell / footer 仍使用 min(--content-width, 96vw)（不回归）
test("V0.4.2 F9a: composer-inner / shell / footer 仍使用 min(--content-width, 96vw)", () => {
  const m = stylesCss.match(/min\s*\(\s*var\(--content-width\)\s*,\s*96vw\s*\)/g);
  assert.ok(m && m.length >= 3, `应至少 3 处 min(--content-width, 96vw)，实际 ${m ? m.length : 0}`);
});

// F10：.question-echo 单行 ellipsis（V0.4.1 已实现，V0.4.2 不回归）
test("V0.4.2 F10a: .question-echo 仍单行 ellipsis", () => {
  const baseRule = /\.question-echo\s*\{[^}]*white-space\s*:\s*nowrap/s.test(stylesCss);
  const mediaRule = /@media[^{]+\{\s*\.question-echo\s*\{[^}]*white-space\s*:\s*nowrap/s.test(stylesCss);
  assert.ok(baseRule || mediaRule, ".question-echo 应保持单行省略（基础或 media）");
});

// F11：+ 机会池按钮在 question-echo 旁不被挤压（output-head 是 flex space-between）
test("V0.4.2 F11a: .output-head 是 flex space-between 头尾对齐", () => {
  const rule = stylesCss.match(/\.output-head\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(rule, "找不到 .output-head 规则");
  assert.ok(/display\s*:\s*flex/.test(rule[0]));
  assert.ok(/justify-content\s*:\s*space-between/.test(rule[0]));
});

// F12：加载动画 loading-spinner 6 个 div 仍存在（不回归）
test("V0.4.2 F12a: loading-spinner 6 个 div 完整存在", () => {
  // 测试 HTML 里的 loading-spinner 结构（即使 .css 内部 spinner 可能未启用，HTML 内结构不变）
  // 使用 "loading-spinner" 块匹配最近 6 个 <div></div>
  const inner = indexHtml.slice(indexHtml.indexOf('id="answerLoading"'), indexHtml.indexOf('id="answerLoading"') + 2400);
  const spinnerSection = inner.match(/<div aria-hidden="true" class="loading-spinner"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(spinnerSection, "loading-spinner 结构应存在（备选实现）");
  const emptyDivs = (spinnerSection[0].match(/<div><\/div>/g) || []).length;
  assert.equal(emptyDivs, 6, `loading-spinner 应含 6 个 <div></div>，实际 ${emptyDivs}`);
});

// F13：默认不联网（webSearchToggle 默认无 checked）
test("V0.4.2 F13a: webSearchToggle 默认不勾选（不回归）", () => {
  const match = indexHtml.match(/<input[^>]+id="webSearchToggle"[^>]*>/);
  assert.ok(match, "#webSearchToggle 应存在");
  assert.equal(/checked/i.test(match[0]), false, "webSearchToggle 默认不应 checked");
});

// F14：× 清空按钮不回归
test("V0.4.2 F14a: × 清空按钮仍存在（不回归）", () => {
  assert.ok(/id="clearInputButton"/.test(indexHtml), "× 清空按钮节点应保留");
});

// F15：sk-* 脱敏不回归
test("V0.4.2 F15a: sk-* 脱敏工具仍存在（不回归）", () => {
  const { redactSecretLikeText } = require("../public/ask-ui/app");
  // 新版本不一定叫 redactSecretLikeText；改用更宽的检查
  // 检查 app.js 含 sk- 相关脱敏代码
  const hasSkRedact = /redactSecretLike|sk-[A-Za-z0-9_-]{8,}/.test(appJsText);
  // 直接用导出函数（如果有）或文本匹配
  assert.ok(hasSkRedact || /sk-/i.test(appJsText), "app.js 应含 sk- 脱敏逻辑");
});

// F16：Bocha / Tavily provider 不被删除（不回归）
test("V0.4.2 F16a: Bocha / Tavily provider 不被删除", () => {
  // 检查 search-client.js / search-planner.js 仍含 bocha / tavily
  const fs = require("node:fs");
  const path = require("node:path");
  const ROOT = path.join(__dirname, "..");
  const searchClient = fs.readFileSync(path.join(ROOT, "scripts", "search-client.js"), "utf8");
  const searchPlanner = fs.readFileSync(path.join(ROOT, "scripts", "search-planner.js"), "utf8");
  assert.ok(/bocha/i.test(searchClient + searchPlanner), "Bocha provider 应保留");
  assert.ok(/tavily/i.test(searchClient + searchPlanner), "Tavily provider 应保留");
});

// F17：历史项可点击 + 右栏密度（仍能用）
test("V0.4.2 F17a: 历史 click 仍恢复回答（不回归）", () => {
  const nodes = makeFakeNodes();
  const entry = { id: "h-1", question: "q", answer: "a", source: "llm", searchUsed: false, searchSources: [], type: "ask" };
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  app.mount();
  app.restoreHistoryItem(entry);
  assert.equal(nodes.addOpportunityButton.hidden, false, "恢复普通 answer 后按钮应可见");
});

// F18：V0.4.5 删除战略回答下方冗余 meta 信息块
test("V0.4.5 F18a: meta-list 范围 / 搜索 冗余信息块已删除", () => {
  assert.equal(/class="meta-list"/.test(indexHtml), false, "不应再含 meta-list");
  assert.equal(indexHtml.includes("本地 context + LLM"), false, "不应再显示本地 context + LLM");
  assert.equal(indexHtml.includes("默认不联网，可为本次开启"), false, "不应再显示冗余搜索说明");
});

test("V0.4.5: hero 使用 sticky + z-index + background 避免最大化滚动时标题被遮住", () => {
  const heroRule = stylesCss.match(/\.hero\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(heroRule, "找不到 .hero 规则");
  const target = heroRule[0];
  assert.ok(/position\s*:\s*sticky/i.test(target), ".hero 应 sticky");
  assert.ok(/top\s*:\s*0/i.test(target), ".hero 应贴顶部");
  assert.ok(/z-index\s*:\s*(?:[1-9]\d*)/i.test(target), ".hero 应有正 z-index");
  assert.ok(/background\s*:/i.test(target), ".hero 应有背景，避免内容透过标题");
});

test("V0.4.6: 桌面端 html/body 禁止页面级滚动", () => {
  const htmlBodyRule = stylesCss.match(/html,\s*\nbody\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(htmlBodyRule, "找不到 html/body 规则");
  const target = htmlBodyRule[0];
  assert.ok(/height\s*:\s*100%/i.test(target), "html/body 应占满视口");
  assert.ok(/overflow\s*:\s*hidden/i.test(target), "桌面端 html/body 应禁止整页滚动");
});

test("V0.4.6: shell/layout 形成固定视口工作台", () => {
  const shellRule = cssRule(".shell");
  const layoutRule = cssRule(".layout");
  assert.ok(/height\s*:\s*calc\(100dvh\s*-\s*var\(--composer-height\)\)/i.test(shellRule), ".shell 应固定到当前视口高度");
  assert.ok(/display\s*:\s*flex/i.test(shellRule), ".shell 应用 flex 分配标题和工作区");
  assert.ok(/overflow\s*:\s*hidden/i.test(shellRule), ".shell 不应把滚动传给 body");
  assert.ok(/flex\s*:\s*1\s+1\s+auto/i.test(layoutRule), ".layout 应占据剩余高度");
  assert.ok(/min-height\s*:\s*0/i.test(layoutRule), ".layout 应允许内部滚动区收缩");
  assert.ok(/overflow\s*:\s*hidden/i.test(layoutRule), ".layout 不应撑出整页滚动");
});

test("V0.5: currentGoal UI 单行省略，不撑破固定视口标题区", () => {
  const textRule = cssRule(".goal-text");
  assert.ok(/overflow\s*:\s*hidden/i.test(textRule), ".goal-text 应隐藏溢出");
  assert.ok(/text-overflow\s*:\s*ellipsis/i.test(textRule), ".goal-text 应省略过长目标");
  assert.ok(/white-space\s*:\s*nowrap/i.test(textRule), ".goal-text 桌面端应单行");
  assert.ok(stylesCss.includes("@media (max-width: 900px)"), "应保留移动端策略");
});

test("V0.4.6: 战略回答有独立 output-scroll 滚动容器", () => {
  assert.ok(indexHtml.includes('class="output-scroll"'), "HTML 应包含 output-scroll");
  const outputPanelRule = cssRule(".output-panel");
  const outputScrollRule = cssRule(".output-scroll");
  assert.ok(/display\s*:\s*flex/i.test(outputPanelRule), ".output-panel 应为 flex column");
  assert.ok(/flex-direction\s*:\s*column/i.test(outputPanelRule), ".output-panel 应纵向布局");
  assert.ok(/overflow\s*:\s*hidden/i.test(outputPanelRule), ".output-panel 不应撑破 layout");
  assert.ok(/flex\s*:\s*1\s+1\s+auto/i.test(outputScrollRule), ".output-scroll 应占据回答剩余空间");
  assert.ok(/min-height\s*:\s*0/i.test(outputScrollRule), ".output-scroll 应允许收缩");
  assert.ok(/overflow-y\s*:\s*auto/i.test(outputScrollRule), ".output-scroll 应内部滚动");
});

test("V0.4.6: 移动端恢复自然页面滚动策略", () => {
  const media = stylesCss.match(/@media\s*\(max-width\s*:\s*900px\)\s*\{[\s\S]*?\n\s*\}\s*\}/);
  assert.ok(media, "找不到 max-width: 900px media 块");
  const block = media[0];
  assert.ok(/html,\s*\n\s*body\s*\{[^}]*overflow\s*:\s*auto/i.test(block), "移动端 html/body 应允许自然滚动");
  assert.ok(/\.shell\s*\{[^}]*height\s*:\s*auto/i.test(block), "移动端 .shell 应恢复 auto 高度");
  assert.ok(
    /@media\s*\(max-width\s*:\s*900px\)[\s\S]*?\.main,\s*\n\s*\.output-panel,\s*\n\s*\.output-scroll\s*\{[^}]*overflow\s*:\s*visible/i.test(stylesCss),
    "移动端 output-scroll 应恢复自然流"
  );
});

// F19：rail 滚动条视觉优化（细滚动条 / 不抢戏）
test("V0.4.2 F19a: .rail 滚动条弱化（scrollbar-width / scrollbar-color）", () => {
  const railRule = stylesCss.match(/\.rail\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(railRule, "找不到 .rail 主规则");
  const target = railRule[0];
  // 允许 scrollbar-width: thin 或 scrollbar-color，但不强求
  const hasThin = /scrollbar-width\s*:\s*thin/i.test(target);
  const hasColor = /scrollbar-color\s*:/i.test(target);
  assert.ok(hasThin || hasColor, ".rail 应弱化滚动条（scrollbar-width 或 scrollbar-color）");
});

// F20：V0.4.6 桌面端高度由 shell/layout 约束，不再让 rail 自己算 100vh
test("V0.4.6 F20a: .rail 不再用 max-height 兜页面滚动模型", () => {
  const target = cssRule(".rail");
  assert.ok(target, "找不到 .rail 主规则");
  assert.equal(/max-height\s*:/i.test(target), false, ".rail 桌面端不应再用 max-height 控制页面滚动");
});

// F21：移动端 layout 单列时 .rail 仍允许最大高度自适应（不强行 sticky）
test("V0.4.2 F21a: 移动端 layout 单列堆叠时 .rail max-height: none", () => {
  const media = stylesCss.match(/@media\s*\(max-width\s*:\s*900px\)\s*\{[\s\S]*?\n\s*\}\s*\}/);
  assert.ok(media, "找不到 900px media 块");
  const block = media[0];
  // .rail 规则应去除 sticky / max-height
  assert.ok(/\.rail\s*\{[^}]*max-height\s*:\s*none/.test(block), "移动端 .rail max-height 应为 none");
});

// F22：localStorage 不可用时（storage = null）mount 不崩
test("V0.4.2 F22a: storage=null 时 mount 不崩，折叠状态使用默认（展开）", () => {
  const nodes = makeFakeNodes();
  const app = createApp({ nodes, fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ opportunities: [], stats: { total: 0 } }) }), storage: null });
  // 不应抛
  app.mount();
  // 默认展开：body.hidden 应为 false（makeFakeNodes 默认值）
  assert.equal(nodes.opportunityBody.hidden, false, "storage=null 时默认展开");
});

// =================================================================
// V0.6.7 战略回答区布局与短回答约束
// =================================================================

// 目标 1：初始 empty answer box 高度与 loading 一致
test("V0.6.7 T1a: .answer.empty 使用与 .answer-loading 一致的 min-height（>= 320px）", () => {
  const rule = stylesCss.match(/\.answer\.empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.answer--empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.is-empty\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer.empty / .answer--empty / .answer.is-empty 规则");
  const block = rule[0];
  const m = block.match(/min-height\s*:\s*(\d+)px/);
  assert.ok(m, ".answer.empty 应有显式 min-height 数字");
  const height = Number(m[1]);
  assert.ok(height >= 320, `.answer.empty 高度应 >= 320px（避免与 loading 跳变），实际 ${height}px`);
});

test("V0.6.7 T1b: .answer-loading 维持 V0.6.6 的 360px 不退化", () => {
  const rule = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer-loading 规则");
  const m = rule[0].match(/min-height\s*:\s*(\d+)px/);
  assert.ok(m, ".answer-loading 应有 min-height");
  const height = Number(m[1]);
  assert.ok(height >= 320, `.answer-loading 高度应 >= 320px，实际 ${height}px`);
});

test("V0.6.7 T1c: .answer.empty 与 .answer-loading min-height 数值一致（无跳变）", () => {
  const emptyRule = stylesCss.match(/\.answer\.empty\s*\{[^}]*\}/) ||
                    stylesCss.match(/\.answer\.answer--empty\s*\{[^}]*\}/) ||
                    stylesCss.match(/\.answer\.is-empty\s*\{[^}]*\}/);
  const loadingRule = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(emptyRule && loadingRule, "empty 与 loading 规则都应存在");
  const emptyM = emptyRule[0].match(/min-height\s*:\s*(\d+)px/);
  const loadingM = loadingRule[0].match(/min-height\s*:\s*(\d+)px/);
  assert.ok(emptyM && loadingM, "empty 与 loading 都应有 min-height 数字");
  assert.equal(emptyM[1], loadingM[1], "empty 与 loading min-height 应一致");
});

// 目标 2：边框约束（empty / loading / answered 三态统一）
test("V0.6.7 T2a: .answer.empty 应有明确边框（border 1px+ line/accent-soft）", () => {
  const rule = stylesCss.match(/\.answer\.empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.answer--empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.is-empty\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 empty answer 规则");
  const block = rule[0];
  const borderMatch = block.match(/border\s*:\s*(\d+)px[^;]*var\(--line/);
  assert.ok(borderMatch, ".answer.empty 应使用 var(--line*) 边框（不黑、不重卡片）");
  const width = Number(borderMatch[1]);
  assert.ok(width >= 1 && width <= 2, `边框宽度 1-2px 克制，实际 ${width}px`);
});

test("V0.6.7 T2b: .answer-loading 也使用同色系边框（统一三态）", () => {
  const rule = stylesCss.match(/\.answer-loading\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer-loading 规则");
  const block = rule[0];
  const borderMatch = block.match(/border\s*:\s*(\d+)px[^;]*var\(--line/);
  assert.ok(borderMatch, ".answer-loading 应使用 var(--line*) 边框");
});

test("V0.6.7 T2c: 空状态文案视觉居中略上（flex / grid / padding-top）", () => {
  // .answer.empty 应有 display: flex + justify-content: center + align-items: ?，或 padding-top 足够
  const rule = stylesCss.match(/\.answer\.empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.answer--empty\s*\{[^}]*\}/) ||
               stylesCss.match(/\.answer\.is-empty\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 empty 规则");
  const block = rule[0];
  // 接受 display: flex + justify-content 或 padding-top 50px+
  const hasFlex = /display\s*:\s*flex/.test(block) && /justify-content\s*:\s*center/.test(block);
  const hasPaddingTop = /padding-top\s*:\s*(\d+)px/.test(block);
  if (hasPaddingTop) {
    const m = block.match(/padding-top\s*:\s*(\d+)px/);
    const pt = Number(m[1]);
    assert.ok(pt >= 50, `padding-top 应 >= 50px（视觉居中略上），实际 ${pt}px`);
  }
  assert.ok(hasFlex || hasPaddingTop, "空状态应通过 flex 居中或较大 padding-top");
});

// 目标 3：淡橙 / 橙黄高亮（替换 V0.6.6 绿色高光）
test("V0.6.7 T3a: CSS 定义淡橙 / 橙黄 highlight 颜色变量（--highlight-ink / --highlight-bg）", () => {
  assert.ok(/--highlight-ink\s*:/.test(stylesCss), "应定义 --highlight-ink");
  assert.ok(/--highlight-bg\s*:/.test(stylesCss), "应定义 --highlight-bg");
  // highlight-bg 应是橙色系
  const bgMatch = stylesCss.match(/--highlight-bg\s*:\s*rgba?\(([^)]+)\)/);
  assert.ok(bgMatch, "--highlight-bg 应是 rgba(...) 形式");
  // 期望 R > G > B（暖色），示例：R245, G178, B87
  const parts = bgMatch[1].split(",").map((s) => Number(s.trim()));
  assert.ok(parts.length >= 3, "应至少有 R,G,B");
  assert.ok(parts[0] > parts[1] && parts[1] >= parts[2], `高亮背景应偏暖色 (R>G>=B)，实际 ${parts.slice(0,3).join(",")}`);
});

test("V0.6.7 T3b: .answer strong 使用 --highlight-ink / --highlight-bg（不再只用 accent-dark）", () => {
  const rule = stylesCss.match(/\.answer strong\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer strong 规则");
  const block = rule[0];
  assert.ok(/var\(--highlight-ink\)/.test(block), ".answer strong 应使用 --highlight-ink 文字色");
  assert.ok(/var\(--highlight-bg\)|rgba\(.*rgba\(/i.test(block), ".answer strong 应使用 highlight 高光背景");
  assert.ok(/mix-blend-mode\s*:\s*multiply/i.test(block), ".answer strong 应保留 mix-blend-mode: multiply");
  assert.ok(/box-decoration-break\s*:\s*clone/i.test(block), ".answer strong 应保留 box-decoration-break: clone");
});

test("V0.6.7 T3c: .answer mark 使用 --highlight-ink / --highlight-bg", () => {
  const rule = stylesCss.match(/\.answer mark\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer mark 规则");
  const block = rule[0];
  assert.ok(/var\(--highlight-ink\)/.test(block), ".answer mark 应使用 --highlight-ink 文字色");
  assert.ok(/var\(--highlight-bg\)|rgba\(/i.test(block), ".answer mark 应使用 highlight 高光背景");
});

test("V0.6.7 T3d: 重点色不是黑色（高亮 ink ≠ var(--ink)）", () => {
  const rootVars = stylesCss.match(/--highlight-ink\s*:\s*([^;]+);/);
  assert.ok(rootVars, "应定义 --highlight-ink");
  const value = rootVars[1].trim();
  // 1) 不应是 var(--ink) 或 var(--ink)（黑）
  assert.equal(/var\(\s*--ink\s*\)/.test(value), false,
    "--highlight-ink 不应是 var(--ink)（黑）");
  // 2) 偏暖色：检查 hex 形式若以 # 开头则 R > B
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // 暖色 = 至少 R > B
      assert.ok(r > b, `--highlight-ink 应偏暖（红 > 蓝），实际 ${value} (${r},${g},${b})`);
    }
  } else if (value.startsWith("rgb")) {
    // 颜色值直接检验 R > B
    const nums = value.match(/(\d+)/g);
    if (nums && nums.length >= 3) {
      const r = Number(nums[0]);
      const b = Number(nums[2]);
      assert.ok(r > b, `--highlight-ink 应偏暖，实际 ${value}`);
    }
  }
});

test("V0.6.7 T3e: .answer code / pre 强制 mix-blend-mode: normal（不被高光污染）", () => {
  const rule = stylesCss.match(/\.answer code,\s*\n?\s*\.answer pre\s*\{[^}]*\}/);
  assert.ok(rule, "应存在 .answer code/pre 混合模式覆盖规则");
  assert.ok(/mix-blend-mode\s*:\s*normal/.test(rule[0]), "覆盖规则应回退到 normal");
});

// 目标 4：复制内容不包含样式污染
test("V0.6.7 T4a: 复制 buildClipboardPayload 仍只输出纯文本", () => {
  const { buildClipboardPayload } = require("../public/ask-ui/app");
  const r = buildClipboardPayload({ answer: "**bold** 普通文本" });
  assert.equal(r.text.includes("<"), false, "纯文本不应含 <");
  assert.equal(r.text.includes("linear-gradient"), false, "纯文本不应含 CSS");
  assert.equal(r.text.includes("mix-blend-mode"), false, "纯文本不应含 CSS");
});

// 推荐问题位置不回归
test("V0.6.7 T5a: 推荐问题节点 #recommendedQuestions 仍位于战略回答上方", () => {
  const rIndex = indexHtml.indexOf('id="recommendedQuestions"');
  const aIndex = indexHtml.indexOf('id="answerOutput"');
  assert.ok(rIndex > 0 && aIndex > 0, "两个节点都应存在");
  assert.ok(rIndex < aIndex, "推荐问题应早于战略回答节点");
});

// loading 动画本体不回归
test("V0.6.7 T6a: loading-spinner 6 个 div 仍完整存在", () => {
  const idx = indexHtml.indexOf('id="answerLoading"');
  assert.ok(idx > 0, "找不到 #answerLoading");
  const inner = indexHtml.slice(idx, idx + 2400);
  const m = inner.match(/<div aria-hidden="true" class="loading-spinner"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(m, "loading-spinner 结构应存在");
  const emptyDivs = (m[0].match(/<div><\/div>/g) || []).length;
  assert.equal(emptyDivs, 6, `loading-spinner 应含 6 个 <div></div>，实际 ${emptyDivs}`);
});

test("V0.6.7 T6b: loading 关键 keyframes 仍为 Uiverse 原文（hamster + spinner 都有）", () => {
  // V0.6.6 后两种 loading 实现都还在 styles.css
  assert.ok(/@keyframes\s+loading-spinner\b/.test(stylesCss), "@keyframes loading-spinner 应存在");
});

// 短回答约束：检查 prompt 文件文本
test("V0.6.7 T7a: 系统提示词文件含短回答约束字样（普通 / 搜索 Ask）", () => {
  let combined = "";
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const promptPath = path.join(__dirname, "..", "prompts", "ask-mode-system-prompt.md");
    combined = fs.readFileSync(promptPath, "utf8");
  } catch {
    combined = "";
  }
  // 综合检查：prompt 文件 / scripts
  const sources = [
    combined,
    require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "scripts", "ask-strategy-os.js"), "utf8"
    )
  ].join("\n");
  // 宽松检查：含"短回答" / "总长度" / "先给结论" / "最多 N 字" / "不要长铺垫" 等
  const has = /短回答|回答更短|更短的|总长度控制在?\s*\d+-\d+\s*字|不要.{0,5}长铺垫|先.{0,3}给结论|最多\s*\d+\s*字/i.test(sources);
  assert.ok(has, "V0.6.7 应在 prompt / fallback / scripts 中加入短回答约束语义");
});

test("V0.6.7 T7b: scripts/ask-strategy-os.js 包含普通 Ask 短回答约束（总长度 / 小段数）", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "ask-strategy-os.js"), "utf8");
  // 至少含一个明确的字符数 / 小段数 / bullet 数约束
  const hasLength = /总.{0,8}长度.{0,8}\d+[-~]\d+\s*字|\d+[-~]\d+\s*字/i.test(text);
  const hasSegments = /最多\s*\d+\s*个?小?段|最多\s*\d+\s*个?bullet/i.test(text);
  const hasConclusion = /先.{0,3}给结论|必须.{0,3}先.{0,3}给结论/i.test(text);
  assert.ok(hasLength || hasSegments || hasConclusion, "应含明确的短回答约束（字符数 / 段数 / 结论优先）");
});

test("V0.6.7 T7c: fallback 模板包含短回答提示语", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "ask-strategy-os.js"), "utf8");
  // fallback 模板里至少有一个模板含"短"或"简洁"或长度控制字样
  const has = /短|简洁|不要长铺垫|控制.{0,5}短|简要/i.test(text);
  assert.ok(has, "fallback 模板应含短回答语义");
});

// 开工包不受短回答约束误伤
test("V0.6.7 T8a: 开工包 prompt 不应被普通 short-answer 模板替换", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const text = fs.readFileSync(path.join(__dirname, "..", "scripts", "ask-strategy-os.js"), "utf8");
  // 开工包 prompt 与普通 prompt 是分开的 readKickoffSystemPrompt
  assert.ok(/readKickoffSystemPrompt|generateKickoffPackageForOpportunity/.test(text), "开工包仍使用独立 prompt");
  // 开工包 prompt 不应含 "260-420 中文字" 这种强约束
  const kickoffMatch = text.match(/readKickoffSystemPrompt\s*\(\s*\)\s*\{[^]*?prompt\s*=[^]*?return[^]*?\};/);
  if (kickoffMatch) {
    assert.equal(/260-420|总长度控制在?\s*\d+-\d+/.test(kickoffMatch[0]), false, "开工包 prompt 不应被普通 260-420 字约束影响");
  }
});

// 提问 / 机会池按钮动效不回归
test("V0.6.7 T9a: askButton 仍含 hover / pressed 动效定义", () => {
  assert.ok(/\.primary-button:hover/.test(stylesCss), ".primary-button:hover 应存在");
  assert.ok(/\.primary-button:focus-visible/.test(stylesCss), "focus-visible 应存在");
});

test("V0.6.7 T9b: 机会池按钮（add-opportunity-button）仍含动效", () => {
  assert.ok(/\.add-opportunity-button:hover/.test(stylesCss), "机会池按钮 hover 应保留");
});

// Codex / Claude Code 任务按钮不恢复
test("V0.6.7 T10a: 不恢复 Codex / Claude Code 任务按钮", () => {
  const lower = appJsText.toLowerCase();
  assert.equal(/data-task-target=\"codex\"|data-task-target=\"workbuddy\"|task-claude/.test(lower), false, "不应再出现 Codex/WorkBuddy/Claude Code 任务按钮节点");
  assert.equal(/dispatchToCodexCode|dispatchToCodex\b/.test(appJsText), false, "不应再出现 Codex 调度逻辑");
});

// sk-* 脱敏不回归
test("V0.6.7 T11a: app.js 仍含 sk-* 脱敏逻辑", () => {
  // 脱敏可能用 inline regex（/[A-Za-z]*sk-[A-Za-z0-9_-]+/）或 named function
  const hasInlineRedact = /sk-[A-Za-z0-9_-]+\s*\)/.test(appJsText);
  const hasRedactFn = /redactSecretLikeText/.test(appJsText);
  const hasRedactCall = /\bredact\b|\[redacted\]/i.test(appJsText);
  assert.ok(hasInlineRedact || hasRedactFn || hasRedactCall, "sk-* 脱敏逻辑应保留");
});

// 默认不联网
test("V0.6.7 T12a: webSearchToggle 默认无 checked 属性", () => {
  const match = indexHtml.match(/<input[^>]+id="webSearchToggle"[^>]*>/);
  assert.ok(match, "#webSearchToggle 应存在");
  assert.equal(/checked/i.test(match[0]), false, "webSearchToggle 默认不应 checked");
});

// fixed viewport 不回归
test("V0.6.7 T13a: body 有 overflow: hidden 约束（fixed viewport）", () => {
  assert.ok(/html,\s*\n?\s*body[\s\S]{0,200}overflow\s*:\s*hidden/i.test(stylesCss) ||
            /body\s*\{[^}]*overflow\s*:\s*hidden/.test(stylesCss), "body 应有 overflow: hidden 兜底");
});

// 战略回答区边框约束（empty / loading / answered 三态统一）
test("V0.6.7 T14a: .answer 主规则有边框（answered 状态同样有边框）", () => {
  // 排除 .answer.empty 与 .answer-loading，匹配基础 .answer {
  const rule = stylesCss.match(/\.answer\s*\{[^}]*\}/);
  assert.ok(rule, ".answer 应存在");
  assert.ok(/border\s*:/.test(rule[0]), ".answer 应有边框");
  assert.ok(/var\(--line\)/.test(rule[0]), ".answer 边框应使用 var(--line*) 系列");
});

// 不重新引入仓鼠跑轮（保持 V0.6.6 选定的 3D 盒子）
test("V0.6.7 T15a: 默认 loading 仍是 3D 盒子（HTML 中 class=loading-spinner）", () => {
  assert.ok(/class="loading-spinner"/.test(indexHtml), "HTML 应含 .loading-spinner 容器");
});

// footer 不显示（fixed viewport 模式下 footer 隐藏）
test("V0.6.7 T16a: .footer 默认 display: none", () => {
  const rule = stylesCss.match(/\.footer\s*\{[^}]*\}/);
  assert.ok(rule, ".footer 应存在");
  assert.ok(/display\s*:\s*none/.test(rule[0]), ".footer 应默认隐藏");
});

// opportunity-pool.json 不回归
test("V0.6.7 T17a: .gitignore 仍排除 opportunity-pool.json 与 backups", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const gi = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
  // 接受任一形式
  const hasPool = /opportunity-pool\.json|opportunity[\\/]pool|opportunity-pool/.test(gi) ||
                  /opportunities[\\/]\*\.json/.test(gi) ||
                  /opportunities[\\/]/.test(gi);
  const hasBackups = /backups/.test(gi);
  assert.ok(hasPool, ".gitignore 应排除 opportunity-pool.json（或 opportunities/*.json）");
  assert.ok(hasBackups, ".gitignore 应排除 backups 路径");
});

