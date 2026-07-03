const questionInput = document.querySelector("#questionInput");
const askButton = document.querySelector("#askButton");
const statusText = document.querySelector("#statusText");
const answerOutput = document.querySelector("#answerOutput");
const questionEcho = document.querySelector("#questionEcho");
const questionGrid = document.querySelector("#recommendedQuestions");

let recommendedButtons = [];
let inFlight = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 必须在 escapeHtml 之后调用，因为输入字符串已经是转义后的 HTML 安全文本。
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

function setStatus(message, tone) {
  statusText.textContent = message;
  if (tone === "error") statusText.setAttribute("data-tone", "error");
  else statusText.removeAttribute("data-tone");
}

function setInFlight(value) {
  inFlight = value;
  askButton.disabled = value;
  for (const btn of recommendedButtons) btn.disabled = value;
}

function clearSelectedQuestion() {
  for (const btn of recommendedButtons) btn.setAttribute("aria-pressed", "false");
}

function selectQuestionButton(button) {
  for (const btn of recommendedButtons) {
    btn.setAttribute("aria-pressed", btn === button ? "true" : "false");
  }
}

async function ask(question) {
  if (inFlight) return;
  const value = String(question || questionInput.value || "").trim();
  if (!value) {
    setStatus("请先输入一个问题。", "error");
    questionInput.focus();
    return;
  }

  questionInput.value = value;
  setInFlight(true);
  setStatus("正在生成战略判断……");
  answerOutput.classList.remove("empty");
  questionEcho.hidden = false;
  questionEcho.innerHTML = `<strong>提问：</strong>${escapeHtml(value)}`;

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "回答生成失败。");
    answerOutput.innerHTML = renderMarkdown(payload.answer);
    setStatus("回答已生成。");
    answerOutput.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    answerOutput.textContent = "回答生成失败，请检查终端日志或先运行 npm run today。";
    setStatus(error.message || "回答生成失败。", "error");
  } finally {
    setInFlight(false);
  }
}

function renderQuestions() {
  const questions = JSON.parse(questionGrid.dataset.questions || "[]");
  questionGrid.innerHTML = "";
  recommendedButtons = [];
  questions.forEach((question) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "question-button";
    button.textContent = question;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (inFlight) return;
      selectQuestionButton(button);
      ask(question);
    });
    questionGrid.appendChild(button);
    recommendedButtons.push(button);
  });
}

askButton.addEventListener("click", () => {
  clearSelectedQuestion();
  ask();
});

questionInput.addEventListener("input", () => {
  if (inFlight) return;
  if (questionInput.value.trim()) clearSelectedQuestion();
});

questionInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    clearSelectedQuestion();
    ask();
  }
});

renderQuestions();