// Ask UI 前端逻辑。
// 浏览器侧通过 <script src="/app.js"> 加载，IIFE 自动绑定事件。
// 测试侧通过 require("./app") 拿到纯函数 (handleComposerKeyDown / validateSubmit / applyQuestionToComposer)
// 与一个无副作用的 createApp(deps) 工厂，可注入 fake DOM 与 fetchImpl。

// 1) 纯函数：决定键盘事件如何处理
//    返回 "submit" | "newline" | "ignore" | "noop"
//    - Enter                → "submit"    (preventDefault)
//    - Shift + Enter        → "newline"   (不 preventDefault，让浏览器插入换行)
//    - Ctrl/Cmd + Enter     → "submit"    (向后兼容旧的快捷键)
//    - composition 期间     → "ignore"    (中文/日文 IME 输入未确认时不发送)
//    - 其它键               → "noop"
function handleComposerKeyDown(event) {
  if (!event || typeof event.key !== "string") return "noop";
  if (event.isComposing) return "ignore";
  if (event.key !== "Enter") return "noop";
  // 任何 Enter 触发的提交语义（Enter / Ctrl+Enter / Cmd+Enter）都要 preventDefault
  // 防止浏览器在 textarea 里插入换行；Shift+Enter 让浏览器正常换行。
  if (event.shiftKey) return "newline";
  if (typeof event.preventDefault === "function") event.preventDefault();
  return "submit";
}

// 2) 纯函数：决定能否提交
//    { ok: false, message: "请先输入一个问题。" } 或 { ok: true }
function validateSubmit(value) {
  const text = String(value || "").trim();
  if (!text) return { ok: false, message: "请先输入一个问题。" };
  return { ok: true };
}

// 3) 纯函数：把推荐问题填入输入框、focus、标记选中
//    注意：只填入 + focus + 选中态，不触发提交，不调用 fetch。
function applyQuestionToComposer({ text, input, button, state }) {
  if (!input) return;
  input.value = String(text || "");
  if (typeof input.focus === "function") input.focus();
  if (typeof input.setSelectionRange === "function") {
    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      // 某些 input type 不支持 setSelectionRange；忽略。
    }
  }
  if (state) state.selectedButton = button || null;
  if (button && typeof button.setAttribute === "function") {
    button.setAttribute("aria-pressed", "true");
  }
}

// ============== History store (V0.3.4-hotfix) ==============
//
// 纯函数 + 可注入 storage 的小型 store。
// storage 注入是为了能在 Node 测试里跑，且不依赖 window/localStorage。

const HISTORY_KEY = "strategyOsAskHistory";
const DEFAULT_HISTORY_MAX = 20;

// 生成稳定的 id：用时间戳 + 随机后缀（同题 push 时区分实例）。
function makeHistoryId(prefix = "h") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 把 LLM 回包 / 用户提问数据整理成标准结构。
function normalizeHistoryItem(input) {
  const raw = input && typeof input === "object" ? input : {};
  const question = typeof raw.question === "string" ? raw.question : "";
  const answer = typeof raw.answer === "string" ? raw.answer : "";
  const source = typeof raw.source === "string" ? raw.source : "local";
  const warning = raw.warning == null ? null : String(raw.warning);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeHistoryId(),
    question,
    answer,
    source,
    warning,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
  };
}

// 简单随机 id 生成器（不依赖 crypto.randomUUID，最大兼容浏览器/Node）。
function cryptoFreeId() {
  return makeHistoryId();
}

function toHistoryArray(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x === "object")
    .map(normalizeHistoryItem);
}

// 把内部状态词 / 字段做中文化（前端清洗层）。这是 LLM 返回到达前端后的兜底；
// 服务端 LLM 客户端已先做过一次 sanitize + translate，这里再做一遍防止本地 fallback
// 或未来新路径泄漏。
function translateInternalTermsClient(text) {
  try {
    // 调用 llm-client.js 的同名函数；动态 require 避免把测试环境耦合。
    const mod = require("../../scripts/llm-client");
    if (mod && typeof mod.translateInternalTerms === "function") {
      return mod.translateInternalTerms(text);
    }
  } catch {
    // ignore：浏览器 / 测试里 require 不到就跑空清洗
  }
  // 浏览器里拿不到 require；保留原文由服务端兜底。
  return typeof text === "string" ? text : "";
}

