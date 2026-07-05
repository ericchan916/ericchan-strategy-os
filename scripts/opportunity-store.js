const fs = require("node:fs");
const path = require("node:path");
const { renderOpportunityPoolMarkdown, STATUSES } = require("./update-opportunity-pool");
const { redactSecretLikeText } = require("./secret-redact");

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
  const { displayTitle, statusLabel, humanDecisionLabel, typeLabel, goalMatch, todayPriority, priorityReason, isTodayPriority, ...rest } = item && typeof item === "object" ? item : {};
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

// V0.3.11-hotfix：判断 question 是否为"机会问题"
const OPPORTUNITY_QUESTION_HINTS = /(做|做一个|想|试试|尝试|值得|能不能|想做一个|做点|做一个\s*X|做一个.*工具|做一个.*助手|做一个.*平台|做一个.*产品|做.*MVP|做.*验证|新项目|新机会|新方向|新工具|新流程|机会池|试试|先做|做一下|方向|建议)/;

// V0.3.11-hotfix：产品名后缀白名单
const PRODUCT_NAME_SUFFIXES = [
  "助手", "工具", "平台", "雷达", "简报", "看板", "生成器", "工作流", "日历", "模板",
  "系统", "OS", "插件", "插件库", "bot", "Bot", "agent", "Agent",
  "MVP", "小工具", "选题器", "分析器", "检查器", "体检器", "生成机", "适配器", "调度器",
  "小助手", "评分", "日报", "评估器", "解释器", "翻译器", "转写器"
];

// V0.3.11-hotfix：剥离无意义前缀（前缀 / 介词 / 句首套话）
const NAME_PREFIXES_TO_STRIP = [
  "我建议你先", "我建议你", "我建议", "建议你先", "建议你", "建议先",
  "可以先", "可以试着", "适合做", "适合先", "可以做", "可以做一个",
  "做一个面向", "做一个适合", "面向", "适合",
  "做一个", "做一个最小", "做一个最小可行", "做一个最小可执行",
  "先做一个", "试做一个", "可以试试做一个",
  "今天可以", "当前可以", "最近可以",
  "我看到", "我认为", "我的建议是", "我的建议",
  "答案是", "结论是", "建议是",
  "你可以", "你能", "请"
];

// V0.3.11-hotfix：判断 question 是不是疑问句 / 搜索请求句
function isQuestionishQuestion(text) {
  if (!text) return false;
  const t = String(text);
  // 1) 以问号结尾
  if (/[？?]\s*$/.test(t)) return true;
  // 2) 含疑问词
  if (/(最近有什么|有什么|有没有|怎么|为什么|如何|是不是|能否|哪些|哪些是)/.test(t)) return true;
  // 3) 是请求/搜索句
  if (/(帮我|给我|给我点|请帮我|我想知道|我想了解|我想看|推荐下|推荐一些)/.test(t)) return true;
  return false;
}

// V0.3.11-hotfix：从文本中抽取产品名（更严格的递归剥离）
function extractProductNameFromText(text) {
  if (!text) return "";
  let t = String(text).trim();
  // 1) 找所有候选（含产品后缀的最长短语）
  const suffixPattern = PRODUCT_NAME_SUFFIXES.map(escapeRegex).join("|");
  // 候选匹配："X 助手 / X 工具 / X Agent" 等；X 至少含 1 个中文字符
  const candidateRegex = new RegExp(`([一-龥A-Za-z0-9 ·\\-_]{1,20}(?:${suffixPattern}))`, "g");
  const candidates = [];
  let m;
  while ((m = candidateRegex.exec(t)) !== null) {
    const cand = String(m[1] || "").trim();
    if (cand.length < 3) continue;
    candidates.push(cand);
  }
  if (candidates.length === 0) return "";
  // 选最长（更精确的产品名）
  candidates.sort((a, b) => b.length - a.length);
  let best = candidates[0];
  // 2) 剥离前缀
  for (const pfx of NAME_PREFIXES_TO_STRIP) {
    if (best.startsWith(pfx)) {
      best = best.slice(pfx.length).trim();
    }
  }
  // 3) 去掉无意义的"一个"
  if (best.startsWith("一个")) best = best.slice(2).trim();
  if (best.startsWith("一种")) best = best.slice(2).trim();
  // 4) 长度控制
  if (best.length > 24) best = best.slice(0, 24);
  return best.replace(/\s+/g, " ").trim();
}

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeGoalForDraft(currentGoal) {
  const goal = String(redactSecretLikeText(currentGoal || "")).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!goal) return null;
  return {
    text: goal,
    independent: /独立开发|一人|OPC|独立|indie/i.test(goal),
    smallAiProduct: /(小型|轻量|AI|大模型|Agent|工具|产品|MVP)/i.test(goal),
    sevenDayValidation: /(7\s*天|七天|一周|快速验证|可验证|MVP)/i.test(goal)
  };
}

