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
  handleCopyClick
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

const ROOT = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "styles.css"), "utf8");
const appJsText = fs.readFileSync(path.join(ROOT, "public", "ask-ui", "app.js"), "utf8");

test("HTML still contains 'EricChan·战略OS' title", () => {
  assert.ok(indexHtml.includes("EricChan·战略OS"));
});

test("HTML / CSS / JS contain 'Enter 发送' shortcut hint", () => {
  const combined = `${indexHtml}\n${appJsText}`;
  assert.ok(combined.includes("Enter 发送"), "缺少 'Enter 发送' 文案");
});

test("HTML / CSS / JS contain 'Shift + Enter 换行' shortcut hint", () => {
  const combined = `${indexHtml}\n${appJsText}`;
  assert.ok(combined.includes("Shift") && combined.includes("换行"), "缺少 Shift+Enter 换行说明");
});

test("HTML no longer markets Ctrl + Enter as primary shortcut", () => {
  // 现在主快捷键是 Enter；面板上不应再把 Ctrl+Enter 当主提示。
  // 仍然可以在 app.js 里保留 Ctrl+Enter 作为 fallback（向后兼容）。
  assert.equal(indexHtml.includes("Ctrl + Enter"), false, "index.html 不应再展示 Ctrl+Enter 提示");
});

test("HTML contains web-search disclaimer in Chinese", () => {
  const text = indexHtml;
  assert.ok(
    text.includes("不自动联网搜索") || text.includes("不联网搜索"),
    "HTML 缺少 '不自动联网搜索' 联网说明"
  );
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

test("CSS layout uses a wider content width (>= 1000px) for desktop", () => {
  // 桌面端不再只占中间 760px。
  const matches = stylesCss.match(/--content-width\s*:\s*(\d+)px/);
  assert.ok(matches, "应定义 --content-width 变量");
  const width = Number(matches[1]);
  assert.ok(width >= 1000, `桌面端 --content-width 应 >= 1000px，实际 ${width}px`);
});

test("CSS reserves padding-bottom on the scrolling area so composer doesn't cover the last paragraph", () => {
  // 滚动区应有 padding-bottom 避免最后一段被 composer 盖住。
  // 检查方式：在 body/html/main/shell 规则块附近出现 padding-bottom。
  const ruleMatch = stylesCss.match(/(?:body|html|main|\.shell)[\s\S]{0,400}?\{[\s\S]{0,800}?padding-bottom\s*:\s*[^;]+;/i);
  assert.ok(ruleMatch, "滚动区应在 body/html/main/.shell 规则块中包含 padding-bottom");
});

test("app.js no longer wires recommended-question button to submitAsk directly", () => {
  // 老逻辑：button.addEventListener("click", () => { ask(question); });
  // 新逻辑：button.addEventListener("click", () => { fillQuestion(question); });
  assert.ok(appJsText.includes("fillQuestion"), "推荐按钮应调用 fillQuestion 而非 submitAsk");
  // 防御性：旧模式不应再出现。
  const oldPattern = /addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]{0,80}ask\(/;
  assert.equal(oldPattern.test(appJsText), false, "发现旧的 'ask(' 触发模式");
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

test("HTML 含 loading 容器", () => {
  const hasLoading =
    /id="answerLoading"/.test(indexHtml) ||
    /class="[^"]*answer-loading[^"]*"/.test(indexHtml);
  assert.ok(hasLoading, "缺少 loading 容器");
});

test("HTML 仍含'不自动联网搜索'联网说明", () => {
  assert.ok(indexHtml.includes("不自动联网搜索"), "缺少联网能力说明");
});

test("CSS 包含复制按钮样式（.copy-button / .answer-copy）", () => {
  const hasCss =
    /\.copy-button[\s\S]{0,200}?\{/i.test(stylesCss) ||
    /\.answer-copy[\s\S]{0,200}?\{/i.test(stylesCss);
  assert.ok(hasCss, "缺少复制按钮样式");
});

test("CSS 包含 loading 动画样式（@keyframes / hamster / spinner）", () => {
  const hasKeyframes = /@keyframes\s+[A-Za-z_-]+/.test(stylesCss);
  assert.ok(hasKeyframes, "缺少 @keyframes（loading 动画）");
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
  assert.ok(typeof item.id === "string" && item.id.length > 0);
  assert.equal(typeof item.createdAt, "number");
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