function pushHistoryItem(list, item, maxSize = DEFAULT_HISTORY_MAX) {
  const normalized = normalizeHistoryItem(item);
  const deduped = list.filter((entry) => entry && entry.question !== normalized.question);
  deduped.unshift(normalized);
  return deduped.slice(0, Math.max(1, maxSize));
}

function removeHistoryItem(list, id) {
  return list.filter((entry) => entry && entry.id !== id);
}

function loadHistory(storage, _maxSize) {
  if (!storage || typeof storage.getItem !== "function") return [];
  const raw = storage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return toHistoryArray(parsed);
  } catch {
    return [];
  }
}

function saveHistory(storage, list, _maxSize) {
  if (!storage || typeof storage.setItem !== "function") return;
  if (!Array.isArray(list) || list.length === 0) {
    if (typeof storage.removeItem === "function") storage.removeItem(HISTORY_KEY);
    else storage.setItem(HISTORY_KEY, "[]");
    return;
  }
  storage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function clearHistory(storage) {
  if (!storage || typeof storage.removeItem !== "function") return;
  storage.removeItem(HISTORY_KEY);
}

// 工厂：可注入 storage；提供给前端用。
function createHistoryStore({ storage, maxSize = DEFAULT_HISTORY_MAX } = {}) {
  let list = loadHistory(storage, maxSize);
  return {
    list: () => list.slice(),
    push(item) {
      list = pushHistoryItem(list, item, maxSize);
      saveHistory(storage, list, maxSize);
      return list.slice();
    },
    remove(id) {
      list = removeHistoryItem(list, id);
      saveHistory(storage, list, maxSize);
      return list.slice();
    },
    clear() {
      list = [];
      clearHistory(storage);
      return list.slice();
    }
  };
}

// ============== Copy / Clipboard helpers (V0.3.4-hotfix) ==============

function buildClipboardPayload({ answer, _question } = {}) {
  const text = typeof answer === "string" ? answer : "";
  // 注意：不要返回 HTML，只返回 Markdown 纯文本。
  return { text, format: "text/markdown" };
}

async function handleCopyClick({ answer, clipboardImpl } = {}) {
  const { text } = buildClipboardPayload({ answer });
  if (!text) {
    return { ok: false, message: "当前没有可复制的回答。" };
  }
  if (typeof clipboardImpl !== "function") {
    return { ok: false, message: "复制失败，请手动选择文本。" };
  }
  try {
    await clipboardImpl(text);
    return { ok: true, text, message: "已复制" };
  } catch (error) {
    return { ok: false, message: "复制失败，请手动选择文本。" };
  }
}

// ============== Loading state helper (V0.3.4-hotfix) ==============

function buildLoadingMarkup() {
  return `<span class="loading-text">正在生成战略判断……</span><span class="loading-wheel" aria-hidden="true">${WHEEL_SVG}</span>`;
}

// 简化版 hamster 动画的 SVG：三层同心圆 + 一根说话"指针"，整体克制；
// 用户提供了参考 CSS / SVG，我们做的是 SVG-only 不依赖外部 CSS 关键帧。
const WHEEL_SVG = `
<svg class="loading-wheel-svg" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
  <circle class="loading-wheel-ring" cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="3"></circle>
  <circle class="loading-wheel-arc" cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="55 200" transform="rotate(-90 32 32)"></circle>
  <circle class="loading-wheel-dot" cx="32" cy="20" r="3" fill="currentColor"></circle>
</svg>
`;

// 4) createApp(deps)：把所有 DOM 行为包成可注入的工厂
//    deps 字段：
//      document, fetchImpl, setTimeoutImpl, scrollImpl
//      nodes: { questionInput, askButton, statusText, answerOutput, questionEcho, questionGrid,
//               historyList, historyEmpty, historyClearButton, copyButton, answerLoading }
//      storage (默认 window.localStorage, 浏览器里)
//      now (Date.now 替代)
//      clipboardImpl (默认 navigator.clipboard.writeText)
//    返回 { submitAsk, fillQuestion, renderQuestions, restoreHistoryItem, clearHistoryNow,
//           getStatus, setStatus, setInFlight, clearSelectedQuestion, selectQuestionButton,
//           state, mount, handleCopy }
function createApp(deps) {
  const documentRef = deps.document || (typeof document !== "undefined" ? document : null);
  const fetchImpl = deps.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const scrollImpl = deps.scrollImpl || ((el) => el && typeof el.scrollIntoView === "function" && el.scrollIntoView({ behavior: "smooth", block: "start" }));
  const nodes = deps.nodes || {};
  const input = nodes.questionInput;
  const askButton = nodes.askButton;
  const statusText = nodes.statusText;
  const answerOutput = nodes.answerOutput;
  const questionEcho = nodes.questionEcho;
  const questionGrid = nodes.questionGrid;
  const historyList = nodes.historyList;
  const historyEmpty = nodes.historyEmpty;
  const historyClearButton = nodes.historyClearButton;
  const copyButton = nodes.copyButton;
  const answerLoading = nodes.answerLoading;

  // 找 storage；浏览器用 window.localStorage，测试里可注入。
  let storage = deps.storage;
  if (!storage && typeof window !== "undefined" && window.localStorage) {
    storage = window.localStorage;
  }

  const clipboardImpl =
    deps.clipboardImpl ||
    (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function"
      ? (text) => navigator.clipboard.writeText(text)
      : null);

  const now = deps.now || (() => Date.now());

  const state = {
    recommendedButtons: [],
    inFlight: false,
    selectedButton: null,
    currentAnswer: "",
    currentSource: ""
  };

  const historyStore = createHistoryStore({ storage, maxSize: 20 });

  function setStatus(message, tone) {
    if (statusText) {
      statusText.textContent = message;
      if (tone === "error") statusText.setAttribute("data-tone", "error");
      else statusText.removeAttribute("data-tone");
    }
  }

  function statusFromSource(source, warning) {
    if (warning) return warning;
    if (source === "llm") return "已使用动态战略回答。";
    if (source === "local") return "已使用本地规则回答。";
    if (source === "local-fallback") return "LLM 动态回答暂时不可用，已回退到本地规则回答。";
    return "回答已生成。";
  }

  function setInFlight(value) {
    state.inFlight = !!value;
    if (askButton) askButton.disabled = state.inFlight;
    for (const btn of state.recommendedButtons) btn.disabled = state.inFlight;
    if (answerLoading) {
      if (state.inFlight) {
        answerLoading.hidden = false;
        if (answerOutput) answerOutput.hidden = true;
      } else {
        answerLoading.hidden = true;
        if (answerOutput) answerOutput.hidden = false;
      }
    }
    if (copyButton && state.inFlight) copyButton.disabled = true;
  }

  function clearSelectedQuestion() {
    state.selectedButton = null;
    for (const btn of state.recommendedButtons) {
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function selectQuestionButton(button) {
    state.selectedButton = button || null;
    for (const btn of state.recommendedButtons) {
      btn.setAttribute("aria-pressed", btn === button ? "true" : "false");
    }
  }

  function fillQuestion(text) {
    if (!input) return;
    applyQuestionToComposer({
      text,
      input,
      button: state.selectedButton,
      state
    });
  }

  function setCurrentAnswer(answer, source) {
    state.currentAnswer = typeof answer === "string" ? answer : "";
    state.currentSource = typeof source === "string" ? source : "";
    if (copyButton) {
      const hasText = state.currentAnswer.trim().length > 0;
      copyButton.disabled = !hasText;
      copyButton.hidden = !hasText;
      copyButton.removeAttribute("data-state");
    }
  }

  function renderHistory() {
    if (!historyList) return;
    const items = historyStore.list();
    historyList.innerHTML = "";
    if (!documentRef || typeof documentRef.createElement !== "function") return;
    for (const entry of items) {
      const li = documentRef.createElement("li");
      const btn = documentRef.createElement("button");
      btn.type = "button";
      btn.className = "history-item";
      btn.dataset.id = entry.id;

      const q = documentRef.createElement("span");
      q.className = "history-question";
      q.textContent = entry.question || "(空问题)";

      const meta = documentRef.createElement("span");
      meta.className = "history-meta";

      const src = documentRef.createElement("span");
      src.className = "history-source";
      const labelMap = {
        llm: "动态回答",
        local: "本地回答",
        "local-fallback": "已回退"
      };
      src.dataset.source = entry.source;
      src.textContent = labelMap[entry.source] || "回答";

      const time = documentRef.createElement("span");
      time.className = "history-time";
      time.textContent = formatHistoryTime(entry.createdAt, now());

      meta.appendChild(src);
      meta.appendChild(time);
      btn.appendChild(q);
      btn.appendChild(meta);
      btn.addEventListener("click", () => {
        restoreHistoryItem(entry);
      });
      li.appendChild(btn);
      historyList.appendChild(li);
    }
    if (historyEmpty) {
      historyEmpty.hidden = items.length > 0;
    }
  }

  function formatHistoryTime(ts, current) {
    if (typeof ts !== "number") return "";
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "";
    const isToday = date.toDateString() === new Date(current).toDateString();
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return isToday ? `${hh}:${mm}` : `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
  }

  function restoreHistoryItem(entry) {
    if (!entry) return;
    // 先填回问题，再把回答恢复上去；不调 fetch。
    if (input) {
      input.value = entry.question || "";
      if (typeof input.focus === "function") input.focus();
    }
    if (questionEcho) {
      questionEcho.hidden = false;
      questionEcho.innerHTML = `<strong>提问：</strong>${escapeHtml(entry.question || "")}`;
    }
    if (answerOutput) {
      answerOutput.classList.remove("empty");
      answerOutput.innerHTML = renderMarkdown(entry.answer || "");
      scrollImpl(answerOutput);
    }
    const warning = entry.warning;
    setStatus(statusFromSource(entry.source, warning), warning ? "error" : null);
    setCurrentAnswer(entry.answer || "", entry.source || "local");
    state.inFlight = false;
    if (askButton) askButton.disabled = false;
    for (const btn of state.recommendedButtons) btn.disabled = false;
  }

  async function handleCopy() {
    const result = await handleCopyClick({ answer: state.currentAnswer, clipboardImpl });
    if (copyButton) {
      if (result.ok) {
        copyButton.setAttribute("data-state", "copied");
        copyButton.title = "已复制";
        setTimeout(() => {
          if (copyButton) {
            copyButton.removeAttribute("data-state");
            copyButton.title = "复制回答";
          }
        }, 1800);
      }
      setStatus(result.message, result.ok ? null : "error");
    }
    return result;
  }

  async function submitAsk() {
    if (state.inFlight) return { submitted: false, reason: "in-flight" };
    const value = input ? String(input.value || "").trim() : "";
    const v = validateSubmit(value);
    if (!v.ok) {
      setStatus(v.message, "error");
      if (input && typeof input.focus === "function") input.focus();
      return { submitted: false, reason: v.message };
    }
    if (input) input.value = value;
    setInFlight(true);
    setStatus("正在生成战略判断……");
    if (answerOutput) {
      answerOutput.classList.remove("empty");
      answerOutput.hidden = true;
    }
    if (questionEcho) {
      questionEcho.hidden = false;
      questionEcho.innerHTML = `<strong>提问：</strong>${escapeHtml(value)}`;
    }
    setCurrentAnswer("", "");
    try {
      if (!fetchImpl) throw new Error("fetch 不可用。");
      const response = await fetchImpl("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: value })
      });
      const payload = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) {
        throw new Error((payload && payload.error) || "回答生成失败。");
      }
      // 前端兜底翻译：服务端 sanitize + translate 之后，再做一遍中文化。
      const rawAnswer = payload.answer || "";
      const translatedAnswer = translateInternalTermsClient(rawAnswer);
      state.currentAnswer = translatedAnswer;
      if (answerOutput) {
        answerOutput.innerHTML = renderMarkdown(translatedAnswer);
        answerOutput.hidden = false;
      }
      const warning = payload.warning;
      const source = payload.source || "local";
      state.currentSource = source;
      setStatus(statusFromSource(source, warning), warning ? "error" : null);
      if (copyButton && state.currentAnswer.trim()) {
        copyButton.disabled = false;
        copyButton.hidden = false;
      }
      if (answerOutput) scrollImpl(answerOutput);
      // 写历史
      historyStore.push({
        question: value,
        answer: translatedAnswer,
        source,
        warning: warning || null
      });
      renderHistory();
      return { submitted: true, source, warning: warning || null };
    } catch (error) {
      if (answerOutput) {
        answerOutput.textContent = "回答生成失败，请检查终端日志或先运行 npm run today。";
        answerOutput.hidden = false;
      }
      setStatus((error && error.message) || "回答生成失败。", "error");
      return { submitted: false, reason: (error && error.message) || "unknown" };
    } finally {
      setInFlight(false);
    }
  }

  function renderQuestions(questions) {
    if (!questionGrid) return;
    let list = questions;
    if (!Array.isArray(list)) {
      try { list = JSON.parse(questionGrid.dataset.questions || "[]"); } catch { list = []; }
    }
    if (documentRef && typeof documentRef.createElement === "function") {
      questionGrid.innerHTML = "";
      state.recommendedButtons = [];
      for (const question of list) {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "question-button";
        button.textContent = question;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          if (state.inFlight) return;
          selectQuestionButton(button);
          fillQuestion(question);
        });
        questionGrid.appendChild(button);
        state.recommendedButtons.push(button);
      }
    }
  }

  function mount() {
    if (input) {
      input.addEventListener("input", () => {
        if (state.inFlight) return;
        if (String(input.value || "").trim()) clearSelectedQuestion();
      });
      input.addEventListener("keydown", (event) => {
        const action = handleComposerKeyDown(event);
        if (action === "submit") {
          clearSelectedQuestion();
          submitAsk();
        }
        // newline / ignore / noop: 浏览器默认行为（Shift+Enter 换行；composition 不动；其它键不动）
      });
    }
    if (askButton) {
      askButton.addEventListener("click", () => {
        clearSelectedQuestion();
        submitAsk();
      });
    }
    if (copyButton) {
      copyButton.addEventListener("click", handleCopy);
    }
    if (historyClearButton) {
      historyClearButton.addEventListener("click", () => {
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          if (!window.confirm("确定清空最近提问记录吗？")) return;
        }
        historyStore.clear();
        renderHistory();
      });
    }
    renderQuestions();
    renderHistory();
  }

  return {
    submitAsk,
    fillQuestion,
    renderQuestions,
    renderHistory,
    restoreHistoryItem,
    clearHistoryNow: () => {
      historyStore.clear();
      renderHistory();
    },
    handleCopy,
    getStatus: () => (statusText ? statusText.textContent : ""),
    setStatus,
    setInFlight,
    setCurrentAnswer,
    clearSelectedQuestion,
    selectQuestionButton,
    historyStore,
    state,
    mount
  };
}

// 5) Markdown 渲染（保持与 V0.3.2 一致：escapeHtml + inline **bold** / `code` + 标题/列表/代码块）
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyInlineMarkdown(escaped) {
  return escaped
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>");
}

function renderMarkdown(text) {
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  let inCode = false;
  let codeLines = [];

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${applyInlineMarkdown(escapeHtml(line.slice(2)))}</h1>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${applyInlineMarkdown(escapeHtml(line.slice(3)))}</h2>`);
    } else if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${applyInlineMarkdown(escapeHtml(line.slice(4)))}</h3>`);
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${applyInlineMarkdown(escapeHtml(line.slice(2)))}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${applyInlineMarkdown(escapeHtml(line))}</p>`);
    }
  }

  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("");
}

