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
  return {
    ...raw,
    id: String(raw.id || ""),
    opportunityName: String(raw.opportunityName || raw.title || "未命名机会"),
    status,
    statusLabel: STATUS_LABELS[status],
    humanDecision,
    humanDecisionLabel: HUMAN_DECISION_LABELS[humanDecision],
    notes: String(raw.notes || raw.note || ""),
    tags: normalizeTags(raw.tags),
    updatedAt: raw.updatedAt || ""
  };
}

function stripUiFields(item) {
  const { statusLabel, humanDecisionLabel, ...rest } = item && typeof item === "object" ? item : {};
  return rest;
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
  if (body.archived === true) patch.status = "archived";
  if (body.note != null || body.notes != null) patch.notes = String(body.notes ?? body.note).slice(0, 3000);
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
  buildPatch,
  loadOpportunityPool,
  normalizeOpportunity,
  saveOpportunityPool,
  summarizeOpportunities,
  updateOpportunity
};
