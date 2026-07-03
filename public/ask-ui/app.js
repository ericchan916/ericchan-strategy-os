const questionInput = document.querySelector("#questionInput");
const askButton = document.querySelector("#askButton");
const statusText = document.querySelector("#statusText");
const answerOutput = document.querySelector("#answerOutput");
const questionGrid = document.querySelector("#recommendedQuestions");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("");
}

async function ask(question) {
  const value = String(question || questionInput.value || "").trim();
  if (!value) {
    statusText.textContent = "请先输入一个问题。";
    return;
  }

  questionInput.value = value;
  askButton.disabled = true;
  statusText.textContent = "正在生成回答...";
  answerOutput.classList.remove("empty");

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "回答生成失败。");
    answerOutput.innerHTML = renderMarkdown(payload.answer);
    statusText.textContent = "回答已生成。";
  } catch (error) {
    answerOutput.textContent = "回答生成失败，请检查终端日志或先运行 npm run today。";
    statusText.textContent = error.message || "回答生成失败。";
  } finally {
    askButton.disabled = false;
  }
}

function renderQuestions() {
  const questions = JSON.parse(questionGrid.dataset.questions || "[]");
  questionGrid.innerHTML = "";
  questions.forEach((question) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = question;
    button.addEventListener("click", () => ask(question));
    questionGrid.appendChild(button);
  });
}

askButton.addEventListener("click", () => ask());
questionInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") ask();
});
renderQuestions();
