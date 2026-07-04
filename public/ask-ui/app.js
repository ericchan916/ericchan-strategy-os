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
const OPPORTUNITY_STATUS_LABELS = {
  inbox: "待处理",
  watch: "观察中",
  validate: "待验证",
  "mvp-spec": "MVP 规格",
  building: "构建中",
  archived: "已归档",
  rejected: "已拒绝"
};

// V0.3.10：机会类型英文枚举 → 中文标签
const OPPORTUNITY_TYPE_LABELS = {
  "new-project-opportunity": "新项目机会",
  "current-project-improvement": "当前项目改进",
  "legacy-learning-material": "旧项目学习材料",
  "watch-only": "仅观察"
};

// V0.3.10：评分字段英文 → 中文标签
const OPPORTUNITY_SCORE_LABELS = {
  monetizationPotential: "变现潜力",
  ericChanFit: "个人匹配度",
  mvpSpeed: "MVP 速度",
  aiLeverage: "AI 杠杆",
  opcFit: "OPC 匹配度",
  contentAssetPotential: "内容资产潜力",
  longTermCompounding: "长期复利",
  complexityRisk: "复杂度风险",
  currentStageFit: "当前阶段匹配度"
};

// V0.3.10：预设标签 chips 白名单
const PRESET_TAGS = [
  "AI Agent",
  "大模型应用",
  "独立开发者",
  "小型可变现",
  "内容产品",
  "自动化工作流",
  "编程工具",
  "前端视觉",
  "个人 OS",
  "OPC",
  "需要调研",
  "可快速验证",
  "暂缓",
  "高潜力",
  "噪声较大"
];

// V0.3.10-hotfix：旧英文 opportunityName 的中文映射（与服务端 OPPORTUNITY_TITLE_OVERRIDES 保持一致）
const OPPORTUNITY_TITLE_OVERRIDES = {
  "Independent AI opportunity brief MVP": "独立 AI 机会简报 MVP",
  "Opportunity scoring quality gate": "机会评分质量门槛"
};

// V0.3.10-hotfix：把任意 opportunityName 解析为"前端要展示"的中文标题
// 与服务端 opportunity-store.getDisplayTitle 行为一致；这里再写一遍避免 fetch 一次 RTT。
function getDisplayTitleClient(item) {
  const raw = item && typeof item === "object" ? item : {};
  const original = String(raw.opportunityName || raw.title || "").trim();
  if (!original) return "未命名机会";
  if (OPPORTUNITY_TITLE_OVERRIDES[original]) return OPPORTUNITY_TITLE_OVERRIDES[original];
  if (/[�锟]/.test(original)) {
    if (/V0\.3\./.test(original)) return "V0.3.10 测试机会（标题损坏，请编辑）";
    return "机会标题损坏，请编辑补充";
  }
  if (/[一-龥]/.test(original)) return original;
  return `机会：${original}`;
}

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
  const searchUsed = raw.searchUsed === true;
  const searchWarning = raw.searchWarning == null ? null : String(raw.searchWarning);
  const searchResultCount = Number.isFinite(Number(raw.searchResultCount)) ? Number(raw.searchResultCount) : 0;
  const searchSources = Array.isArray(raw.searchSources)
    ? raw.searchSources
        .slice(0, 5)
        .map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          url: typeof item.url === "string" ? item.url : "",
          source: typeof item.source === "string" ? item.source : ""
        }))
    : [];
  const searchPlannedQueries = Array.isArray(raw.searchPlannedQueries)
    ? raw.searchPlannedQueries.slice(0, 3).map((item) => String(item || "")).filter(Boolean)
    : [];
  const searchRecencyRaw = raw.searchRecency && typeof raw.searchRecency === "object" ? raw.searchRecency : {};
  const searchFiltersRaw = raw.searchFilters && typeof raw.searchFilters === "object" ? raw.searchFilters : {};
  const searchQualityRaw = raw.searchQuality && typeof raw.searchQuality === "object" ? raw.searchQuality : {};
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : makeHistoryId(),
    question,
    answer,
    source,
    warning,
    searchUsed,
    searchWarning,
    searchResultCount,
    searchSources,
    searchIntent: typeof raw.searchIntent === "string" ? raw.searchIntent : "",
    searchPlannedQueries,
    searchFreshness: typeof raw.searchFreshness === "string" ? raw.searchFreshness : "",
    searchRecency: {
      required: searchRecencyRaw.required === true,
      reason: typeof searchRecencyRaw.reason === "string" ? searchRecencyRaw.reason : "",
      filteredOldCount: Number.isFinite(Number(searchRecencyRaw.filteredOldCount)) ? Number(searchRecencyRaw.filteredOldCount) : 0,
      missingDateCount: Number.isFinite(Number(searchRecencyRaw.missingDateCount)) ? Number(searchRecencyRaw.missingDateCount) : 0,
      oldestKeptDate: searchRecencyRaw.oldestKeptDate == null ? null : String(searchRecencyRaw.oldestKeptDate),
      newestKeptDate: searchRecencyRaw.newestKeptDate == null ? null : String(searchRecencyRaw.newestKeptDate)
    },
    searchFilters: {
      blockedTopicCount: Number.isFinite(Number(searchFiltersRaw.blockedTopicCount)) ? Number(searchFiltersRaw.blockedTopicCount) : 0,
      duplicateCount: Number.isFinite(Number(searchFiltersRaw.duplicateCount)) ? Number(searchFiltersRaw.duplicateCount) : 0
    },
    searchQuality: {
      averageScore: Number.isFinite(Number(searchQualityRaw.averageScore)) ? Number(searchQualityRaw.averageScore) : 0,
      topSourceScore: Number.isFinite(Number(searchQualityRaw.topSourceScore)) ? Number(searchQualityRaw.topSourceScore) : 0,
      lowQualityCount: Number.isFinite(Number(searchQualityRaw.lowQualityCount)) ? Number(searchQualityRaw.lowQualityCount) : 0,
      weakReason: typeof searchQualityRaw.weakReason === "string" ? searchQualityRaw.weakReason : "",
      hasHighConfidenceSources: searchQualityRaw.hasHighConfidenceSources === true
    },
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
  // V0.3.6：明确忽略 searchSources / 任何外部结构，避免 raw JSON 进剪贴板。
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

