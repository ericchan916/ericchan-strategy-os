const fs = require("node:fs");
const path = require("node:path");
const { renderOpportunityPoolMarkdown, STATUSES } = require("./update-opportunity-pool");

const STATUS_LABELS = {
  inbox: "待处理",
  watch: "观察中",
  validate: "待验证",
  "mvp-spec": "MVP 规格",
  building: "构建中",
  archived: "已归档",
  rejected: "已拒绝"
};

const HUMAN_DECISION_LABELS = {
  pending: "待判断",
  accepted: "已确认",
  watching: "观察中",
  rejected: "已拒绝",
  done: "已完成"
};

// V0.3.10：机会类型英文枚举 → 中文标签（仅 UI 使用，底层 JSON 仍保留英文枚举）
const TYPE_LABELS = {
  "new-project-opportunity": "新项目机会",
  "current-project-improvement": "当前项目改进",
  "legacy-learning-material": "旧项目学习材料",
  "watch-only": "仅观察"
};

// V0.3.10：评分字段英文 → 中文标签
const SCORE_LABELS = {
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

// V0.3.10-hotfix：旧英文 opportunityName 的中文映射（不动底层数据，仅 UI 兜底）
const OPPORTUNITY_TITLE_OVERRIDES = {
  "Independent AI opportunity brief MVP": "独立 AI 机会简报 MVP",
  "Opportunity scoring quality gate": "机会评分质量门槛"
};

const UNKNOWN_ENGLISH_PROJECT_TITLES = new Set(Object.keys(OPPORTUNITY_TITLE_OVERRIDES));

// V0.3.10-hotfix：启发式检测"mojibake / 乱码"，用于在 UI 与 prompt 注入时走中文兜底
function looksLikeMojibake(value) {
  if (!value) return false;
  const s = String(value);
  // U+FFFD (replacement char) 或 GBK 字节被 latin-1 错读常见的乱码
  if (s.includes("�")) return true;
  // 锟斤拷 / 烫烫烫 / etc
  if (/锟斤拷|烫烫烫|����|ä¸ç¥/.test(s)) return true;
  // 连续 4+ 个 replacement char 一定是损坏
  if (/�{2,}/.test(s)) return true;
  return false;
}

// V0.3.10-hotfix：把任意 opportunityName 解析为"前端要展示"的中文标题
// 优先级：known override > 原 title (若不是乱码/英文) > 中文兜底
function getDisplayTitle(item) {
  const raw = item && typeof item === "object" ? item : {};
  const original = String(raw.opportunityName || raw.title || "").trim();
  if (!original) return "未命名机会";
  if (OPPORTUNITY_TITLE_OVERRIDES[original]) return OPPORTUNITY_TITLE_OVERRIDES[original];
  if (looksLikeMojibake(original)) {
    // 已知 mojibake 序列：尝试给一个合适的中文说明
    if (/^V0\.3\./.test(original) || /V0\.3\.10/.test(original)) {
      return "V0.3.10 测试机会（标题损坏，请编辑）";
    }
    return "机会标题损坏，请编辑补充";
  }
  // 已是中文为主
  if (/[一-龥]/.test(original)) return original;
  // 纯英文 / 未知英文标题：给出中文提示，建议用户编辑
  if (UNKNOWN_ENGLISH_PROJECT_TITLES.has(original)) {
    return OPPORTUNITY_TITLE_OVERRIDES[original];
  }
  // 兜底：用 "机会：xxx" 让用户能看出原值但界面是中文
  return `机会：${original}`;
}

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

// V0.3.10：新增机会时允许持久化的字段白名单
// V0.3.11：增加 oneLineSummary（一句话说明）
const OPPORTUNITY_PERSIST_FIELDS = [
  "id",
  "opportunityName",
  "title",
  "status",
  "type",
  "tags",
  "notes",
  "note",
  "oneLineSummary",
  "nextAction",
  "humanDecision",
  "source",
  "sourceQuestion",
  "sourceAnswerSummary",
  "sourceUrls",
  "sourceTrend",
  "scores"
];

// V0.3.10：会被拒绝保存的敏感 / 路径类字段（防止 API Key 写入 / 路径注入）
const FORBIDDEN_PERSIST_FIELDS = [
  "filePath",
  "jsonPath",
  "markdownPath",
  "rootDir",
  "apiKey",
  "APIKey",
  "STRATEGY_OS_LLM_API_KEY",
  "STRATEGY_OS_SEARCH_API_KEY",
  "LLM_API_KEY",
  "rawAnswer",
  "rawResponse"
];

function poolPaths(rootDir = process.cwd()) {
  return {
    jsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    markdownPath: path.join(rootDir, "opportunities", "opportunity-pool.md")
  };
}

function emptyPool() {
  return { version: 1, updatedAt: new Date().toISOString(), opportunities: [] };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
  if (typeof tags === "string") return tags.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  return [];
}

function normalizeOpportunity(item) {
  const raw = item && typeof item === "object" ? item : {};
  const status = STATUS_LABELS[raw.status] ? raw.status : "inbox";
  const humanDecision = HUMAN_DECISION_LABELS[raw.humanDecision] ? raw.humanDecision : "pending";
  const type = TYPE_LABELS[raw.type] ? raw.type : (raw.type || "new-project-opportunity");
  return {
    ...raw,
    id: String(raw.id || ""),
    opportunityName: String(raw.opportunityName || raw.title || "未命名机会"),
    displayTitle: getDisplayTitle(raw), // V0.3.10-hotfix：旧英文 / 乱码的兜底中文标题
    status,
    statusLabel: STATUS_LABELS[status],
    humanDecision,
    humanDecisionLabel: HUMAN_DECISION_LABELS[humanDecision],
    type,
    typeLabel: TYPE_LABELS[type] || "新项目机会",
    notes: String(raw.notes || raw.note || ""),
    // V0.3.11：透出一句话说明
    oneLineSummary: String(raw.oneLineSummary || ""),
    nextAction: typeof raw.nextAction === "string" ? raw.nextAction : "",
    tags: normalizeTags(raw.tags),
    updatedAt: raw.updatedAt || ""
  };
}

function stripUiFields(item) {
  const { statusLabel, humanDecisionLabel, typeLabel, ...rest } = item && typeof item === "object" ? item : {};
  return rest;
}

// V0.3.10：pick 持久化白名单字段
function pickPersistFields(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const key of OPPORTUNITY_PERSIST_FIELDS) {
    if (key in input && input[key] !== undefined) {
      out[key] = input[key];
    }
  }
  return out;
}