function applyGoalToOpportunityDraft(draft, goalInfo) {
  if (!goalInfo || !draft || typeof draft !== "object" || draft.draftWarning) return draft;
  const next = { ...draft };
  const goalHints = [];
  if (goalInfo.independent && !/独立开发|一人|OPC|indie/i.test(next.oneLineSummary || "")) {
    next.oneLineSummary = `面向独立开发者的${String(next.oneLineSummary || "").replace(/^一个面向独立开发者的/, "")}`;
  }
  if (goalInfo.smallAiProduct) goalHints.push("适合作为小型 AI 产品方向评估");
  if (goalInfo.sevenDayValidation) goalHints.push("下一步应压到 7 天内可验证");
  if (goalHints.length) {
    const hint = `Goal 匹配：${goalHints.join("，")}。`;
    if (!String(next.note || "").includes("Goal 匹配")) {
      next.note = `${String(next.note || "").trim()}\n${hint}`.trim().slice(0, 300);
    }
  }
  if (goalInfo.sevenDayValidation && !/(7\s*天|七天|一周)/.test(next.nextAction || "")) {
    next.nextAction = `7 天内先完成：${String(next.nextAction || "做一个最小验证动作").replace(/^7\s*天内先完成[:：]\s*/, "")}`.slice(0, 500);
  }
  const tags = Array.isArray(next.suggestedTags) ? [...next.suggestedTags] : [];
  for (const tag of ["独立开发者", "可快速验证"]) {
    if (tags.length < 5 && !tags.includes(tag) && ((tag === "独立开发者" && goalInfo.independent) || (tag === "可快速验证" && goalInfo.sevenDayValidation))) {
      tags.push(tag);
    }
  }
  next.suggestedTags = tags;
  next.oneLineSummary = String(next.oneLineSummary || "").slice(0, 80);
  next.note = String(next.note || "").slice(0, 300);
  next.nextAction = String(next.nextAction || "").slice(0, 500);
  return next;
}

const GOAL_MATCH_LEVELS = {
  high: "高匹配",
  medium: "中匹配",
  low: "低匹配",
  unknown: "未判断"
};

const TODAY_PRIORITY_LABELS = {
  today: "今日优先",
  watch: "可观察",
  later: "暂缓"
};

function opportunitySearchText(item) {
  const raw = item && typeof item === "object" ? item : {};
  const parts = [
    raw.opportunityName,
    raw.displayTitle,
    raw.oneLineSummary,
    raw.notes,
    raw.note,
    raw.nextAction,
    raw.sourceTrend,
    raw.type,
    ...(Array.isArray(raw.tags) ? raw.tags : [])
  ];
  return String(redactSecretLikeText(parts.filter(Boolean).join(" "))).replace(/\s+/g, " ").trim();
}

function goalSignals(currentGoal) {
  const goal = String(redactSecretLikeText(currentGoal || "")).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!goal) return null;
  return {
    text: goal,
    independent: /独立开发|一人|OPC|独立|indie/i.test(goal),
    smallAiProduct: /(小型|轻量|AI|大模型|Agent|智能体|工具|产品|MVP)/i.test(goal),
    sevenDayValidation: /(7\s*天|七天|一周|快速验证|可验证|MVP)/i.test(goal),
    websitePersona: /(个人网站|iPortfolio|小Chan|数字分身|persona|Persona|传记)/i.test(goal),
    noNewProject: /(不优先做新项目|不做新项目|暂不做新项目)/i.test(goal)
  };
}

