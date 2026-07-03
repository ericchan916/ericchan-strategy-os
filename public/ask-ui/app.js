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

// 4) createApp(deps)：把所有 DOM 行为包成可注入的工厂
//    deps 字段：
//      document, fetchImpl, setTimeoutImpl, scrollImpl
//      nodes: { questionInput, askButton, statusText, answerOutput, questionEcho, questionGrid }
//    返回 { submitAsk, fillQuestion, renderQuestions, getStatus, setStatus, setInFlight,
//           clearSelectedQuestion, selectQuestionButton, state, mount }
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

  const state = {
    recommendedButtons: [],
    inFlight: false,
    selectedButton: null
  };

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
    if (answerOutput) answerOutput.classList.remove("empty");
    if (questionEcho) {
      questionEcho.hidden = false;
      questionEcho.innerHTML = `<strong>提问：</strong>${escapeHtml(value)}`;
    }
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
      if (answerOutput) answerOutput.innerHTML = renderMarkdown(payload.answer || "");
      const warning = payload.warning;
      setStatus(statusFromSource(payload.source, warning), warning ? "error" : null);
      if (answerOutput) scrollImpl(answerOutput);
      return { submitted: true, source: payload.source, warning: warning || null };
    } catch (error) {
      if (answerOutput) {
        answerOutput.textContent = "回答生成失败，请检查终端日志或先运行 npm run today。";
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
    renderQuestions();
  }

  return {
    submitAsk,
    fillQuestion,
    renderQuestions,
    getStatus: () => (statusText ? statusText.textContent : ""),
    setStatus,
    setInFlight,
    clearSelectedQuestion,
    selectQuestionButton,
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

  const app = createApp({
    nodes: { questionInput, askButton, statusText, answerOutput, questionEcho, questionGrid }
  });
  app.mount();
  // 暴露到 window，便于在浏览器 console 调试。
  window.__askUi = app;
}

module.exports = {
  handleComposerKeyDown,
  validateSubmit,
  applyQuestionToComposer,
  createApp,
  renderMarkdown,
  escapeHtml,
  applyInlineMarkdown
};