// 浏览器侧入口：当以 <script> 加载时（document 存在），自动 mount。
// CommonJS 测试环境（document 缺失）下跳过挂载，仅暴露纯函数。
if (typeof document !== "undefined" && typeof window !== "undefined") {
  const questionInput = document.querySelector("#questionInput");
  const askButton = document.querySelector("#askButton");
  const statusText = document.querySelector("#statusText");
  const answerOutput = document.querySelector("#answerOutput");
  const questionEcho = document.querySelector("#questionEcho");
  const questionGrid = document.querySelector("#recommendedQuestions");
  const historyList = document.querySelector("#historyList");
  const historyEmpty = document.querySelector("#historyEmpty");
  const historyClearButton = document.querySelector("#historyClear");
  const copyButton = document.querySelector("#copyButton");
  const answerLoading = document.querySelector("#answerLoading");

  const app = createApp({
    nodes: {
      questionInput,
      askButton,
      statusText,
      answerOutput,
      questionEcho,
      questionGrid,
      historyList,
      historyEmpty,
      historyClearButton,
      copyButton,
      answerLoading
    }
  });
  app.mount();
  // 暴露到 window，便于在浏览器 console 调试。
  window.__askUi = app;
}

module.exports = {
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
  buildLoadingMarkup,
  WHEEL_SVG,
  translateInternalTermsClient,
  createApp,
  renderMarkdown,
  escapeHtml,
  applyInlineMarkdown
};