function deriveGoalMatchForOpportunity(opportunity, currentGoal = "") {
  const goal = goalSignals(currentGoal);
  if (!goal) {
    return {
      goalMatch: GOAL_MATCH_LEVELS.unknown,
      todayPriority: TODAY_PRIORITY_LABELS.watch,
      priorityReason: "设置当前目标后，机会池会判断今日优先级。",
      isTodayPriority: false,
      rankScore: 0
    };
  }

  const item = normalizeOpportunity(opportunity);
  const text = opportunitySearchText(item);
  const hasInfo = !!(item.opportunityName || item.oneLineSummary || item.notes || item.nextAction || item.tags.length);
  if (!hasInfo) {
    return {
      goalMatch: GOAL_MATCH_LEVELS.unknown,
      todayPriority: TODAY_PRIORITY_LABELS.watch,
      priorityReason: "机会信息太少，先补充一句话说明和下一步。",
      isTodayPriority: false,
      rankScore: 0
    };
  }

  const status = String(item.status || "");
  const humanDecision = String(item.humanDecision || "");
  if (status === "archived" || status === "rejected" || humanDecision === "rejected") {
    return {
      goalMatch: GOAL_MATCH_LEVELS.low,
      todayPriority: TODAY_PRIORITY_LABELS.later,
      priorityReason: "已归档或已拒绝，不应作为今日优先项。",
      isTodayPriority: false,
      rankScore: -10
    };
  }

  let score = 0;
  const reasons = [];
  const hasNext = !!String(item.nextAction || "").trim();
  if (hasNext) {
    score += 2;
    reasons.push("下一步清楚");
  }
  if (status === "validate" || status === "watch" || status === "inbox") score += 1;
  if (humanDecision === "accepted" || humanDecision === "watching") score += 1;

  if (goal.independent && /独立开发|一人|OPC|indie/i.test(text)) {
    score += 3;
    reasons.push("符合独立开发者方向");
  }
  if (goal.smallAiProduct && /(AI|大模型|Agent|智能体|工具|产品|MVP|机会简报|自动化)/i.test(text)) {
    score += 3;
    reasons.push("符合小型 AI 产品方向");
  }
  if (goal.sevenDayValidation && /(7\s*天|七天|一周|MVP|快速验证|可快速验证|最小|验证)/i.test(text)) {
    score += 3;
    reasons.push("符合 7 天验证方向");
  }
  if (goal.websitePersona && /(个人网站|iPortfolio|小Chan|数字分身|Persona|persona|传记)/i.test(text)) {
    score += 4;
    reasons.push("贴合数字分身/个人网站沉淀");
  }
  if (goal.noNewProject && (item.type === "new-project-opportunity" || /新项目|MVP|产品|机会/i.test(text))) {
    score -= 4;
    reasons.push("与当前不优先新项目的目标有偏离");
  }

  let goalMatch = GOAL_MATCH_LEVELS.low;
  if (score >= 7 && hasNext) goalMatch = GOAL_MATCH_LEVELS.high;
  else if (score >= 3) goalMatch = GOAL_MATCH_LEVELS.medium;

  const todayCandidate = goalMatch === GOAL_MATCH_LEVELS.high && hasNext;
  const todayPriority = todayCandidate ? TODAY_PRIORITY_LABELS.today : (goalMatch === GOAL_MATCH_LEVELS.low ? TODAY_PRIORITY_LABELS.later : TODAY_PRIORITY_LABELS.watch);
  const priorityReason = reasons.length
    ? reasons.slice(0, 2).join("，") + "。"
    : (goalMatch === GOAL_MATCH_LEVELS.low ? "与当前目标关联较弱，今天不建议优先推进。" : "需要补充更多信息后再判断。");
  return {
    goalMatch,
    todayPriority,
    priorityReason,
    isTodayPriority: todayCandidate,
    rankScore: score
  };
}

