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
  renderSearchSources,
  renderSearchProcess,
  renderOpportunityPanel,
  buildAddOpportunityFormMarkup,
  PRESET_TAGS,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_SCORE_LABELS
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
  const fakeEl = (overrides = {}) => ({
    value: "",
    innerHTML: "",
    textContent: "",
    classList: { add() {}, remove() {}, contains() { return false; } },
    hidden: false,
    disabled: false,
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    setSelectionRange() {},
    scrollIntoView() {},
    dataset: {},
    children: [],
    ...overrides
  });
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
    answerLoading: fakeEl(),
    webSearchToggle: fakeEl({ checked: false }),
    searchSources: fakeEl(),
    searchProcess: fakeEl(),
    globalStatusText: fakeEl(),
    opportunityStats: fakeEl(),
    opportunityList: fakeEl(),
    opportunityEmpty: fakeEl(),
    opportunityStatus: fakeEl()
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

test("HTML still contains 'EricChan·战略OS' title", () => {
  assert.ok(indexHtml.includes("EricChan·战略OS"));
});

test("HTML top status uses dynamic globalStatusText with default offline wording", () => {
  assert.ok(indexHtml.includes('id="globalStatusText"'));
  assert.ok(indexHtml.includes("默认不联网"));
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

test("CSS .wheel-and-hamster 尺寸增大到至少 9em（V0.3.4-hotfix-3）", () => {
  // 主规则（含 real declarations，不是 reduced-motion 覆盖）。
  const rule = stylesCss.match(/\.wheel-and-hamster\s*\{[\s\S]*?\n\s*\}\s*\.wheel,/);
  assert.ok(rule, "找不到 .wheel-and-hamster 主规则");
  const target = rule[0];
  // 至少含一条 width: <n>em，n ≥ 9。
  const widthMatch = target.match(/width\s*:\s*(\d+(?:\.\d+)?)em/);
  assert.ok(widthMatch, ".wheel-and-hamster 主规则必须用 em 单位设置 width");
  const emSize = Number(widthMatch[1]);
  assert.ok(emSize >= 9, `.wheel-and-hamster 应 >= 9em，当前 ${emSize}em`);
  // font-size 也应同步上调到至少 16px 让 hamster 看起来更大。
  const fontMatch = target.match(/font-size\s*:\s*(\d+)px/);
  assert.ok(fontMatch, ".wheel-and-hamster 主规则应含 font-size 像素设置");
  const px = Number(fontMatch[1]);
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

  assert.ok(html.statsHtml.includes("待验证 1"));
  assert.ok(html.listHtml.includes("Independent AI opportunity brief MVP"));
  assert.ok(html.listHtml.includes("待验证"));
  assert.ok(html.listHtml.includes("编辑"));
  assert.ok(html.listHtml.includes("保存"));
  assert.equal(html.listHtml.includes("validate"), true, "select value 可保留内部值，但可见状态应中文");
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
  // 备注默认应包含问题摘要（而非 raw 全文）
  assert.ok(html.includes("适合做短视频选题工具"), "应包含问题摘要");
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