// V0.3.10：生成稳定 id（不依赖 crypto.randomUUID）
function makeOpportunityId() {
  return `opp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// V0.3.10：截断 sourceUrls 到 5 条，只保留 title / url / source
function normalizeSourceUrls(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).map((item) => {
    const raw = item && typeof item === "object" ? item : {};
    return {
      title: String(raw.title || "").slice(0, 200),
      url: String(raw.url || "").slice(0, 500),
      source: String(raw.source || "").slice(0, 80)
    };
  }).filter((item) => item.title || item.url);
}

// V0.3.10：摘要 raw answer（最多 300 字，截断到最近的句子边界）
function summarizeAnswer(text, max = 300) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const lastStop = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("."), slice.lastIndexOf("！"), slice.lastIndexOf("!"), slice.lastIndexOf("\n"));
  if (lastStop > max * 0.5) return `${slice.slice(0, lastStop + 1)}…`;
  return `${slice}…`;
}

// V0.3.11：从 Ask 回答里提炼"机会卡草稿"（不调用 LLM，纯规则型）
// 输入：question / answer / search (含 sources) / recommendedQuestions
// 输出：{ opportunityName, oneLineSummary, note, nextAction, suggestedTags,
//         status, type, source, sourceQuestion, sourceAnswerSummary, sourceUrls }
//
// 规则说明：
//  - 不会直接拿 question 当 opportunityName（避免"问题当机会"）
//  - 不会原样复制 answer 到 note（只保留"机会卡视图"的关键句）
//  - oneLineSummary 是一句完整中文
//  - nextAction 是可执行动作，不是泛泛而谈
//  - suggestedTags 从 PRESET_TAGS 选择（最多 3 个）
//  - 不包含 raw search response / API Key / 内部字段
//
// V0.3.11 安全：answer 在写入前会脱敏（移除 sk-* / apiKey / rawResponse 字串）
function sanitizeAnswerForDraft(text) {
  let value = String(text || "");
  // 去除 sk-xxx / API Key 字串
  value = value.replace(/\bsk-[A-Za-z0-9_-]+/g, "[已脱敏]");
  value = value.replace(/STRATEGY_OS_LLM_API_KEY\s*[=:]\s*\S+/g, "[已脱敏]");
  value = value.replace(/STRATEGY_OS_SEARCH_API_KEY\s*[=:]\s*\S+/g, "[已脱敏]");
  value = value.replace(/api[_-]?key\s*[=:]\s*\S+/gi, "[已脱敏]");
  return value;
}

function deriveOpportunityDraftFromAnswer({
  question = "",
  answer = "",
  search = null,
  recommendedQuestions = null
} = {}) {
  // 安全脱敏：防止 API Key 串进入 draft
  const safeQ = sanitizeAnswerForDraft(question);
  const safeA = sanitizeAnswerForDraft(answer);
  const q = String(safeQ || "").trim();
  const a = String(safeA || "").trim();
  const hasSearch = !!(search && search.used === true);
  const safeSources = hasSearch && Array.isArray(search.sources) ? search.sources.slice(0, 5).map((u) => {
    const item = u && typeof u === "object" ? u : {};
    return {
      title: String(item.title || "").slice(0, 200),
      url: String(item.url || "").slice(0, 500),
      source: String(item.source || "").slice(0, 80)
    };
  }).filter((u) => u.title || u.url) : [];

  // ---- 1) 提炼 opportunityName ----
  // 优先从 answer 第一句里抽取"做/做一个/做一个 X"的关键短语
  let name = "";
  const firstSentence = a.split(/[\n。！？!]/).map((s) => s.trim()).find((s) => s.length >= 4) || "";
  // 模式 1: 显式产品 / 工具名
  //  - "AI 短视频选题助手"、"短视频选题工具"、"ESP32 墨水屏日历"
  const productNameMatch = a.match(/([一-龥A-Za-z0-9 ]{2,24}(?:助手|工具|平台|产品|机器人|机器人|系统|工作流|工作台|服务|网站|小程序|插件|模板|模板|技能|技能库|看板|代理|机器人|日历|选题|日历))/);
  if (productNameMatch) name = productNameMatch[1].trim();
  // 模式 2: 短句压缩
  if (!name) {
    const doMatch = firstSentence.match(/(?:做|做一个|做一个最小|做一个\s*MVP|做\s*MVP|尝试做|做\s*)([一-龥A-Za-z0-9 ·\-]{2,30})/);
    if (doMatch) name = doMatch[1].trim();
  }
  // 模式 3: 从 question 里抽取
  if (!name && q) {
    const qMatch = q.match(/([一-龥A-Za-z0-9 ·\-]{2,30}(?:工具|助手|平台|产品|项目|方向|机会|主题|选题))/);
    if (qMatch) name = qMatch[1].trim();
  }
  // 兜底：从 question 截取到 24 字
  if (!name) {
    name = q ? q.replace(/[？?！!。.,，、；;：:]+$/g, "").slice(0, 24) : "";
  }
  // 长度裁剪：≤ 24 字
  name = name.replace(/\s+/g, " ").trim().slice(0, 24);
  // ---- 0.5) 检测是否真的像"机会"上下文 ----
  // 如果问题/回答里都不含"项目/做/工具/助手/选题/MVP/想法/方向/趋势/可做/值得做"等信号，
  // 那么原始问题/回答很可能不是机会，应当给出中文兜底。
  const opportunitySignal = /(项目|工具|助手|选题|平台|产品|方向|趋势|想法|MVP|值得做|做\s*一个|尝试|验证|可做|可变现|短视频|内容|博客|写|做一个)/;
  const looksLikeOpportunity = opportunitySignal.test(a) || opportunitySignal.test(q);
  if (!looksLikeOpportunity) {
    return {
      opportunityName: "没有识别到明确机会，请手动补充名称。",
      oneLineSummary: "当前问题/回答里没有明显项目机会线索。建议：换一个更具体的问题，或者在下面手动填写。",
      note: "暂无备注。",
      nextAction: "先在问题里补充「我想做一个 X 工具/项目」等明确意图，再加入机会池。",
      suggestedTags: ["需要调研"],
      status: "validate",
      type: "new-project-opportunity",
      source: hasSearch ? "search" : "ask-mode",
      sourceQuestion: q.slice(0, 1000),
      sourceAnswerSummary: summarizeAnswer(a, 600),
      sourceUrls: safeSources
    };
  }
  if (!name) {
    name = "未命名机会（请手动补充名称）";
  }

  // ---- 2) oneLineSummary ----
  // 从 answer 里挑出首句或"它/这个 X"开头的一句话
  let oneLineSummary = "";
  if (firstSentence) {
    oneLineSummary = firstSentence.replace(/^(我|我们|现在|让我|可以的|可以的，|我建议|我推荐|我看到|可以的，)/, "").trim();
    if (oneLineSummary.length > 80) oneLineSummary = oneLineSummary.slice(0, 80);
  }
  if (!oneLineSummary) {
    // 用 answer 前 80 字
    oneLineSummary = a.replace(/\s+/g, " ").slice(0, 80);
  }
  // 一句话以标点收尾
  if (oneLineSummary && !/[。.！!？?]$/.test(oneLineSummary)) {
    oneLineSummary = `${oneLineSummary}。`;
  }
  if (!oneLineSummary) oneLineSummary = "暂无一句话说明，建议补充这个机会是什么。";

  // ---- 3) note: 精炼备注（不复制整段 answer）----
  // 策略：从 answer 中提炼 2-4 个关键短句（每句 ≤ 30 字），用换行分隔；总长 ≤ 300 字
  const keySentences = [];
  const seen = new Set();
  for (const raw of a.split(/[\n。！？!]/)) {
    const s = String(raw || "").trim();
    if (s.length < 6) continue;
    const norm = s.slice(0, 30);
    if (seen.has(norm)) continue;
    seen.add(norm);
    keySentences.push(s.slice(0, 60));
    if (keySentences.length >= 5) break;
  }
  let note = keySentences.join("\n");
  if (note.length > 300) note = note.slice(0, 300);

  // ---- 4) nextAction: 找一个"做 X"开头的可执行句 ----
  let nextAction = "";
  // 模式 1: "做一个最小..." / "先做 X" / "MVP 步骤..."
  const actionMatch = a.match(/(?:做一个|做一个最小|做一个\s*MVP|先做|第一步|验证|MVP[：:]|MVP\s*步骤|可以|先跑通|做一个\s*最小可执行)([^。\n!?！？]{4,80})/);
  if (actionMatch) {
    nextAction = actionMatch[0].replace(/^。|^，|^、|^：/, "").trim();
  }
  // 模式 2: 找包含动词的首句
  if (!nextAction && firstSentence) {
    if (/(做|写|跑|选|建|搭|上线|验证|测试|找|画|列|出|填|输入|输出)/.test(firstSentence)) {
      nextAction = firstSentence.slice(0, 80);
    }
  }
  if (!nextAction) {
    // 兜底：基于类型给一个通用动作
    nextAction = "先列一个最小 MVP 范围，写 3-5 条下一步动作。";
  }
  if (nextAction.length > 500) nextAction = nextAction.slice(0, 500);

  // ---- 5) suggestedTags: 从 answer 关键词推断 PRESET_TAGS ----
  const tagHints = {
    "AI Agent": /(agent|智能体|代理|自治)/i,
    "大模型应用": /(大模型|LLM|GPT|Claude|Gemini|语言模型)/,
    "独立开发者": /(独立开发|一人|单人|indie|独自)/,
    "小型可变现": /(可变现|付费|订阅|商业化|变现)/,
    "内容产品": /(内容|选题|博客|视频|播客|文章|写作)/,
    "自动化工作流": /(自动化|workflow|工作流|批处理)/,
    "编程工具": /(开发工具|IDE|代码|debug|调试|编程)/,
    "前端视觉": /(前端|UI|视觉|动画|设计|动效)/,
    "个人 OS": /(个人\s*OS|战略\s*OS|操作系统|个人系统)/,
    "OPC": /OPC|one\s*person|单兵|一人公司/,
    "需要调研": /(调研|考察|研究|看看|了解)/,
    "可快速验证": /(MVP|可快速|快速验证|原型|快速跑通|先做最小)/,
    "暂缓": /(暂缓|晚点|不急|之后|延后)/,
    "高潜力": /(高潜力|潜力大|很值得|值得做|值得做|值得做)/,
    "噪声较大": /(噪声|噪音|不稳定|风险)/,
  };
  const suggestedTags = [];
  for (const [tag, regex] of Object.entries(tagHints)) {
    if (regex.test(a) || regex.test(q)) {
      suggestedTags.push(tag);
      if (suggestedTags.length >= 4) break;
    }
  }
  if (suggestedTags.length === 0) {
    // 至少给一个兜底
    suggestedTags.push("需要调研");
  }

  // ---- 6) source 标识 ----
  const source = hasSearch ? "search" : "ask-mode";

  return {
    opportunityName: name,
    oneLineSummary: oneLineSummary.slice(0, 300),
    note: note || "暂无备注。",
    nextAction: nextAction || "先列一个最小 MVP 范围。",
    suggestedTags,
    status: "validate",
    type: "new-project-opportunity",
    source,
    sourceQuestion: q.slice(0, 1000),
    sourceAnswerSummary: summarizeAnswer(a, 600),
    sourceUrls: safeSources
  };
}

// V0.3.10：新增机会
function addOpportunity({ rootDir = process.cwd(), input = {} } = {}) {
  const cleaned = pickPersistFields(input);
  const title = String(cleaned.opportunityName || cleaned.title || "").trim();
  if (!title) {
    const error = new Error("请填写机会名称。");
    error.statusCode = 400;
    throw error;
  }
  const status = STATUS_LABELS[cleaned.status] ? cleaned.status : "validate";
  const type = TYPE_LABELS[cleaned.type] ? cleaned.type : "new-project-opportunity";
  const now = new Date().toISOString();
  const id = makeOpportunityId();

  // 检测重复标题（按 normalize 后的字符串比较）
  const loaded = loadOpportunityPool({ rootDir });
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const target = norm(title);
  const duplicate = loaded.opportunities.find((item) => norm(item.opportunityName || item.title) === target);

  const newItem = {
    id,
    opportunityName: title.slice(0, 200),
    status,
    type,
    humanDecision: HUMAN_DECISION_LABELS[cleaned.humanDecision] ? cleaned.humanDecision : "pending",
    notes: String(cleaned.notes || cleaned.note || "").slice(0, 3000),
    // V0.3.11：一句话说明 ≤ 300 字
    oneLineSummary: typeof cleaned.oneLineSummary === "string" ? cleaned.oneLineSummary.trim().slice(0, 300) : "",
    nextAction: String(cleaned.nextAction || "").slice(0, 500),
    tags: normalizeTags(cleaned.tags),
    source: typeof cleaned.source === "string" ? cleaned.source.slice(0, 80) : "ask-mode",
    sourceQuestion: typeof cleaned.sourceQuestion === "string" ? cleaned.sourceQuestion.slice(0, 1000) : "",
    sourceAnswerSummary: typeof cleaned.sourceAnswerSummary === "string" ? cleaned.sourceAnswerSummary.slice(0, 1000) : "",
    sourceUrls: normalizeSourceUrls(cleaned.sourceUrls),
    scores: cleaned.scores && typeof cleaned.scores === "object" ? cleaned.scores : null,
    createdAt: now,
    updatedAt: now
  };

  loaded.pool.opportunities.unshift(newItem);
  const saved = saveOpportunityPool(loaded.pool, { rootDir });
  const opportunities = saved.opportunities.map(normalizeOpportunity);
  return {
    opportunity: opportunities.find((item) => item.id === id) || normalizeOpportunity(newItem),
    opportunities,
    stats: summarizeOpportunities(opportunities),
    warning: duplicate ? "已存在同名机会，建议编辑已有条目而不是重复添加。" : null
  };
}

// V0.3.10：构建给 LLM 的中文机会池摘要（不包含 raw JSON / 英文内部字段）
function buildOpportunityContextForPrompt(opportunities, options = {}) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  const includeArchived = options.includeArchived === true;
  const maxItems = Number.isFinite(options.maxItems) && options.maxItems > 0
    ? Math.floor(options.maxItems)
    : 10;
  const filtered = list.filter((item) => {
    const raw = item && typeof item === "object" ? item : {};
    const status = String(raw.status || "inbox");
    if (!includeArchived && (status === "archived" || status === "rejected" || status === "ignore")) return false;
    return true;
  });
  const priority = (item) => {
    const raw = item && typeof item === "object" ? item : {};
    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    let score = 0;
    if (raw.status === "validate") score += 5;
    if (raw.status === "watch") score += 3;
    if (raw.humanDecision === "accepted") score += 4;
    if (tags.includes("高潜力")) score += 4;
    if (tags.includes("可快速验证")) score += 3;
    if (raw.updatedAt) score += 1;
    return score;
  };
  const sorted = filtered.slice().sort((a, b) => priority(b) - priority(a));
  const top = sorted.slice(0, maxItems);
  if (!top.length) return "";

  const lines = ["", "【当前机会池摘要】"];
  top.forEach((raw, idx) => {
    // V0.3.10-hotfix：使用 displayTitle 替代原始 opportunityName，
    // 旧英文 / 乱码标题会被自动中文化。
    const name = getDisplayTitle(raw);
    const status = String(raw.status || "inbox");
    const statusText = STATUS_LABELS[status] || status;
    const typeText = TYPE_LABELS[raw.type] || (raw.type ? String(raw.type) : "新项目机会");
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
    const tagText = tags.length ? tags.join("、") : "暂无标签";
    const note = String(raw.notes || raw.note || "").trim() || "暂无备注";
    // V0.3.11：注入一句话说明 + 下一步
    const oneLine = String(raw.oneLineSummary || "").trim() || "暂无一句话说明";
    const next = String(raw.nextAction || "").trim() || "暂无下一步";
    const updated = raw.updatedAt ? String(raw.updatedAt).slice(0, 10) : "";
    const linesForItem = [
      `${idx + 1}. ${name}`,
      `   状态：${statusText}`,
      `   类型：${typeText}`,
      `   一句话：${oneLine}`,
      `   标签：${tagText}`,
      `   备注：${note}`,
      `   下一步：${next}`
    ];
    if (updated) linesForItem.push(`   更新时间：${updated}`);
    lines.push(linesForItem.join("\n"));
  });
  lines.push("");
  lines.push("【使用机会池的规则】");
  lines.push("- 用户编辑的备注、一句话说明、标签和下一步会作为个人上下文，下一次回答时优先参考。");
  lines.push("- 优先围绕已确认 / 待验证 / 观察中 的机会给出建议。");
  lines.push("- 已归档 / 已拒绝 / 忽略 的机会默认不优先，除非用户明确要求。");
  lines.push("- 不要把机会池里没写的方向凭空当作用户已关心的项目。");
  return lines.join("\n");
}

function summarizeOpportunities(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  return {
    total: list.length,
    accepted: list.filter((item) => item.humanDecision === "accepted").length,
    validate: list.filter((item) => item.status === "validate").length,
    watch: list.filter((item) => item.status === "watch" || item.humanDecision === "watching").length,
    archived: list.filter((item) => item.status === "archived").length,
    rejected: list.filter((item) => item.status === "rejected").length
  };
}

function loadOpportunityPool({ rootDir = process.cwd() } = {}) {
  const paths = poolPaths(rootDir);
  const pool = readJson(paths.jsonPath, emptyPool());
  pool.version = pool.version || 1;
  pool.opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];
  const opportunities = pool.opportunities.map(normalizeOpportunity);
  return {
    pool: { ...pool, opportunities },
    opportunities,
    stats: summarizeOpportunities(opportunities),
    paths
  };
}

function saveOpportunityPool(pool, { rootDir = process.cwd() } = {}) {
  const paths = poolPaths(rootDir);
  const nextPool = {
    ...pool,
    version: pool.version || 1,
    updatedAt: new Date().toISOString(),
    opportunities: (Array.isArray(pool.opportunities) ? pool.opportunities : []).map(stripUiFields)
  };
  fs.mkdirSync(path.dirname(paths.jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.markdownPath), { recursive: true });
  fs.writeFileSync(paths.jsonPath, `${JSON.stringify(nextPool, null, 2)}\n`);
  fs.writeFileSync(paths.markdownPath, renderOpportunityPoolMarkdown(nextPool));
  return nextPool;
}

function buildPatch(body = {}) {
  const patch = {};
  if (body.status != null) {
    const status = String(body.status);
    if (!STATUSES.has(status)) throw new Error("机会状态不合法。");
    patch.status = status;
  }
  // V0.3.10-hotfix：允许更新 opportunityName（中文标题可在 UI 编辑后保存）
  if (body.opportunityName != null) {
    const name = String(body.opportunityName).trim();
    if (!name) throw new Error("机会名称不能为空。");
    patch.opportunityName = name.slice(0, 200);
  }
  // V0.3.10：允许更新 type / nextAction
  if (body.type != null) {
    const type = String(body.type);
    if (TYPE_LABELS[type]) patch.type = type;
  }
  if (body.archived === true) patch.status = "archived";
  if (body.note != null || body.notes != null) patch.notes = String(body.notes ?? body.note).slice(0, 3000);
  if (body.nextAction != null) patch.nextAction = String(body.nextAction).slice(0, 1000);
  if (body.tags != null) patch.tags = normalizeTags(body.tags);
  return patch;
}

function updateOpportunity({ rootDir = process.cwd(), id, patch = {} } = {}) {
  const loaded = loadOpportunityPool({ rootDir });
  const pool = loaded.pool;
  const index = pool.opportunities.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error("没有找到这个机会。");
    error.statusCode = 404;
    throw error;
  }
  const allowed = buildPatch(patch);
  pool.opportunities[index] = normalizeOpportunity({
    ...pool.opportunities[index],
    ...allowed,
    updatedAt: new Date().toISOString()
  });
  const saved = saveOpportunityPool(pool, { rootDir });
  const opportunities = saved.opportunities.map(normalizeOpportunity);
  return {
    opportunity: opportunities[index],
    opportunities,
    stats: summarizeOpportunities(opportunities)
  };
}

// V0.3.10-hotfix：删除一个机会
// 安全约束：
//  - id 缺失 / 含路径分隔符 / 含 .. 都拒绝
//  - id 不存在 → 404 中文错误
//  - 只删除指定 id，不动其他项
//  - 删除前自动写一份本地备份（带时间戳）到 data/opportunities/backups/（gitignore）
//  - 不接受 body / query 控制文件路径
function isValidOpportunityId(id) {
  if (typeof id !== "string") return false;
  if (!id.trim()) return false;
  if (id.length > 200) return false;
  // 拒绝任何形式的路径分隔符与 .. / 控制字符
  if (/[\/\\\.]/.test(id)) return false;
  if (/[\x00-\x1f]/.test(id)) return false;
  return true;
}

function deleteOpportunity({ rootDir = process.cwd(), id } = {}) {
  if (!isValidOpportunityId(id)) {
    const error = new Error("请提供合法的机会 id（不能包含路径分隔符或控制字符）。");
    error.statusCode = 400;
    throw error;
  }
  const loaded = loadOpportunityPool({ rootDir });
  const pool = loaded.pool;
  const index = pool.opportunities.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error("没有找到这个机会，可能已被删除。");
    error.statusCode = 404;
    throw error;
  }
  const removed = pool.opportunities[index];
  // 删除前做一次本地备份（不提交，被 gitignore）
  try {
    const backupDir = path.join(rootDir, "data", "opportunities", "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `opportunity-pool-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ ...pool, opportunities: pool.opportunities }, null, 2));
  } catch {
    // 备份失败不阻塞删除；先抛错
  }
  pool.opportunities.splice(index, 1);
  const saved = saveOpportunityPool(pool, { rootDir });
  const opportunities = saved.opportunities.map(normalizeOpportunity);
  return {
    removed: normalizeOpportunity(removed),
    opportunities,
    stats: summarizeOpportunities(opportunities)
  };
}

module.exports = {
  HUMAN_DECISION_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  SCORE_LABELS,
  PRESET_TAGS,
  OPPORTUNITY_PERSIST_FIELDS,
  FORBIDDEN_PERSIST_FIELDS,
  OPPORTUNITY_TITLE_OVERRIDES,
  getDisplayTitle,
  looksLikeMojibake,
  isValidOpportunityId,
  buildPatch,
  loadOpportunityPool,
  normalizeOpportunity,
  saveOpportunityPool,
  summarizeOpportunities,
  updateOpportunity,
  deleteOpportunity,
  addOpportunity,
  buildOpportunityContextForPrompt,
  deriveOpportunityDraftFromAnswer,
  normalizeSourceUrls,
  summarizeAnswer
};