// ============== Search sources panel (V0.3.6) ==============
//
// 纯函数：把 search.sources 渲染成轻量 HTML 字符串。
// - 空数组 / 非数组：返回空字符串（不渲染空来源框）。
// - 只保留前 5 条。
// - 所有用户字段都做 HTML escape，避免 XSS。
// - url 必须是 http(s) 协议且 host 不为 localhost / 127.* / 0.0.0.0 才允许 <a target="_blank">；
//   否则只显示文本，避免把内部 URL 误开放成外链。
// - 容器默认带 class "search-sources"，可被覆盖。

const SAFE_EXTERNAL_PROTOCOLS = ["http:", "https:"];
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];

function isSafeExternalUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!SAFE_EXTERNAL_PROTOCOLS.includes(parsed.protocol)) return false;
  if (BLOCKED_HOSTS.includes(parsed.hostname)) return false;
  return true;
}

function pickTitle(item) {
  return typeof item?.title === "string" ? item.title : "";
}

function pickSourceLabel(item) {
  if (typeof item?.source === "string" && item.source.trim()) return item.source;
  if (typeof item?.url === "string" && item.url) {
    try {
      return new URL(item.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }
  return "";
}

function pickUrl(item) {
  return typeof item?.url === "string" ? item.url : "";
}

function renderSearchSources(sources, options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  const maxResults = Number.isFinite(options.maxResults) && options.maxResults > 0
    ? Math.min(Math.floor(options.maxResults), 5)
    : 5;
  const containerClass = typeof options.containerClass === "string" && options.containerClass
    ? options.containerClass
    : "search-sources";
  const items = sources.slice(0, maxResults).map((item) => {
    const title = escapeHtml(pickTitle(item) || "未命名来源");
    const sourceLabel = escapeHtml(pickSourceLabel(item));
    const url = pickUrl(item);
    const safeUrl = isSafeExternalUrl(url);
    const urlEscaped = safeUrl ? escapeHtml(url) : "";
    const linkHtml = safeUrl
      ? `<a href="${urlEscaped}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : `<span class="search-source-title">${title}</span>`;
    const metaHtml = sourceLabel
      ? `<span class="search-source-meta">${sourceLabel}</span>`
      : "";
    return `<li class="search-source-item">${linkHtml}${metaHtml}</li>`;
  });

  const header = `<div class="search-sources-head">参考来源</div>`;
  const summary = `<p class="search-sources-summary">已参考 ${items.length} 条外部结果。</p>`;
  const list = `<ul class="search-sources-list">${items.join("")}</ul>`;
  return `<section class="${escapeHtml(containerClass)}" data-source="search-sources" aria-label="参考来源">${header}${summary}${list}</section>`;
}

function emptySearchSourcesMarkup() {
  return "";
}

function hideSearchSources(node) {
  if (!node) return;
  node.innerHTML = "";
  node.hidden = true;
}

function showSearchSources(node, markup) {
  if (!node) return;
  if (!markup) {
    hideSearchSources(node);
    return;
  }
  node.innerHTML = markup;
  node.hidden = false;
}

// ============== Search process panel (V0.3.8) ==============

function intentLabel(intent) {
  const labels = {
    "ai-opportunity": "AI 机会",
    "project-research": "项目调研",
    news: "新闻",
    "competitor-research": "竞品研究",
    "technical-docs": "技术文档",
    general: "普通搜索"
  };
  return labels[intent] || "普通搜索";
}

function freshnessLabel(freshness) {
  const labels = {
    oneDay: "最近一天",
    oneWeek: "最近一周",
    oneMonth: "最近一月",
    oneYear: "最近一年",
    noLimit: "不限制"
  };
  return labels[freshness] || (freshness ? String(freshness) : "由问题决定");
}

function renderSearchProcess(search) {
  if (!search || search.used !== true) return "";
  const queries = Array.isArray(search.plannedQueries)
    ? search.plannedQueries.slice(0, 3).filter(Boolean)
    : [];
  const recency = search.recency && typeof search.recency === "object" ? search.recency : {};
  const filters = search.filters && typeof search.filters === "object" ? search.filters : {};
  const blocked = Number.isFinite(Number(filters.blockedTopicCount)) ? Number(filters.blockedTopicCount) : 0;
  const duplicate = Number.isFinite(Number(filters.duplicateCount)) ? Number(filters.duplicateCount) : 0;
  const old = Number.isFinite(Number(recency.filteredOldCount)) ? Number(recency.filteredOldCount) : 0;
  const missing = Number.isFinite(Number(recency.missingDateCount)) ? Number(recency.missingDateCount) : 0;
  const quality = search.quality && typeof search.quality === "object" ? search.quality : {};
  const qualityLabelText = quality.hasHighConfidenceSources
    ? "较高，已优先采用近期且相关的外部结果。"
    : Number(quality.averageScore || 0) >= 55
      ? "一般，部分结果仍需人工判断。"
      : "偏弱，外部搜索仅作参考。";
  const warning = typeof search.warning === "string" ? search.warning : "";
  const queryHtml = queries.length
    ? `<ol class="search-process-query-list">${queries.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : "";
  const warningHtml = /时效性较弱/.test(warning)
    ? `<li class="search-process-warning">搜索结果时效性较弱，请谨慎参考。</li>`
    : "";

  return `<details class="search-process-details">
  <summary>搜索过程</summary>
  <ul class="search-process-list">
    <li><strong>搜索意图：</strong>${escapeHtml(intentLabel(search.intent))}</li>
    <li><strong>实际搜索词：</strong>${queryHtml || "（无）"}</li>
    <li><strong>时间范围：</strong>${escapeHtml(freshnessLabel(search.freshness))}</li>
    <li><strong>来源质量：</strong>${escapeHtml(qualityLabelText)}</li>
    <li><strong>过滤说明：</strong>已过滤 ${blocked} 条无关财经结果，已过滤 ${old} 条过旧结果，去重 ${duplicate} 条，${missing} 条结果缺少发布时间。</li>
    ${recency.reason ? `<li><strong>时效性原因：</strong>${escapeHtml(recency.reason)}</li>` : ""}
    ${warningHtml}
  </ul>
</details>`;
}

// ============== Opportunity panel (V0.3.9) ==============

function statusLabel(status) {
  return OPPORTUNITY_STATUS_LABELS[status] || "待处理";
}

function normalizeOpportunityForUi(item) {
  const raw = item && typeof item === "object" ? item : {};
  const type = OPPORTUNITY_TYPE_LABELS[raw.type] ? raw.type : (raw.type || "new-project-opportunity");
  // V0.3.10：humanDecisionLabel 缺失时，根据 humanDecision 自动派生
  let humanDecisionLabel = String(raw.humanDecisionLabel || "");
  if (!humanDecisionLabel && raw.humanDecision) {
    const labelMap = { pending: "待判断", accepted: "已确认", watching: "观察中", rejected: "已拒绝", done: "已完成" };
    humanDecisionLabel = labelMap[raw.humanDecision] || "";
  }
  return {
    id: String(raw.id || ""),
    opportunityName: String(raw.opportunityName || raw.title || "未命名机会"),
    // V0.3.10-hotfix：服务端可能已 normalize 出 displayTitle；缺则前端兜底
    displayTitle: String(raw.displayTitle || getDisplayTitleClient(raw)),
    status: String(raw.status || "inbox"),
    statusLabel: String(raw.statusLabel || statusLabel(raw.status)),
    type,
    typeLabel: OPPORTUNITY_TYPE_LABELS[type] || "新项目机会",
    humanDecisionLabel,
    notes: String(raw.notes || ""),
    nextAction: typeof raw.nextAction === "string" ? raw.nextAction : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
    sourceTrend: raw.sourceTrend ? String(raw.sourceTrend) : "",
    source: raw.source ? String(raw.source) : "",
    scores: raw.scores && typeof raw.scores === "object" ? raw.scores : {}
  };
}

function renderOpportunityStats(stats = {}) {
  const safe = {
    total: Number(stats.total || 0),
    accepted: Number(stats.accepted || 0),
    validate: Number(stats.validate || 0),
    watch: Number(stats.watch || 0),
    archived: Number(stats.archived || 0)
  };
  return `<div class="opportunity-stat-grid">
    <span>全部 ${safe.total}</span>
    <span>已确认 ${safe.accepted}</span>
    <span>待验证 ${safe.validate}</span>
    <span>观察中 ${safe.watch}</span>
    <span>已归档 ${safe.archived}</span>
  </div>`;
}

function renderScoreChips(scores) {
  if (!scores || typeof scores !== "object") return "";
  const items = Object.entries(scores)
    .filter(([key, value]) => OPPORTUNITY_SCORE_LABELS[key] && value != null && value !== "")
    .map(([key, value]) => `<span class="opportunity-score-chip"><span class="opportunity-score-key">${escapeHtml(OPPORTUNITY_SCORE_LABELS[key])}</span><span class="opportunity-score-value">${escapeHtml(String(value))}</span></span>`)
    .join("");
  return items ? `<div class="opportunity-scores">${items}</div>` : "";
}

function renderTagChips(tags, { selectedAttr = "" } = {}) {
  if (!Array.isArray(tags) || !tags.length) return "";
  return tags
    .filter((tag) => tag)
    .map((tag) => {
      const safe = escapeHtml(String(tag));
      const cls = PRESET_TAGS.includes(tag) ? "opportunity-tag opportunity-tag--preset" : "opportunity-tag opportunity-tag--custom";
      const attr = selectedAttr ? ` data-op-tag="${safe}"` : "";
      return `<span class="${cls}"${attr}>${safe}</span>`;
    })
    .join("");
}

function renderPresetTagChips(selectedTags) {
  const selected = new Set(Array.isArray(selectedTags) ? selectedTags : []);
  return PRESET_TAGS
    .map((tag) => {
      const isSelected = selected.has(tag);
      const cls = isSelected
        ? "opportunity-tag-chip opportunity-tag-chip--selected"
        : "opportunity-tag-chip";
      return `<button type="button" class="${cls}" data-op-add-tag="${escapeHtml(tag)}" aria-pressed="${isSelected ? "true" : "false"}">${escapeHtml(tag)}</button>`;
    })
    .join("");
}

function renderOpportunityPanel({ opportunities = [], stats = {} } = {}) {
  const list = Array.isArray(opportunities) ? opportunities.map(normalizeOpportunityForUi) : [];
  if (!list.length) return { statsHtml: renderOpportunityStats(stats), listHtml: "" };
  const listHtml = list
    .map((item) => {
      const statusOptions = Object.entries(OPPORTUNITY_STATUS_LABELS)
        .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === item.status ? " selected" : ""}>${escapeHtml(label)}</option>`)
        .join("");
      const typeOptions = Object.entries(OPPORTUNITY_TYPE_LABELS)
        .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === item.type ? " selected" : ""}>${escapeHtml(label)}</option>`)
        .join("");
      // V0.3.10-hotfix：使用 displayTitle 兜底，乱码 / 旧英文都会显示中文
      const showTitle = item.displayTitle || item.opportunityName || "未命名机会";
      const isUnclearTitle = !showTitle || showTitle === "未命名机会" || /标题损坏|未命名/.test(showTitle);
      const titleWarning = isUnclearTitle
        ? `<p class="opportunity-title-warning">这个机会缺少清晰标题，建议补充名称。</p>`
        : "";
      const tagChips = renderTagChips(item.tags);
      const scoreChips = renderScoreChips(item.scores);
      const sourceLabelMap = {
        "ask-mode": "来自 Ask Mode",
        search: "来自搜索",
        manual: "手动添加",
        history: "历史机会"
      };
      const sourceLabel = sourceLabelMap[item.source] || "";
      const noteLine = item.notes
        ? `<p class="opportunity-note">${escapeHtml(item.notes)}</p>`
        : `<p class="opportunity-note-empty">暂无备注</p>`;
      const nextLine = item.nextAction
        ? `<p class="opportunity-next">下一步：${escapeHtml(item.nextAction)}</p>`
        : `<p class="opportunity-next-empty">暂无下一步</p>`;
      const updatedLine = item.updatedAt
        ? `<span>更新 ${escapeHtml(item.updatedAt.slice(0, 10))}</span>`
        : "";
      const sourceLine = sourceLabel ? `<span>${escapeHtml(sourceLabel)}</span>` : "";
      return `<article class="opportunity-item" data-opportunity-id="${escapeHtml(item.id)}">
        <div class="opportunity-item-head">
          <h3>${escapeHtml(showTitle)}</h3>
          <span class="opportunity-badge">${escapeHtml(item.statusLabel)}</span>
        </div>
        ${titleWarning}
        <p class="opportunity-meta">${escapeHtml(item.typeLabel)}${item.humanDecisionLabel ? ` · ${escapeHtml(item.humanDecisionLabel)}` : ""}${sourceLine ? ` · ${sourceLine}` : ""}${updatedLine ? ` · ${updatedLine}` : ""}</p>
        ${item.sourceTrend ? `<p class="opportunity-source">${escapeHtml(item.sourceTrend)}</p>` : ""}
        ${scoreChips}
        ${tagChips ? `<div class="opportunity-tags">${tagChips}</div>` : ""}
        ${noteLine}
        ${nextLine}
        <div class="opportunity-actions">
          <button type="button" class="link-button opportunity-edit" data-op-edit="${escapeHtml(item.id)}">编辑</button>
          <button type="button" class="link-button opportunity-delete" data-op-delete="${escapeHtml(item.id)}">删除</button>
        </div>
        <form class="opportunity-form" data-op-form="${escapeHtml(item.id)}" hidden>
          <label>机会名称
            <input name="opportunityName" data-op-name="${escapeHtml(item.id)}" value="${escapeHtml(item.displayTitle || item.opportunityName)}" maxlength="200" placeholder="请填写机会名称" />
          </label>
          <label>状态
            <select name="status" data-op-status="${escapeHtml(item.id)}">${statusOptions}</select>
          </label>
          <label>类型
            <select name="type" data-op-type="${escapeHtml(item.id)}">${typeOptions}</select>
          </label>
          <label>备注
            <textarea name="notes" data-op-notes="${escapeHtml(item.id)}" rows="3" placeholder="暂无备注">${escapeHtml(item.notes)}</textarea>
          </label>
          <label>下一步
            <input name="nextAction" data-op-next="${escapeHtml(item.id)}" value="${escapeHtml(item.nextAction)}" placeholder="暂无下一步" />
          </label>
          <fieldset class="opportunity-tags-fieldset">
            <legend>标签（点击切换）</legend>
            <div class="opportunity-tag-chips" data-op-tags="${escapeHtml(item.id)}">${renderPresetTagChips(item.tags)}</div>
          </fieldset>
          <div class="opportunity-form-actions">
            <button type="submit" class="mini-button">保存</button>
            <button type="button" class="link-button" data-op-cancel="${escapeHtml(item.id)}">取消</button>
          </div>
        </form>
      </article>`;
    })
    .join("");
  return { statsHtml: renderOpportunityStats(stats), listHtml };
}

// V0.3.10：从一次 Ask 回答构建"加入机会池"表单的 HTML
function buildAddOpportunityFormMarkup({
  question = "",
  answer = "",
  sourceUrls = [],
  source = "ask-mode"
} = {}) {
  const safeQuestion = String(question || "").trim();
  const safeAnswer = String(answer || "").trim();
  // 摘要 = 截到最近的句子边界，不超过 300 字
  function shortAnswer(text, max = 300) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (value.length <= max) return value;
    const slice = value.slice(0, max);
    const lastStop = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("."), slice.lastIndexOf("！"), slice.lastIndexOf("!"));
    return lastStop > max * 0.5 ? `${slice.slice(0, lastStop + 1)}…` : `${slice}…`;
  }
  const summary = shortAnswer(safeAnswer, 300);
  const defaultTitle = safeQuestion
    ? safeQuestion.replace(/[？?！!。.,，、；;：:]+$/g, "").slice(0, 60)
    : "";
  const statusOptions = Object.entries(OPPORTUNITY_STATUS_LABELS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === "validate" ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const typeOptions = Object.entries(OPPORTUNITY_TYPE_LABELS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === "new-project-opportunity" ? " selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const tagChips = renderPresetTagChips([]);
  const sourceUrlList = Array.isArray(sourceUrls) && sourceUrls.length
    ? `<ul class="opportunity-source-url-list" aria-label="已带入的参考来源">${sourceUrls.map((u) => {
        const t = escapeHtml(String(u.title || "未命名来源"));
        const s = escapeHtml(String(u.source || ""));
        const url = escapeHtml(String(u.url || ""));
        return `<li class="opportunity-source-url-item"><span class="opportunity-source-url-title">${t}</span>${s ? `<span class="opportunity-source-url-meta">${s}</span>` : ""}${url ? `<span class="opportunity-source-url-link">${url}</span>` : ""}</li>`;
      }).join("")}</ul>`
    : "";
  const sourceUrlChips = Array.isArray(sourceUrls) && sourceUrls.length
    ? `<div class="opportunity-source-urls">${escapeHtml(`已带入 ${sourceUrls.length} 条参考来源（仅保存标题/链接/域名）`)}${sourceUrlList}</div>`
    : "";
  const sourceBadge = source === "search"
    ? `<span class="opportunity-source">来自搜索</span>`
    : `<span class="opportunity-source">来自 Ask Mode</span>`;
  return `<form class="opportunity-add-form" data-op-add-form>
    <div class="opportunity-add-head">
      <h3>加入机会池</h3>
      ${sourceBadge}
    </div>
    <label>机会名称
      <input name="title" data-op-add-title placeholder="请填写机会名称（必填）" value="${escapeHtml(defaultTitle)}" required maxlength="200" />
    </label>
    <label>状态
      <select name="status" data-op-add-status>${statusOptions}</select>
    </label>
    <label>类型
      <select name="type" data-op-add-type>${typeOptions}</select>
    </label>
    <label>备注（默认填入本次问题与回答摘要，可编辑）
      <textarea name="note" data-op-add-note rows="4" maxlength="3000" placeholder="暂无备注">${escapeHtml(summary || safeQuestion || "")}</textarea>
    </label>
    <fieldset class="opportunity-tags-fieldset">
      <legend>标签（点击切换）</legend>
      <div class="opportunity-tag-chips" data-op-add-tags>${tagChips}</div>
    </fieldset>
    ${sourceUrlChips}
    <div class="opportunity-form-actions">
      <button type="submit" class="mini-button" data-op-add-submit>加入机会池</button>
      <button type="button" class="link-button" data-op-add-cancel>取消</button>
    </div>
  </form>`;
}

function hideSearchProcess(node) {
  if (!node) return;
  node.innerHTML = "";
  node.hidden = true;
}

function showSearchProcess(node, markup) {
  if (!node) return;
  if (!markup) {
    hideSearchProcess(node);
    return;
  }
  node.innerHTML = markup;
  node.hidden = false;
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
  const webSearchToggle = nodes.webSearchToggle;
  const searchSourcesNode = nodes.searchSources;
  const searchProcessNode = nodes.searchProcess;
  const globalStatusText = nodes.globalStatusText;
  const opportunityStats = nodes.opportunityStats;
  const opportunityList = nodes.opportunityList;
  const opportunityEmpty = nodes.opportunityEmpty;
  const opportunityStatus = nodes.opportunityStatus;
  const addOpportunityButton = nodes.addOpportunityButton;
  const addOpportunityContainer = nodes.addOpportunityContainer;
  const confirmImpl = deps.confirmImpl || ((message) => (typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(message) : true));

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
    currentSource: "",
    currentSearch: null,
    currentQuestion: "",
    opportunities: []
  };

  const historyStore = createHistoryStore({ storage, maxSize: 20 });

  function setStatus(message, tone) {
    if (statusText) {
      statusText.textContent = message;
      if (tone === "error") statusText.setAttribute("data-tone", "error");
      else statusText.removeAttribute("data-tone");
    }
  }

  function statusFromSource(source, warning, search) {
    if (search && search.warning) return search.warning;
    if (search && search.used && source === "llm") return "已使用动态战略回答，并参考外部搜索结果。";
    if (search && search.used) return "已参考外部搜索结果，并使用本地上下文回答。";
    if (warning) return warning;
    if (source === "llm") return "已使用动态战略回答。";
    if (source === "local") return "已使用本地规则回答。";
    if (source === "local-fallback") return "LLM 动态回答暂时不可用，已回退到本地规则回答。";
    return "回答已生成。";
  }

  // V0.3.6：根据 search 字段决定是否展示参考来源。
  //  - used=true && sources.length>0：渲染
  //  - used=true && warning 存在：不渲染空来源，只在状态条里给中文提示
  //  - used=false / search 缺失：隐藏
  function applySearchSources(search) {
    if (!searchSourcesNode) return;
    const used = search && search.used === true;
    const hasWarning = Boolean(search && search.warning);
    const list = used && Array.isArray(search.sources) ? search.sources : [];
    if (!used || hasWarning || list.length === 0) {
      hideSearchSources(searchSourcesNode);
      return;
    }
    showSearchSources(searchSourcesNode, renderSearchSources(list));
  }

  function setGlobalStatus(mode) {
    if (!globalStatusText) return;
    const messages = {
      idle: "本地运行 · 中文回答 · 不自动派发智能体 · 默认不联网",
      readySearch: "本地运行 · 中文回答 · 不自动派发智能体 · 本次将联网搜索",
      searching: "本地运行 · 中文回答 · 正在联网搜索 · 不自动派发智能体",
      searchSuccess: "本地运行 · 中文回答 · 已参考外部搜索结果 · 不自动派发智能体",
      searchFailed: "本地运行 · 中文回答 · 联网搜索失败，已本地回答 · 不自动派发智能体",
      localAnswer: "本地运行 · 中文回答 · 本地上下文回答 · 不自动派发智能体"
    };
    globalStatusText.textContent = messages[mode] || messages.idle;
  }

  function applySearchProcess(search) {
    if (!searchProcessNode) return;
    showSearchProcess(searchProcessNode, renderSearchProcess(search));
  }

  function setOpportunityStatus(message, tone) {
    if (!opportunityStatus) return;
    opportunityStatus.textContent = message || "";
    if (tone === "error") opportunityStatus.setAttribute("data-tone", "error");
    else opportunityStatus.removeAttribute("data-tone");
  }

  function applyOpportunityPanel(data) {
    const opportunities = Array.isArray(data && data.opportunities) ? data.opportunities : [];
    const rendered = renderOpportunityPanel({ opportunities, stats: data && data.stats });
    if (opportunityStats) opportunityStats.innerHTML = rendered.statsHtml;
    if (opportunityList) opportunityList.innerHTML = rendered.listHtml;
    if (opportunityEmpty) opportunityEmpty.hidden = opportunities.length > 0;
    state.opportunities = opportunities;
    bindOpportunityActions();
  }

  async function loadOpportunities() {
    if (!fetchImpl || !opportunityList) return { ok: false, reason: "unavailable" };
    try {
      const response = await fetchImpl("/api/opportunities");
      const payload = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) throw new Error((payload && payload.error) || "机会池读取失败。");
      applyOpportunityPanel(payload);
      setOpportunityStatus("");
      return { ok: true, opportunities: payload.opportunities || [] };
    } catch (error) {
      applyOpportunityPanel({ opportunities: [], stats: {} });
      setOpportunityStatus((error && error.message) || "机会池读取失败。", "error");
      return { ok: false, reason: (error && error.message) || "unknown" };
    }
  }

  function bindOpportunityActions() {
    if (!opportunityList || typeof opportunityList.querySelectorAll !== "function") return;
    for (const button of opportunityList.querySelectorAll("[data-op-edit]")) {
      button.addEventListener("click", () => toggleOpportunityForm(button.getAttribute("data-op-edit"), true));
    }
    for (const button of opportunityList.querySelectorAll("[data-op-cancel]")) {
      button.addEventListener("click", () => toggleOpportunityForm(button.getAttribute("data-op-cancel"), false));
    }
    for (const button of opportunityList.querySelectorAll("[data-op-delete]")) {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-op-delete");
        if (!id) return;
        deleteOpportunityFromUi(id);
      });
    }
    for (const form of opportunityList.querySelectorAll("[data-op-form]")) {
      form.addEventListener("submit", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        saveOpportunity(form.getAttribute("data-op-form"));
      });
    }
    // V0.3.10：标签 chip 点击切换
    for (const chip of opportunityList.querySelectorAll("[data-op-tag]")) {
      chip.addEventListener("click", () => {
        const selected = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", selected ? "false" : "true");
        chip.classList.toggle("opportunity-tag-chip--selected", !selected);
      });
    }
  }

  async function deleteOpportunityFromUi(id) {
    if (!fetchImpl) {
      setOpportunityStatus("无法连接机会池 API。", "error");
      return { ok: false };
    }
    if (!confirmImpl("确定要删除这个机会吗？此操作会从机会池中移除它。")) {
      setOpportunityStatus("");
      return { ok: false, reason: "cancelled" };
    }
    try {
      const response = await fetchImpl(`/api/opportunities/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) throw new Error((payload && payload.error) || "机会删除失败。");
      applyOpportunityPanel(payload);
      setOpportunityStatus("已删除。");
      return { ok: true };
    } catch (error) {
      setOpportunityStatus((error && error.message) || "机会删除失败。", "error");
      return { ok: false, reason: (error && error.message) || "unknown" };
    }
  }

  function toggleOpportunityForm(id, open) {
    if (!opportunityList || typeof opportunityList.querySelector !== "function") return;
    const form = opportunityList.querySelector(`[data-op-form="${cssEscape(id)}"]`);
    if (form) form.hidden = !open;
  }

  function readSelectedTagsFromChips(container) {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    const out = [];
    for (const chip of container.querySelectorAll("[data-op-tag]")) {
      if (chip.getAttribute("aria-pressed") === "true") {
        out.push(chip.getAttribute("data-op-tag"));
      }
    }
    return out;
  }

  async function saveOpportunity(id) {
    if (!fetchImpl || !opportunityList) return { ok: false, reason: "fetch-unavailable" };
    const nameNode = opportunityList.querySelector(`[data-op-name="${cssEscape(id)}"]`);
    const statusNode = opportunityList.querySelector(`[data-op-status="${cssEscape(id)}"]`);
    const notesNode = opportunityList.querySelector(`[data-op-notes="${cssEscape(id)}"]`);
    const typeNode = opportunityList.querySelector(`[data-op-type="${cssEscape(id)}"]`);
    const nextNode = opportunityList.querySelector(`[data-op-next="${cssEscape(id)}"]`);
    const tagsContainer = opportunityList.querySelector(`[data-op-tags="${cssEscape(id)}"]`);
    const nextName = nameNode ? String(nameNode.value || "").trim() : "";
    const nextStatus = statusNode ? statusNode.value : "";
    const nextType = typeNode ? typeNode.value : "";
    const nextNote = notesNode ? notesNode.value : "";
    const nextAction = nextNode ? nextNode.value : "";
    const nextTags = readSelectedTagsFromChips(tagsContainer);
    if ((nextStatus === "archived" || nextStatus === "rejected") && !confirmImpl("确认要归档或忽略这个机会吗？")) {
      return { ok: false, reason: "cancelled" };
    }
    try {
      const patch = {
        status: nextStatus,
        type: nextType,
        notes: nextNote,
        nextAction: nextAction,
        tags: nextTags
      };
      if (nextName) patch.opportunityName = nextName;
      const response = await fetchImpl(`/api/opportunities/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      });
      const payload = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) throw new Error((payload && payload.error) || "机会池保存失败。");
      applyOpportunityPanel(payload);
      setOpportunityStatus("机会已保存。");
      return { ok: true };
    } catch (error) {
      setOpportunityStatus((error && error.message) || "机会池保存失败。", "error");
      return { ok: false, reason: (error && error.message) || "unknown" };
    }
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

  function setCurrentAnswer(answer, source, meta = {}) {
    state.currentAnswer = typeof answer === "string" ? answer : "";
    state.currentSource = typeof source === "string" ? source : "";
    if (meta && typeof meta === "object") {
      if (typeof meta.question === "string") state.currentQuestion = meta.question;
      if (meta.search) state.currentSearch = meta.search;
    }
    if (copyButton) {
      const hasText = state.currentAnswer.trim().length > 0;
      copyButton.disabled = !hasText;
      copyButton.hidden = !hasText;
      copyButton.removeAttribute("data-state");
    }
    // V0.3.10：回答存在时显示"加入机会池"按钮
    if (addOpportunityButton) {
      const hasAnswer = state.currentAnswer.trim().length > 0;
      addOpportunityButton.hidden = !hasAnswer;
      addOpportunityButton.disabled = state.inFlight;
    }
    // 关闭之前的"加入机会池"弹层
    if (!state.currentAnswer.trim()) {
      closeAddOpportunityForm();
    }
  }

  // V0.3.10：判断回答类型是否是"可能包含新项目 / 机会 / 开工包 / 趋势建议"
  function isOpportunityLikeAnswer(text) {
    const t = String(text || "");
    if (!t) return false;
    return /(开工包|项目体检|新项目|新机会|新方向|新工具|新流程|建议尝试|建议尝试做|可以做|做一个小|机会池|试试|先做|趋势|关注)/.test(t);
  }

  function openAddOpportunityForm() {
    if (!addOpportunityContainer) return;
    const isOpportunityLike = isOpportunityLikeAnswer(state.currentAnswer);
    const labelText = isOpportunityLike ? "加入机会池" : "从本次回答创建机会";
    const source = state.currentSearch && state.currentSearch.used ? "search" : "ask-mode";
    const sourceUrls = state.currentSearch && Array.isArray(state.currentSearch.sources)
      ? state.currentSearch.sources.slice(0, 5).map((s) => ({
          title: String(s.title || "").slice(0, 200),
          url: String(s.url || "").slice(0, 500),
          source: String(s.source || "").slice(0, 80)
        }))
      : [];
    const markup = buildAddOpportunityFormMarkup({
      question: state.currentQuestion,
      answer: state.currentAnswer,
      sourceUrls,
      source
    }).replace("加入机会池", labelText);
    addOpportunityContainer.innerHTML = markup;
    addOpportunityContainer.hidden = false;
    bindAddOpportunityForm();
    if (addOpportunityContainer.scrollIntoView) {
      addOpportunityContainer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function closeAddOpportunityForm() {
    if (!addOpportunityContainer) return;
    addOpportunityContainer.innerHTML = "";
    addOpportunityContainer.hidden = true;
  }

  function bindAddOpportunityForm() {
    if (!addOpportunityContainer || typeof addOpportunityContainer.querySelectorAll !== "function") return;
    for (const chip of addOpportunityContainer.querySelectorAll("[data-op-add-tag]")) {
      chip.addEventListener("click", () => {
        const selected = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", selected ? "false" : "true");
        chip.classList.toggle("opportunity-tag-chip--selected", !selected);
      });
    }
    for (const btn of addOpportunityContainer.querySelectorAll("[data-op-add-cancel]")) {
      btn.addEventListener("click", () => closeAddOpportunityForm());
    }
    const form = addOpportunityContainer.querySelector("[data-op-add-form]");
    if (form) {
      form.addEventListener("submit", (event) => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        submitAddOpportunity();
      });
    }
  }

  function readAddFormPayload() {
    if (!addOpportunityContainer) return null;
    const titleEl = addOpportunityContainer.querySelector("[data-op-add-title]");
    const statusEl = addOpportunityContainer.querySelector("[data-op-add-status]");
    const typeEl = addOpportunityContainer.querySelector("[data-op-add-type]");
    const noteEl = addOpportunityContainer.querySelector("[data-op-add-note]");
    const tagsContainer = addOpportunityContainer.querySelector("[data-op-add-tags]");
    const tags = tagsContainer ? readSelectedTagsFromChips(tagsContainer) : [];
    return {
      title: titleEl ? String(titleEl.value || "").trim() : "",
      status: statusEl ? statusEl.value : "validate",
      type: typeEl ? typeEl.value : "new-project-opportunity",
      note: noteEl ? String(noteEl.value || "").trim() : "",
      tags
    };
  }

  async function submitAddOpportunity() {
    if (!fetchImpl) {
      setOpportunityStatus("无法连接机会池 API。", "error");
      return { ok: false, reason: "fetch-unavailable" };
    }
    const payload = readAddFormPayload();
    if (!payload) return { ok: false, reason: "form-missing" };
    if (!payload.title) {
      setOpportunityStatus("请填写机会名称。", "error");
      return { ok: false, reason: "title-required" };
    }
    const source = state.currentSearch && state.currentSearch.used ? "search" : "ask-mode";
    const sourceUrls = state.currentSearch && Array.isArray(state.currentSearch.sources)
      ? state.currentSearch.sources.slice(0, 5).map((s) => ({
          title: String(s.title || "").slice(0, 200),
          url: String(s.url || "").slice(0, 500),
          source: String(s.source || "").slice(0, 80)
        }))
      : [];
    const body = {
      title: payload.title,
      status: payload.status,
      type: payload.type,
      tags: payload.tags,
      note: payload.note,
      source,
      sourceQuestion: state.currentQuestion || "",
      sourceAnswerSummary: state.currentAnswer.slice(0, 600),
      sourceUrls
    };
    try {
      const response = await fetchImpl("/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) {
        throw new Error((result && result.error) || "加入机会池失败。");
      }
      applyOpportunityPanel(result);
      const warning = result.warning;
      setOpportunityStatus(warning ? `已加入，但${warning}` : "已加入机会池。");
      closeAddOpportunityForm();
      return { ok: true, warning };
    } catch (error) {
      setOpportunityStatus((error && error.message) || "加入机会池失败。", "error");
      return { ok: false, reason: (error && error.message) || "unknown" };
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
      const searchBadge = documentRef.createElement("span");
      searchBadge.className = "history-source";
      searchBadge.dataset.source = entry.searchWarning ? "local-fallback" : "llm";
      searchBadge.textContent = entry.searchWarning ? "搜索失败" : "已搜索";
      searchBadge.hidden = !(entry.searchUsed || entry.searchWarning);

      const time = documentRef.createElement("span");
      time.className = "history-time";
      time.textContent = formatHistoryTime(entry.createdAt, now());

      meta.appendChild(src);
      meta.appendChild(searchBadge);
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
    const search = {
      used: entry.searchUsed === true,
      warning: entry.searchWarning || null,
      resultCount: entry.searchResultCount || 0,
      sources: Array.isArray(entry.searchSources) ? entry.searchSources : [],
      intent: entry.searchIntent || "",
      plannedQueries: Array.isArray(entry.searchPlannedQueries) ? entry.searchPlannedQueries : [],
      freshness: entry.searchFreshness || "",
      recency: entry.searchRecency || null,
      filters: entry.searchFilters || null,
      quality: entry.searchQuality || null
    };
    setStatus(statusFromSource(entry.source, warning, search), warning || search.warning ? "error" : null);
    applySearchSources(search);
    applySearchProcess(search);
    if (search.warning) setGlobalStatus("searchFailed");
    else if (search.used) setGlobalStatus("searchSuccess");
    else setGlobalStatus("localAnswer");
    setCurrentAnswer(entry.answer || "", entry.source || "local", {
      question: entry.question || "",
      search
    });
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
    const useSearch = Boolean(webSearchToggle && webSearchToggle.checked);
    setInFlight(true);
    setStatus(useSearch ? "正在联网搜索并生成战略判断……" : "正在生成战略判断……");
    setGlobalStatus(useSearch ? "searching" : "localAnswer");
    if (answerOutput) {
      answerOutput.classList.remove("empty");
      answerOutput.hidden = true;
    }
    if (questionEcho) {
      questionEcho.hidden = false;
      questionEcho.innerHTML = `<strong>提问：</strong>${escapeHtml(value)}`;
    }
    state.currentQuestion = value;
    state.currentSearch = null;
    applySearchSources(null);
    applySearchProcess(null);
    setCurrentAnswer("", "");
    try {
      if (!fetchImpl) throw new Error("fetch 不可用。");
      const requestBody = { question: value };
      if (useSearch) requestBody.useSearch = true;
      const response = await fetchImpl("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = await (response && typeof response.json === "function" ? response.json() : Promise.resolve({})).catch(() => ({}));
      if (!response || !response.ok) {
        throw new Error((payload && payload.error) || "回答生成失败。");
      }
      // 前端兜底翻译：服务端 sanitize + translate 之后，再做一遍中文化。
      const rawAnswer = payload.answer || "";
      const translatedAnswer = translateInternalTermsClient(rawAnswer);
      const warning = payload.warning;
      const source = payload.source || "local";
      const search = payload.search || null;
      state.currentSource = source;
      state.currentSearch = search;
      // 用 setCurrentAnswer 触发"加入机会池"按钮显隐
      setCurrentAnswer(translatedAnswer, source, { question: value, search });
      if (answerOutput) {
        answerOutput.innerHTML = renderMarkdown(translatedAnswer);
        answerOutput.hidden = false;
      }
      setStatus(statusFromSource(source, warning, search), warning || (search && search.warning) ? "error" : null);
      if (search && search.warning) setGlobalStatus("searchFailed");
      else if (search && search.used) setGlobalStatus("searchSuccess");
      else setGlobalStatus("localAnswer");
      applySearchSources(search);
      applySearchProcess(search);
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
        warning: warning || null,
        searchUsed: Boolean(search && search.used),
        searchWarning: search && search.warning ? search.warning : null,
        searchResultCount: search && Number.isFinite(Number(search.resultCount)) ? Number(search.resultCount) : 0,
        searchSources: search && Array.isArray(search.sources) ? search.sources.slice(0, 5) : [],
        searchIntent: search && typeof search.intent === "string" ? search.intent : "",
        searchPlannedQueries: search && Array.isArray(search.plannedQueries) ? search.plannedQueries.slice(0, 3) : [],
        searchFreshness: search && typeof search.freshness === "string" ? search.freshness : "",
        searchRecency: search && search.recency && typeof search.recency === "object" ? search.recency : null,
        searchFilters: search && search.filters && typeof search.filters === "object" ? search.filters : null,
        searchQuality: search && search.quality && typeof search.quality === "object" ? search.quality : null
      });
      renderHistory();
      return { submitted: true, source, warning: warning || null, search: search || null };
    } catch (error) {
      if (answerOutput) {
        answerOutput.textContent = "回答生成失败，请检查终端日志或先运行 npm run today。";
        answerOutput.hidden = false;
      }
      applySearchSources(null);
      applySearchProcess(null);
      setGlobalStatus(useSearch ? "searchFailed" : "idle");
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
    if (webSearchToggle) {
      webSearchToggle.addEventListener("change", () => {
        if (state.inFlight) return;
        setGlobalStatus(webSearchToggle.checked ? "readySearch" : "idle");
      });
    }
    if (copyButton) {
      copyButton.addEventListener("click", handleCopy);
    }
    if (addOpportunityButton) {
      addOpportunityButton.addEventListener("click", () => {
        if (state.inFlight) return;
        openAddOpportunityForm();
      });
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
    loadOpportunities();
    setGlobalStatus(webSearchToggle && webSearchToggle.checked ? "readySearch" : "idle");
    // V0.3.6：默认隐藏参考来源；恢复历史或新回答时由 applySearchSources 决定显隐。
    if (searchSourcesNode) hideSearchSources(searchSourcesNode);
    if (searchProcessNode) hideSearchProcess(searchProcessNode);
  }

  return {
    submitAsk,
    fillQuestion,
    renderQuestions,
    renderHistory,
    loadOpportunities,
    saveOpportunity,
    restoreHistoryItem,
    clearHistoryNow: () => {
      historyStore.clear();
      renderHistory();
    },
    handleCopy,
    getStatus: () => (statusText ? statusText.textContent : ""),
    setStatus,
    setGlobalStatus,
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

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
  const webSearchToggle = document.querySelector("#webSearchToggle");
  const searchSourcesNode = document.querySelector("#searchSources");
  const searchProcessNode = document.querySelector("#searchProcess");
  const globalStatusText = document.querySelector("#globalStatusText");
  const opportunityStats = document.querySelector("#opportunityStats");
  const opportunityList = document.querySelector("#opportunityList");
  const opportunityEmpty = document.querySelector("#opportunityEmpty");
  const opportunityStatus = document.querySelector("#opportunityStatus");
  const addOpportunityButton = document.querySelector("#addOpportunityButton");
  const addOpportunityContainer = document.querySelector("#addOpportunityContainer");

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
      answerLoading,
      webSearchToggle,
      searchSources: searchSourcesNode,
      searchProcess: searchProcessNode,
      globalStatusText,
      opportunityStats,
      opportunityList,
      opportunityEmpty,
      opportunityStatus,
      addOpportunityButton,
      addOpportunityContainer
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
  translateInternalTermsClient,
  createApp,
  renderMarkdown,
  escapeHtml,
  applyInlineMarkdown,
  // V0.3.6 搜索来源展示
  renderSearchSources,
  renderSearchProcess,
  renderOpportunityPanel,
  isSafeExternalUrl,
  // V0.3.10 机会池中文化 + chips + 一键加入
  buildAddOpportunityFormMarkup,
  normalizeOpportunityForUi,
  getDisplayTitleClient,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_SCORE_LABELS,
  OPPORTUNITY_TITLE_OVERRIDES,
  PRESET_TAGS
};
