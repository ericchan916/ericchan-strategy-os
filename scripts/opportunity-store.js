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
const OPPORTUNITY_PERSIST_FIELDS = [
  "id",
  "opportunityName",
  "title",
  "status",
  "type",
  "tags",
  "notes",
  "note",
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
    status,
    statusLabel: STATUS_LABELS[status],
    humanDecision,
    humanDecisionLabel: HUMAN_DECISION_LABELS[humanDecision],
    type,
    typeLabel: TYPE_LABELS[type] || "新项目机会",
    notes: String(raw.notes || raw.note || ""),
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
    nextAction: String(cleaned.nextAction || "").slice(0, 1000),
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
    const name = String(raw.opportunityName || raw.title || "未命名机会").trim() || "未命名机会";
    const status = String(raw.status || "inbox");
    const statusText = STATUS_LABELS[status] || status;
    const typeText = TYPE_LABELS[raw.type] || (raw.type ? String(raw.type) : "新项目机会");
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
    const tagText = tags.length ? tags.join("、") : "暂无标签";
    const note = String(raw.notes || raw.note || "").trim() || "暂无备注";
    const next = String(raw.nextAction || "").trim() || "暂无下一步";
    const updated = raw.updatedAt ? String(raw.updatedAt).slice(0, 10) : "";
    const linesForItem = [
      `${idx + 1}. ${name}`,
      `   状态：${statusText}`,
      `   类型：${typeText}`,
      `   标签：${tagText}`,
      `   备注：${note}`,
      `   下一步：${next}`
    ];
    if (updated) linesForItem.push(`   更新时间：${updated}`);
    lines.push(linesForItem.join("\n"));
  });
  lines.push("");
  lines.push("【使用机会池的规则】");
  lines.push("- 用户编辑的备注和标签会作为个人上下文，下一次回答时优先参考。");
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

module.exports = {
  HUMAN_DECISION_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  SCORE_LABELS,
  PRESET_TAGS,
  OPPORTUNITY_PERSIST_FIELDS,
  FORBIDDEN_PERSIST_FIELDS,
  buildPatch,
  loadOpportunityPool,
  normalizeOpportunity,
  saveOpportunityPool,
  summarizeOpportunities,
  updateOpportunity,
  addOpportunity,
  buildOpportunityContextForPrompt,
  normalizeSourceUrls,
  summarizeAnswer
};