function derivePrioritizedOpportunities(opportunities, currentGoal = "") {
  const list = Array.isArray(opportunities) ? opportunities.map((item) => normalizeOpportunity(item)) : [];
  const enriched = list.map((item, index) => ({
    ...item,
    ...deriveGoalMatchForOpportunity(item, currentGoal),
    __priorityIndex: index
  }));
  const todayIds = new Set(
    enriched
      .filter((item) => item.isTodayPriority)
      .sort((a, b) => (b.rankScore - a.rankScore) || (a.__priorityIndex - b.__priorityIndex))
      .slice(0, 2)
      .map((item) => item.id)
  );
  return enriched.map(({ __priorityIndex, rankScore, ...item }) => {
    if (!todayIds.has(item.id)) {
      return item.isTodayPriority
        ? { ...item, todayPriority: TODAY_PRIORITY_LABELS.watch, isTodayPriority: false, priorityReason: "方向匹配，但今日只突出前 1-2 个机会。" }
        : item;
    }
    return item;
  });
}

function deriveOpportunityDraftFromAnswer({
  question = "",
  answer = "",
  search = null,
  recommendedQuestions = null,
  currentGoal = ""
} = {}) {
  // 安全脱敏：防止 API Key 串进入 draft
  const safeQ = sanitizeAnswerForDraft(question);
  const safeA = sanitizeAnswerForDraft(answer);
  const q = String(safeQ || "").trim();
  const a = String(safeA || "").trim();
  const goalInfo = summarizeGoalForDraft(currentGoal);
  const hasSearch = !!(search && search.used === true);
  const safeSources = hasSearch && Array.isArray(search.sources) ? search.sources.slice(0, 5).map((u) => {
    const item = u && typeof u === "object" ? u : {};
    return {
      title: String(item.title || "").slice(0, 200),
      url: String(item.url || "").slice(0, 500),
      source: String(item.source || "").slice(0, 80)
    };
  }).filter((u) => u.title || u.url) : [];

  // ---- 0) 启发式判断 question 类型 ----
  // - question 是疑问句/搜索句/请求句 → 不能直接当机会名
  // - question 不含"做/想/试试/值得/MVP/工具/助手/选题..."等机会信号 → 视为"非机会"
  const looksLikeOpportunity = OPPORTUNITY_QUESTION_HINTS.test(a) || OPPORTUNITY_QUESTION_HINTS.test(q);
  const questionIsQuestionish = isQuestionishQuestion(q);

  // 拆句辅助
  const splitSentences = (text) => String(text || "")
    .split(/[\n。！？!?]/)
    .map((s) => String(s || "").trim())
    .filter((s) => s.length >= 4);

  // ---- 1) 提炼 opportunityName ----
  // 策略：从 answer 中抽取产品名（带后缀），失败再尝试从 question 抽取，
  // 最后从 answer 第一句中按动词短语提取。**绝不**直接拿 question 当 opportunityName。
  let name = "";
  // 1a) 从 answer 整体中抽取最长的产品名候选
  name = extractProductNameFromText(a);
  // 1b) 拆句后再从首句抽取
  if (!name) {
    const sentences = splitSentences(a);
    for (const s of sentences.slice(0, 3)) {
      const cand = extractProductNameFromText(s);
      if (cand && cand.length >= 3) { name = cand; break; }
    }
  }
  // 1c) 从 question 中抽取（仅当 question 不像疑问句时）
  if (!name && !questionIsQuestionish) {
    name = extractProductNameFromText(q);
  }
  // 1d) 兜底：从 answer 第一句找"做 X"短语
  if (!name) {
    const sentences = splitSentences(a);
    for (const s of sentences) {
      const doMatch = s.match(/(?:做|做一个|做一个最小|做一个\s*MVP|做\s*MVP|尝试做|做\s*)([一-龥A-Za-z0-9 ·\-]{2,30})/);
      if (doMatch) {
        let cand = doMatch[1].trim();
        for (const pfx of NAME_PREFIXES_TO_STRIP) {
          if (cand.startsWith(pfx)) cand = cand.slice(pfx.length).trim();
        }
        if (cand && cand.length >= 2) { name = cand.slice(0, 24); break; }
      }
    }
  }
  // 1e) 最终：仍抽不到 → opportunityName 为空 + draftWarning
  if (!name) {
    return {
      opportunityName: "",
      draftWarning: "没有识别到明确机会，请补充机会名称。",
      oneLineSummary: "当前问题/回答里没有明显项目机会线索。建议：换个更具体的问题，或者在下面手动填写机会名称。",
      note: "暂无备注。",
      nextAction: "先把问题改成「我想做一个 X 工具/项目」这种明确意图，再加入机会池。",
      suggestedTags: ["需要调研"],
      status: "validate",
      type: "new-project-opportunity",
      source: hasSearch ? "search" : "ask-mode",
      sourceQuestion: q.slice(0, 1000),
      sourceAnswerSummary: summarizeAnswer(a, 600),
      sourceUrls: safeSources
    };
  }

  // 1f) 二次保护：如果 name 与 question 完全相同 → 视为"提炼失败"
  if (name === q || name === question) {
    return {
      opportunityName: "",
      draftWarning: "没有识别到明确机会，请补充机会名称。",
      oneLineSummary: "当前问题/回答里没有明显项目机会线索。建议：换个更具体的问题，或者在下面手动填写机会名称。",
      note: "暂无备注。",
      nextAction: "先把问题改成「我想做一个 X 工具/项目」这种明确意图，再加入机会池。",
      suggestedTags: ["需要调研"],
      status: "validate",
      type: "new-project-opportunity",
      source: hasSearch ? "search" : "ask-mode",
      sourceQuestion: q.slice(0, 1000),
      sourceAnswerSummary: summarizeAnswer(a, 600),
      sourceUrls: safeSources
    };
  }

  // 1g) 长度控制：≤ 24 字
  if (name.length > 24) {
    // 智能压缩：优先保留"X 助手 / X 工具"等后缀
    const suffixed = extractProductNameFromText(name);
    if (suffixed && suffixed.length <= 24 && suffixed.length >= 3) {
      name = suffixed;
    } else {
      name = name.slice(0, 24);
    }
  }
  name = name.replace(/\s+/g, " ").trim();
  // 1g2) 移除孤悬形容词（如"超级无敌的"前置的修饰），保留核心名+后缀
  const ORPHAN_ADJECTIVES = /^(超级|无敌|最强|最佳|超棒|完美|高级|非常|特别|极其|重要|核心|关键|主要|基础|标准|通用|简化|快速|简单|高级|专业|轻量|极简|迷你|小型|新型|多模态|跨平台|可视化|智能)\s*[的]?\s*/;
  name = name.replace(ORPHAN_ADJECTIVES, "");
  // 1g3) 移除以"的"开头或结尾的孤立字符
  name = name.replace(/^的\s*/, "").replace(/\s*的$/, "").trim();
  // 1h) 如果是 weather 类回答（不强机会信号），也给兜底
  if (!looksLikeOpportunity && !questionIsQuestionish) {
    return {
      opportunityName: "",
      draftWarning: "当前问题/回答不像项目机会描述，请补充机会名称。",
      oneLineSummary: "当前问题/回答里没有明显项目机会线索。",
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

  // ---- 2) oneLineSummary ----
  // 策略：从 answer 中找"它 / 这个 / X 工具是 / X 是..."的产品定义句；
  // 找不到则用"基于 answer 提炼的产品定位句"作为兜底。
  const firstSentence = splitSentences(a)[0] || "";
  let oneLineSummary = "";
  // 2a) 找产品定义句
  const defRegex = /([一-龥A-Za-z0-9 ·\-]{2,40}(?:助手|工具|平台|雷达|简报|看板|生成器|工作流|系统|OS|插件|bot|Bot|agent|Agent|MVP|选题器|分析器|检查器|体检器))(?:是|为|能|可以|用于|用来|帮你|帮助|旨在|核心|主要)([^。\n!?！？]{4,80})/;
  const defMatch = a.match(defRegex);
  if (defMatch) {
    oneLineSummary = `${defMatch[1].trim()}${defMatch[2].trim().slice(0, 50)}。`;
  }
  // 2b) 否则去掉无意义前缀 + 截到 80 字
  if (!oneLineSummary && firstSentence) {
    oneLineSummary = firstSentence;
    for (const pfx of NAME_PREFIXES_TO_STRIP) {
      if (oneLineSummary.startsWith(pfx)) oneLineSummary = oneLineSummary.slice(pfx.length).trim();
    }
    // 去掉句首"答：" / "结论：" 等
    oneLineSummary = oneLineSummary.replace(/^(答[：:]|结论[：:]|回答[：:]|答案是[：:]?)/, "").trim();
    if (oneLineSummary.length > 80) oneLineSummary = oneLineSummary.slice(0, 80);
  }
  // 2c) 兜底：基于 name 拼一句产品定位
  if (!oneLineSummary) {
    oneLineSummary = `一个面向独立开发者的「${name}」，把回答中的核心方向沉淀为可执行项目。`;
  }
  if (oneLineSummary && !/[。.！!？?]$/.test(oneLineSummary)) {
    oneLineSummary = `${oneLineSummary}。`;
  }
  if (oneLineSummary.length > 80) oneLineSummary = oneLineSummary.slice(0, 80);

  // ---- 3) note: 精炼备注（不复制整段 answer）----
  // 策略：从 answer 中提炼 2-4 个关键短句（每句 ≤ 60 字，去前缀），用换行分隔；总长 ≤ 300 字
  const keySentences = [];
  const seen = new Set();
  for (const raw of splitSentences(a)) {
    let s = raw;
    // 去前缀
    for (const pfx of NAME_PREFIXES_TO_STRIP) {
      if (s.startsWith(pfx)) s = s.slice(pfx.length).trim();
    }
    // 去掉 markdown 标题
    s = s.replace(/^#+\s*/, "").trim();
    if (s.length < 6) continue;
    const norm = s.slice(0, 30);
    if (seen.has(norm)) continue;
    seen.add(norm);
    keySentences.push(s.slice(0, 60));
    if (keySentences.length >= 5) break;
  }
  let note = keySentences.join("\n");
  if (note.length > 300) note = note.slice(0, 300);
  if (!note) note = `基于「${name}」机会的简要说明，建议补充"为什么值得关注 / 当前不确定点"。`;

  // ---- 4) nextAction: 找一个可执行动作 ----
  let nextAction = "";
  // 4a) 找含动词+宾语的具体短句（短匹配，避免贪婪）
  // 用 [\s\S]{0,30}? 配合非贪婪 + 短上限，避免吞掉整段
  const actionRegex = /(用\s*[\s\S]{0,30}?\s*跑通|用\s*[\s\S]{0,30}?\s*验证|做\s*[\s\S]{0,30}?\s*最小\s*[\s\S]{0,12}?(?:页面|网页|流程|提示词|MVP)|先做\s*[\s\S]{0,12}?(?=[，。！？\n])|MVP\s*[：:]\s*[\s\S]{0,40}?(?=[，。！？\n]))/;
  const actionMatch = a.match(actionRegex);
  if (actionMatch) {
    nextAction = actionMatch[0].trim();
  }
  // 4b) 否则找"做/写/搭/跑/验证/找/出"开头的句
  if (!nextAction) {
    for (const s of splitSentences(a)) {
      if (/^(做|写|搭|跑|验证|找|出|列|搭一个|写一个|做一个|建一个|上线|填|输入|输出|用)/.test(s)) {
        nextAction = s.slice(0, 200);
        break;
      }
    }
  }
  // 4c) 基于 name 推断一个最小验证动作
  if (!nextAction) {
    nextAction = `用 1-2 天做一个最小${name}验证：跑通核心 1 个动作 + 1 个判定指标。`;
  }
  // 4d) 清理：去前缀
  for (const pfx of NAME_PREFIXES_TO_STRIP) {
    if (nextAction.startsWith(pfx)) nextAction = nextAction.slice(pfx.length).trim();
  }
  if (nextAction.length > 500) nextAction = nextAction.slice(0, 500);
  // 兜底动词检查
  if (!/(做|写|跑|选|建|搭|上线|验证|测试|找|列|出|填|输入|输出|用|生成)/.test(nextAction)) {
    nextAction = `先用 1 天做一个最小${name}验证。`;
  }

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
    "可快速验证": /(MVP|可快速|快速验证|原型|快速跑通|先做最小|最小验证)/,
    "暂缓": /(暂缓|晚点|不急|之后|延后)/,
    "高潜力": /(高潜力|潜力大|很值得|值得做)/,
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
    suggestedTags.push("需要调研");
  }

  // ---- 6) source 标识 ----
  const source = hasSearch ? "search" : "ask-mode";

  return applyGoalToOpportunityDraft({
    opportunityName: name,
    draftWarning: null,
    oneLineSummary: oneLineSummary.slice(0, 80),
    note,
    nextAction,
    suggestedTags,
    status: "validate",
    type: "new-project-opportunity",
    source,
    sourceQuestion: q.slice(0, 1000),
    sourceAnswerSummary: summarizeAnswer(a, 600),
    sourceUrls: safeSources
  }, goalInfo);
}

// V0.3.10：新增机会
function addOpportunity({ rootDir = process.cwd(), input = {} } = {}) {
  // V0.3.11-hotfix-4：先统一过 redactSecretLikeText 防止 sk-* 进入持久化
  const safeInput = redactSecretLikeText(input);
  const cleaned = pickPersistFields(safeInput);
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
  // V0.3.11-hotfix-4：先统一过 redactSecretLikeText 防止 sk-* 进入 LLM prompt
  const safeOpportunities = redactSecretLikeText(
    Array.isArray(opportunities) ? opportunities : []
  );
  const list = options.currentGoal
    ? derivePrioritizedOpportunities(safeOpportunities, options.currentGoal)
    : (Array.isArray(safeOpportunities) ? safeOpportunities : []);
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
    const goalLine = raw.goalMatch
      ? `   Goal匹配：${String(raw.goalMatch)}；今日：${String(raw.todayPriority || "可观察")}；理由：${String(raw.priorityReason || "暂无")}`
      : "";
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
    if (goalLine) linesForItem.push(goalLine);
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
  // V0.4：状态桶互斥（之前 status=validate 同时 humanDecision=watching 会被 validate + watch 各自 +1）
  // 优先级（高 → 低）：
  //   archived / rejected（终态） > watch（含 status=watch 或 humanDecision=watching） > validate / inbox / mvp-spec / building
  // accepted 是 humanDecision 字段（accepted=true 时单独计入）
  let accepted = 0;
  let validate = 0;
  let watch = 0;
  let archived = 0;
  let rejected = 0;
  for (const item of list) {
    const status = String(item && item.status || "");
    const decision = String(item && item.humanDecision || "");
    if (status === "archived") { archived += 1; continue; }
    if (status === "rejected") { rejected += 1; continue; }
    if (status === "watch" || decision === "watching") { watch += 1; continue; }
    // accepted 是"已确认"的人类判断，与 status 是正交的；当一个机会 status=inbox/validate/mvp-spec/building
    // 且 humanDecision=accepted 时，仍按 status 算在 validate 桶，但 accepted 单独 +1（决策维度）。
    if (decision === "accepted") { accepted += 1; }
    validate += 1;
  }
  return {
    total: list.length,
    accepted,
    validate,
    watch,
    archived,
    rejected
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
  // V0.3.11-hotfix-4：先统一过 redactSecretLikeText
  const safePatch = redactSecretLikeText(patch);
  const loaded = loadOpportunityPool({ rootDir });
  const pool = loaded.pool;
  const index = pool.opportunities.findIndex((item) => item.id === id);
  if (index < 0) {
    const error = new Error("没有找到这个机会。");
    error.statusCode = 404;
    throw error;
  }
  const allowed = buildPatch(safePatch);
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
    fs.writeFileSync(backupPath, JSON.stringify({ ...pool, opportunities: pool.opportunities.map(stripUiFields) }, null, 2));
  } catch {
    // 备份失败不阻塞删除。
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
  deriveGoalMatchForOpportunity,
  derivePrioritizedOpportunities,
  deriveOpportunityDraftFromAnswer,
  normalizeSourceUrls,
  summarizeAnswer
};
