const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildPatch,
  loadOpportunityPool,
  normalizeOpportunity,
  saveOpportunityPool,
  updateOpportunity,
  addOpportunity,
  deleteOpportunity,
  buildOpportunityContextForPrompt,
  deriveOpportunityDraftFromAnswer,
  TYPE_LABELS,
  SCORE_LABELS,
  PRESET_TAGS,
  OPPORTUNITY_TITLE_OVERRIDES,
  OPPORTUNITY_PERSIST_FIELDS,
  getDisplayTitle
} = require("../scripts/opportunity-store");

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-store-"));
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-07-03T00:00:00.000Z",
        opportunities: [
          {
            id: "opp-1",
            opportunityName: "Independent AI opportunity brief MVP",
            status: "validate",
            humanDecision: "accepted",
            notes: "old",
            tags: ["ai"],
            unknownField: "keep"
          }
        ]
      },
      null,
      2
    )
  );
  return { rootDir, jsonPath };
}

test("loadOpportunityPool reads JSON and normalizes Chinese status labels", () => {
  const { rootDir } = fixture();
  const result = loadOpportunityPool({ rootDir });

  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].statusLabel, "待验证");
  assert.equal(result.opportunities[0].humanDecisionLabel, "已确认");
  assert.equal(result.stats.total, 1);
  assert.equal(result.stats.validate, 1);
});

test("normalizeOpportunity preserves unknown fields while adding UI labels", () => {
  const item = normalizeOpportunity({ id: "x", status: "watch", humanDecision: "watching", unknown: "keep" });

  assert.equal(item.statusLabel, "观察中");
  assert.equal(item.humanDecisionLabel, "观察中");
  assert.equal(item.unknown, "keep");
});

test("updateOpportunity only applies whitelisted fields and preserves unknown fields", () => {
  const { rootDir, jsonPath } = fixture();
  const result = updateOpportunity({
    rootDir,
    id: "opp-1",
    patch: {
      status: "watch",
      notes: "new note",
      tags: "agent, brief",
      opportunityName: "我改后的中文名", // V0.3.10-hotfix：现在允许通过 PATCH 改 opportunityName
      filePath: "bad"
    }
  });
  const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  assert.equal(result.opportunity.status, "watch");
  assert.equal(result.opportunity.notes, "new note");
  assert.deepEqual(result.opportunity.tags, ["agent", "brief"]);
  assert.equal(saved.opportunities[0].opportunityName, "我改后的中文名");
  assert.equal(saved.opportunities[0].unknownField, "keep");
  assert.equal(saved.opportunities[0].statusLabel, undefined);
  assert.equal(saved.opportunities[0].humanDecisionLabel, undefined);
});

test("updateOpportunity returns Chinese error when id is missing", () => {
  const { rootDir } = fixture();

  assert.throws(
    () => updateOpportunity({ rootDir, id: "missing", patch: { status: "watch" } }),
    /没有找到这个机会/
  );
});

test("saveOpportunityPool writes pretty JSON and Markdown", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-save-"));
  const pool = saveOpportunityPool(
    {
      version: 1,
      opportunities: [{ id: "opp-1", opportunityName: "A", status: "inbox", humanDecision: "pending" }]
    },
    { rootDir }
  );
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  const mdPath = path.join(rootDir, "opportunities", "opportunity-pool.md");
  const json = fs.readFileSync(jsonPath, "utf8");

  assert.equal(pool.opportunities.length, 1);
  assert.ok(json.includes("\n  \"version\""));
  assert.ok(fs.readFileSync(mdPath, "utf8").includes("EricChan·战略OS Opportunity Pool"));
});

test("buildPatch rejects invalid status and ignores arbitrary path fields", () => {
  assert.throws(() => buildPatch({ status: "bad" }), /状态不合法/);
  assert.deepEqual(buildPatch({ status: "watch", path: "x" }), { status: "watch" });
});

// ============== V0.3.10 中文化 + 标签 + 上下文 ==============

test("TYPE_LABELS covers common English enum types in Chinese", () => {
  assert.equal(TYPE_LABELS["new-project-opportunity"], "新项目机会");
  assert.equal(TYPE_LABELS["current-project-improvement"], "当前项目改进");
  assert.equal(TYPE_LABELS["legacy-learning-material"], "旧项目学习材料");
  assert.equal(TYPE_LABELS["watch-only"], "仅观察");
});

test("SCORE_LABELS covers common engineering score fields in Chinese", () => {
  assert.equal(SCORE_LABELS.monetizationPotential, "变现潜力");
  assert.equal(SCORE_LABELS.ericChanFit, "个人匹配度");
  assert.equal(SCORE_LABELS.mvpSpeed, "MVP 速度");
  assert.equal(SCORE_LABELS.aiLeverage, "AI 杠杆");
  assert.equal(SCORE_LABELS.opcFit, "OPC 匹配度");
  assert.equal(SCORE_LABELS.contentAssetPotential, "内容资产潜力");
  assert.equal(SCORE_LABELS.complexityRisk, "复杂度风险");
  assert.equal(SCORE_LABELS.currentStageFit, "当前阶段匹配度");
});

test("PRESET_TAGS includes the prescribed product labels", () => {
  // 必备标签白名单
  const required = [
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
  for (const tag of required) {
    assert.ok(PRESET_TAGS.includes(tag), `预设标签应包含 '${tag}'`);
  }
});

test("addOpportunity: 创建一条新机会并持久化", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add-"));
  const result = addOpportunity({
    rootDir,
    input: {
      title: "短视频选题工具",
      status: "validate",
      type: "new-project-opportunity",
      tags: ["高潜力", "可快速验证"],
      note: "用户认为适合做短视频选题工具验证。",
      nextAction: "做一个最小页面或提示词流程。",
      source: "ask-mode"
    }
  });
  assert.ok(result.opportunity && result.opportunity.id, "新机会应有 id");
  assert.equal(result.opportunity.opportunityName, "短视频选题工具");
  assert.equal(result.opportunity.status, "validate");
  assert.deepEqual(result.opportunity.tags, ["高潜力", "可快速验证"]);
  assert.equal(result.opportunity.notes, "用户认为适合做短视频选题工具验证。");
  // 持久化
  const saved = loadOpportunityPool({ rootDir });
  assert.equal(saved.opportunities.length, 1);
  assert.equal(saved.opportunities[0].opportunityName, "短视频选题工具");
});

test("addOpportunity: 默认 status=validate, type=new-project-opportunity", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add2-"));
  const result = addOpportunity({
    rootDir,
    input: { title: "测试默认" }
  });
  assert.equal(result.opportunity.status, "validate");
  assert.equal(result.opportunity.type, "new-project-opportunity");
});

test("addOpportunity: title 缺失抛错并返回中文消息", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add3-"));
  assert.throws(
    () => addOpportunity({ rootDir, input: { title: "" } }),
    /请填写机会名称/
  );
  assert.throws(
    () => addOpportunity({ rootDir, input: {} }),
    /请填写机会名称/
  );
});

test("addOpportunity: tags 非数组会被规范化（接受字符串/数组）", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add4-"));
  const r1 = addOpportunity({ rootDir, input: { title: "A", tags: "高潜力, 可快速验证" } });
  assert.deepEqual(r1.opportunity.tags, ["高潜力", "可快速验证"]);
  // 数组形式也接受
  const r2 = addOpportunity({ rootDir, input: { title: "B", tags: ["个人 OS", "OPC"] } });
  assert.deepEqual(r2.opportunity.tags, ["个人 OS", "OPC"]);
});

test("addOpportunity: 未知字段不被持久化 (only allowlist)", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add5-"));
  const result = addOpportunity({
    rootDir,
    input: {
      title: "C",
      filePath: "/etc/passwd",
      malicious: "x",
      sourceUrls: [{ title: "ok", url: "https://e.com/a", source: "e.com" }]
    }
  });
  // filePath / malicious 不应进入持久化
  const saved = loadOpportunityPool({ rootDir });
  const saved0 = saved.opportunities[0];
  assert.equal(saved0.filePath, undefined, "filePath 不应持久化");
  assert.equal(saved0.malicious, undefined, "未知字段不应持久化");
  // sourceUrls 保留
  assert.ok(Array.isArray(saved0.sourceUrls) && saved0.sourceUrls.length === 1);
});

test("addOpportunity: sourceUrls 最多 5 条且只保留 title/url/source", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add6-"));
  const urls = Array.from({ length: 8 }, (_, i) => ({
    title: `T${i + 1}`,
    url: `https://e.com/${i + 1}`,
    source: "e.com",
    snippet: "drop",
    raw: "drop"
  }));
  addOpportunity({ rootDir, input: { title: "D", sourceUrls: urls } });
  const saved = loadOpportunityPool({ rootDir });
  const saved0 = saved.opportunities[0];
  assert.equal(saved0.sourceUrls.length, 5);
  assert.equal(saved0.sourceUrls[0].title, "T1");
  assert.equal(saved0.sourceUrls[4].title, "T5");
  assert.equal(JSON.stringify(saved0).includes("drop"), false, "snippet/raw 应丢弃");
});

test("addOpportunity: note 最大长度限制 3000 字符", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add7-"));
  const longNote = "x".repeat(4000);
  addOpportunity({ rootDir, input: { title: "E", note: longNote } });
  const saved = loadOpportunityPool({ rootDir });
  assert.ok(saved.opportunities[0].notes.length <= 3000, "note 应被截断到 ≤ 3000 字符");
});

test("addOpportunity: 重复标题给出 warning 字段", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add8-"));
  addOpportunity({ rootDir, input: { title: "重复机会" } });
  const r2 = addOpportunity({ rootDir, input: { title: "重复机会" } });
  assert.ok(r2.warning && /可能重复|已存在|同名/.test(r2.warning), "应给出重复警告");
});

test("addOpportunity: 不保存 API Key 字段 (STRATEGY_OS_*, sk-*, LLM_API_KEY 等)", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add9-"));
  addOpportunity({
    rootDir,
    input: {
      title: "安全测试",
      apiKey: "sk-12345",
      STRATEGY_OS_LLM_API_KEY: "sk-real",
      LLM_API_KEY: "sk-leak",
      apiKeyLower: "should-drop"
    }
  });
  const saved = loadOpportunityPool({ rootDir });
  const json = JSON.stringify(saved.opportunities[0]);
  assert.equal(json.includes("sk-12345"), false, "apiKey 不应持久化");
  assert.equal(json.includes("sk-real"), false, "STRATEGY_OS_LLM_API_KEY 不应持久化");
  assert.equal(json.includes("sk-leak"), false, "LLM_API_KEY 不应持久化");
});

test("addOpportunity: 不保存 rawAnswer 字段 (只存 sourceAnswerSummary)", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-add10-"));
  addOpportunity({
    rootDir,
    input: {
      title: "F",
      rawAnswer: "完整 3000 字回答，应当不被存",
      sourceAnswerSummary: "短摘要 OK"
    }
  });
  const saved = loadOpportunityPool({ rootDir });
  const item = saved.opportunities[0];
  assert.equal(item.rawAnswer, undefined, "rawAnswer 不应持久化");
  assert.equal(item.sourceAnswerSummary, "短摘要 OK");
});

test("buildOpportunityContextForPrompt: 包含 note / tags / 中文 status / type", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-ctx-"));
  addOpportunity({
    rootDir,
    input: {
      title: "短视频选题工具",
      status: "validate",
      type: "new-project-opportunity",
      tags: ["高潜力", "可快速验证"],
      note: "用户认为适合做短视频选题工具验证。",
      nextAction: "做一个最小页面或提示词流程。",
      source: "ask-mode"
    }
  });
  const pool = loadOpportunityPool({ rootDir });
  const ctx = buildOpportunityContextForPrompt(pool.opportunities);
  assert.ok(ctx.includes("短视频选题工具"), "应包含标题");
  assert.ok(ctx.includes("待验证"), "应使用中文 status 标签");
  assert.ok(ctx.includes("新项目机会"), "应使用中文 type 标签");
  assert.ok(ctx.includes("高潜力"), "应包含 tags");
  assert.ok(ctx.includes("可快速验证"), "应包含 tags");
  assert.ok(ctx.includes("用户认为适合做短视频选题工具验证"), "应包含 note");
  assert.ok(ctx.includes("做一个最小页面或提示词流程"), "应包含 nextAction");
  // 不出现 raw JSON
  assert.equal(ctx.includes("opportunityName"), false, "不应出现英文字段名");
  assert.equal(ctx.includes("\"tags\""), false, "不应出现 raw JSON 字符串");
});

test("buildOpportunityContextForPrompt: archived / rejected 默认不优先注入", () => {
  const items = [
    { id: "1", opportunityName: "机会 A", status: "archived" },
    { id: "2", opportunityName: "机会 B", status: "rejected" },
    { id: "3", opportunityName: "机会 C", status: "validate" }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.equal(ctx.includes("机会 A"), false, "archived 默认不注入");
  assert.equal(ctx.includes("机会 B"), false, "rejected 默认不注入");
  assert.ok(ctx.includes("机会 C"), "validate 应注入");
});

test("buildOpportunityContextForPrompt: includeArchived=true 时仍会注入", () => {
  const items = [
    { id: "1", opportunityName: "已归档机会", status: "archived" }
  ];
  const ctx = buildOpportunityContextForPrompt(items, { includeArchived: true });
  assert.ok(ctx.includes("已归档机会"));
});

test("buildOpportunityContextForPrompt: 最多注入指定数量（默认 10）", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    opportunityName: `机会 ${i + 1}`,
    status: "validate"
  }));
  const ctx = buildOpportunityContextForPrompt(items);
  for (let i = 1; i <= 10; i += 1) {
    assert.ok(ctx.includes(`机会 ${i}`), `应包含机会 ${i}`);
  }
  for (let i = 11; i <= 15; i += 1) {
    assert.equal(ctx.includes(`机会 ${i}`), false, `不应包含机会 ${i}`);
  }
});

test("buildOpportunityContextForPrompt: 缺失字段用中文空态而不是 null/undefined", () => {
  const items = [{ id: "x", opportunityName: "只有名字", status: "validate" }];
  const ctx = buildOpportunityContextForPrompt(items);
  // 不应出现 null / undefined / 英文内部字段
  assert.equal(/null|undefined/.test(ctx), false, "不应出现 null/undefined");
  assert.equal(ctx.includes("note:"), false, "不应出现英文字段名");
  // 缺失字段应有中文空态
  assert.ok(/暂无备注|暂无/.test(ctx), "缺备注/标签/下一步时应有中文空态");
});

test("buildOpportunityContextForPrompt: 用户编辑机会后下次调用能反映新内容", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-ctx2-"));
  addOpportunity({ rootDir, input: { title: "原始机会", note: "原始备注" } });
  const pool1 = loadOpportunityPool({ rootDir });
  const ctx1 = buildOpportunityContextForPrompt(pool1.opportunities);
  assert.ok(ctx1.includes("原始备注"));

  // 编辑
  updateOpportunity({
    rootDir,
    id: pool1.opportunities[0].id,
    patch: { notes: "更新后这是我重点关注的方向" }
  });
  const pool2 = loadOpportunityPool({ rootDir });
  const ctx2 = buildOpportunityContextForPrompt(pool2.opportunities);
  assert.ok(ctx2.includes("更新后这是我重点关注的方向"), "更新后应能读取新备注");
  assert.equal(ctx2.includes("原始备注"), false, "旧备注应不再出现");
});

test("buildOpportunityContextForPrompt: 输出不包含 raw JSON 字段名", () => {
  const items = [
    {
      id: "raw-test",
      opportunityName: "字段测试",
      status: "validate",
      type: "new-project-opportunity",
      notes: "n",
      tags: ["a"],
      nextAction: "x",
      scores: { ericChanFit: 4 },
      sourceUrls: [{ title: "t", url: "u", source: "s" }]
    }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  for (const field of ["scores", "sourceUrls", "id", "createdAt", "updatedAt", "humanDecision"]) {
    assert.equal(ctx.includes(field + ":"), false, `不应出现 '${field}:' 字面字段名`);
  }
});

// ============== V0.3.10-hotfix：旧英文标题中文映射 + 删除 + 安全约束 ==============

test("OPPORTUNITY_TITLE_OVERRIDES: 旧英文标题能映射到中文 displayTitle", () => {
  assert.equal(OPPORTUNITY_TITLE_OVERRIDES["Independent AI opportunity brief MVP"], "独立 AI 机会简报 MVP");
  assert.equal(OPPORTUNITY_TITLE_OVERRIDES["Opportunity scoring quality gate"], "机会评分质量门槛");
});

test("getDisplayTitle: 旧英文标题返回中文映射，新中文标题保持原样", () => {
  assert.equal(getDisplayTitle({ opportunityName: "Independent AI opportunity brief MVP" }), "独立 AI 机会简报 MVP");
  assert.equal(getDisplayTitle({ opportunityName: "短视频选题工具" }), "短视频选题工具");
  // 缺字段时不返回 undefined
  assert.ok(getDisplayTitle({}), "缺字段应返回兜底字符串而非 undefined");
  // 已知 mojibake 字节序列也走兜底
  assert.ok(getDisplayTitle({ opportunityName: "V0.3.10 ����" }), "乱码应走兜底");
});

test("normalizeOpportunity: 含 displayTitle 字段（旧英文自动中文化）", () => {
  const item = normalizeOpportunity({ id: "x", opportunityName: "Independent AI opportunity brief MVP", status: "validate" });
  assert.equal(item.displayTitle, "独立 AI 机会简报 MVP");
  // 中文保持
  const cn = normalizeOpportunity({ id: "y", opportunityName: "短视频选题工具", status: "validate" });
  assert.equal(cn.displayTitle, "短视频选题工具");
  // 乱码或未知英文 → 兜底为"未命名机会"
  const unknown = normalizeOpportunity({ id: "z", opportunityName: "Some Unknown English Project", status: "validate" });
  assert.ok(unknown.displayTitle && /机会|未命名/.test(unknown.displayTitle), "未知英文应给出中文兜底");
});

test("deleteOpportunity: 删除存在的 id 并持久化", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-del-"));
  const jsonPath = path.join(rootDir, "data", "opportunities", "opportunity-pool.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-04T00:00:00.000Z",
      opportunities: [
        { id: "opp-keep", opportunityName: "保留", status: "validate", type: "new-project-opportunity" },
        { id: "opp-remove", opportunityName: "删除", status: "validate", type: "new-project-opportunity" }
      ]
    })
  );
  const result = deleteOpportunity({ rootDir, id: "opp-remove" });
  assert.equal(result.stats.total, 1);
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.opportunities[0].id, "opp-keep");
  // 磁盘真的写掉了
  const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(saved.opportunities.length, 1);
  assert.equal(saved.opportunities[0].id, "opp-keep");
});

test("deleteOpportunity: 不存在的 id 抛 404 中文错误", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-del2-"));
  assert.throws(
    () => deleteOpportunity({ rootDir, id: "missing" }),
    (err) => err.statusCode === 404 && /没有找到/.test(err.message)
  );
});

test("deleteOpportunity: id 缺失抛 400 中文错误", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-del3-"));
  assert.throws(
    () => deleteOpportunity({ rootDir, id: "" }),
    (err) => err.statusCode === 400 && /请提供|不合法|缺失/.test(err.message)
  );
});

test("deleteOpportunity: id 包含路径分隔符会拒绝", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-del4-"));
  assert.throws(
    () => deleteOpportunity({ rootDir, id: "../etc/passwd" }),
    (err) => err.statusCode === 400 && /不合法|包含|路径/.test(err.message)
  );
  assert.throws(
    () => deleteOpportunity({ rootDir, id: "opp/sub" }),
    (err) => err.statusCode === 400
  );
  assert.throws(
    () => deleteOpportunity({ rootDir, id: "opp..id" }),
    (err) => err.statusCode === 400
  );
});

test("buildOpportunityContextForPrompt: 使用 displayTitle 而非原始 opportunityName", () => {
  const items = [
    {
      id: "old-1",
      opportunityName: "Independent AI opportunity brief MVP",
      status: "validate",
      type: "new-project-opportunity",
      notes: "n",
      tags: []
    }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.ok(ctx.includes("独立 AI 机会简报 MVP"), "应使用中文映射后的标题");
  assert.equal(ctx.includes("Independent AI opportunity brief MVP"), false, "不应再出现英文原始标题");
});

test("buildOpportunityContextForPrompt: 删除后的机会不再出现（依赖调用方传入最新列表）", () => {
  const items = [
    { id: "a", opportunityName: "保留 A", status: "validate", type: "new-project-opportunity", notes: "n", tags: [] }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.ok(ctx.includes("保留 A"));
  assert.equal(ctx.includes("已删除 B"), false, "已删除项不应再注入");
});

test("buildOpportunityContextForPrompt: 用户编辑标题后使用最新中文标题", () => {
  const items = [
    {
      id: "edited",
      opportunityName: "我重命名后的新机会",
      status: "validate",
      type: "new-project-opportunity",
      notes: "备注",
      tags: ["高潜力"]
    }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.ok(ctx.includes("我重命名后的新机会"));
  assert.ok(ctx.includes("高潜力"));
  assert.ok(ctx.includes("备注"));
});

test("buildOpportunityContextForPrompt: 不输出未识别乱码", () => {
  const items = [
    {
      id: "broken",
      opportunityName: "V0.3.10 ����",
      status: "validate",
      type: "new-project-opportunity",
      notes: "n",
      tags: []
    }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.equal(ctx.includes("����"), false, "不应把 mojibake 字面输出到 prompt");
  // 仍应有中文兜底
  assert.ok(ctx.includes("独立 AI") || ctx.includes("未命名机会") || ctx.length > 0);
});

// ============== V0.3.11 智能机会草稿 deriveOpportunityDraftFromAnswer ==============

test("deriveOpportunityDraftFromAnswer: 不直接把 question 当 opportunityName", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我推荐你做一个 AI 短视频选题助手，方向是结合近期 AI 趋势和你的能力，做一个把热点转成可拍选题的工具。MVP 可以用提示词和简单网页跑通，先验证效果。"
  });
  assert.notEqual(draft.opportunityName, "最近有什么适合独立开发者做的小型 AI 项目？", "不应把问题原句作为机会名");
  assert.ok(draft.opportunityName.length > 0, "应提炼出名称");
  assert.ok(draft.opportunityName.length <= 30, "机会名应 ≤ 30 字");
});

test("deriveOpportunityDraftFromAnswer: opportunityName 命中回答里显式提到的产品方向", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做一个 AI 短视频选题助手。MVP 用提示词工程加一个简单的网页，每天产出 5 条选题，验证 EricChan 能否用起来。"
  });
  assert.ok(/短视频|选题/.test(draft.opportunityName), `机会名应反映回答里的核心方向: ${draft.opportunityName}`);
});

test("deriveOpportunityDraftFromAnswer: note 不复制整段 answer（应短于 300 字）", () => {
  const longAnswer = "推荐做一个 AI 短视频选题助手。" + "这句话重复填充。".repeat(80);
  const draft = deriveOpportunityDraftFromAnswer({ question: "q", answer: longAnswer });
  assert.ok(draft.note.length <= 300, `note 应 ≤ 300 字, 实际 ${draft.note.length}`);
  assert.notEqual(draft.note, longAnswer, "note 不应等于完整 answer");
});

test("deriveOpportunityDraftFromAnswer: sourceAnswerSummary ≤ 600 字", () => {
  const longAnswer = "短答：做 AI 短视频选题助手。" + "细节。".repeat(200);
  const draft = deriveOpportunityDraftFromAnswer({ question: "q", answer: longAnswer });
  assert.ok(draft.sourceAnswerSummary.length <= 600, `sourceAnswerSummary 应 ≤ 600 字, 实际 ${draft.sourceAnswerSummary.length}`);
});

test("deriveOpportunityDraftFromAnswer: nextAction 是可执行句子", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI 短视频选题助手，MVP 步骤：做一个输入框页面，输入方向，输出 5 个选题 + 标题 + 口播角度，2-3 天内可上线。"
  });
  assert.ok(draft.nextAction.length > 0, "应生成 nextAction");
  assert.ok(draft.nextAction.length <= 500, `nextAction 应 ≤ 500 字`);
  // 应是"做 / 验证 / 写 / 选 / 跑"等动词开头
  assert.ok(/^(做|验证|写|选|跑|列|找|出一个|尝试|最小|输入|输出|搭建|上线)/.test(draft.nextAction) || draft.nextAction.length >= 4, "应包含可执行动词");
});

test("deriveOpportunityDraftFromAnswer: suggestedTags 来自 PRESET_TAGS 白名单", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI Agent 类工具，独立开发者可做，AI 大模型应用方向，可快速验证。"
  });
  for (const t of draft.suggestedTags) {
    assert.ok(PRESET_TAGS.includes(t), `建议标签应来自预设: ${t}`);
  }
  assert.ok(draft.suggestedTags.length > 0, "至少应建议一个标签");
});

test("deriveOpportunityDraftFromAnswer: sourceUrls 最多 5 条且只保留 title/url/source", () => {
  const search = {
    used: true,
    sources: Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://e.com/${i}`, source: "e.com" }))
  };
  const draft = deriveOpportunityDraftFromAnswer({ question: "q", answer: "a", search });
  assert.ok(draft.sourceUrls.length <= 5, "sourceUrls ≤ 5");
  for (const u of draft.sourceUrls) {
    assert.ok(typeof u.title === "string" && typeof u.url === "string" && typeof u.source === "string");
  }
});

test("deriveOpportunityDraftFromAnswer: 无法识别机会时给出中文提示", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "今天天气怎么样",
    answer: "今天多云转晴，最高温度 25 度，东南风 3 级。"
  });
  // V0.3.11-hotfix：无法识别时 opportunityName 为空字符串 + draftWarning
  assert.equal(draft.opportunityName, "", "无法识别时 opportunityName 应为空");
  assert.ok(draft.draftWarning && /手动|补充|没有识别|无法/.test(draft.draftWarning), "应有中文 draftWarning");
});

test("deriveOpportunityDraftFromAnswer: 不保存 raw answer / raw search response / API Key", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI 选题助手，strat-os-sk-1234abcd 应当被忽略",
    search: { used: true, rawResponse: { secret: true }, sources: [] }
  });
  const json = JSON.stringify(draft);
  assert.equal(json.includes("strat-os-sk-1234abcd"), false, "不应包含 API Key 字符串");
  assert.equal(json.includes("rawResponse"), false, "不应包含 rawResponse 字段");
  assert.equal(json.includes("secret"), false, "不应包含 raw search response 内部字段");
});

test("deriveOpportunityDraftFromAnswer: 默认 status=validate, type=new-project-opportunity", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI 短视频选题助手"
  });
  assert.equal(draft.status, "validate");
  assert.equal(draft.type, "new-project-opportunity");
});

test("deriveOpportunityDraftFromAnswer: oneLineSummary 是一句话中文（≤ 80 字）", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI 短视频选题助手，把热点和方向结合成可拍选题。"
  });
  assert.ok(draft.oneLineSummary.length > 0, "应有一句话说明");
  assert.ok(draft.oneLineSummary.length <= 80, "一句话说明应 ≤ 80 字");
});

test("deriveOpportunityDraftFromAnswer: sourceQuestion 保留用户原始问题", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "我想做 AI 选题",
    answer: "推荐 AI 短视频选题助手"
  });
  assert.equal(draft.sourceQuestion, "我想做 AI 选题");
});

test("deriveOpportunityDraftFromAnswer: 来源标识 source = 'ask-mode' 或 'search'", () => {
  const d1 = deriveOpportunityDraftFromAnswer({ question: "q", answer: "推荐做 AI 助手" });
  const d2 = deriveOpportunityDraftFromAnswer({ question: "q", answer: "推荐做 AI 助手", search: { used: true, sources: [{ title: "T", url: "u", source: "s" }] } });
  assert.equal(d1.source, "ask-mode");
  assert.equal(d2.source, "search");
});

test("deriveOpportunityDraftFromAnswer: source 不接受 body 控制的 filePath / apiKey", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "推荐做 AI 助手",
    // 尝试注入敏感字段
    filePath: "data/secret.json",
    apiKey: "sk-1234"
  });
  const json = JSON.stringify(draft);
  assert.equal(json.includes("filePath"), false);
  assert.equal(json.includes("sk-1234"), false);
});

// ============== V0.3.11 oneLineSummary 持久化 + 上下文注入 ==============

test("OPPORTUNITY_PERSIST_FIELDS: 包含 oneLineSummary", () => {
  assert.ok(OPPORTUNITY_PERSIST_FIELDS.includes("oneLineSummary"), "白名单应包含 oneLineSummary");
});

test("addOpportunity: 支持保存 oneLineSummary 与 nextAction (中文)", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-0311-"));
  const result = addOpportunity({
    rootDir,
    input: {
      title: "AI 短视频选题助手",
      oneLineSummary: "把热点和方向结合，生成可拍的短视频选题。",
      note: "适合独立开发者 MVP 验证。",
      nextAction: "做一个最小网页：输入方向 → 输出 5 个选题。",
      tags: ["高潜力", "可快速验证"],
      source: "ask-mode"
    }
  });
  assert.equal(result.opportunity.opportunityName, "AI 短视频选题助手");
  assert.equal(result.opportunity.oneLineSummary, "把热点和方向结合，生成可拍的短视频选题。");
  assert.equal(result.opportunity.nextAction, "做一个最小网页：输入方向 → 输出 5 个选题。");
  // 持久化
  const saved = loadOpportunityPool({ rootDir });
  assert.equal(saved.opportunities[0].oneLineSummary, "把热点和方向结合，生成可拍的短视频选题。");
  assert.equal(saved.opportunities[0].nextAction, "做一个最小网页：输入方向 → 输出 5 个选题。");
});

test("addOpportunity: oneLineSummary 过长会被截断（不超过 300 字）", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-os-op-0311-trunc-"));
  const long = "细节".repeat(400);
  const result = addOpportunity({
    rootDir,
    input: { title: "测试", oneLineSummary: long, nextAction: long }
  });
  assert.ok(result.opportunity.oneLineSummary.length <= 300, "oneLineSummary ≤ 300");
  assert.ok(result.opportunity.nextAction.length <= 500, "nextAction ≤ 500");
});

test("buildOpportunityContextForPrompt: 包含 oneLineSummary 与 nextAction", () => {
  const items = [
    {
      id: "1",
      opportunityName: "AI 短视频选题助手",
      status: "validate",
      type: "new-project-opportunity",
      oneLineSummary: "把热点和方向结合，生成可拍的短视频选题。",
      nextAction: "做一个最小网页：输入方向 → 输出 5 个选题。",
      tags: ["高潜力"],
      notes: "n"
    }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.ok(ctx.includes("一句话"), "应在 prompt 注入'一句话'说明");
  assert.ok(ctx.includes("把热点和方向结合"), "应包含一句话摘要正文");
  assert.ok(ctx.includes("下一步"), "应包含'下一步'字段");
  assert.ok(ctx.includes("做一个最小网页"), "应包含 nextAction 正文");
});

test("buildOpportunityContextForPrompt: 缺 oneLineSummary / nextAction 时给中文兜底而不是 null", () => {
  const items = [
    { id: "1", opportunityName: "A", status: "validate", type: "new-project-opportunity", notes: "n", tags: [] }
  ];
  const ctx = buildOpportunityContextForPrompt(items);
  assert.equal(/>\s*null\s*</.test(ctx), false, "不应出现 null");
  assert.equal(/>\s*undefined\s*</.test(ctx), false, "不应出现 undefined");
  // 应有'暂无一句话说明' 或类似兜底
  assert.ok(/暂无|请补充|待补充/.test(ctx), "缺字段应有中文兜底");
});

// ============== V0.3.11-hotfix 智能草稿与开工包质量 ==============

test("V0.3.11-hotfix: 疑问句 question 时 opportunityName 不等于 question", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合，做一个把热点转成可拍选题的工具。MVP 可以用提示词和简单网页跑通。"
  });
  assert.notEqual(draft.opportunityName, "最近有什么适合独立开发者做的小型 AI 项目？", "疑问句不应直接当机会名");
  assert.ok(draft.opportunityName && draft.opportunityName.length > 0, "应能从回答提炼出名字");
  // 不应包含原问题关键词
  assert.equal(/最近有什么适合独立开发者/.test(draft.opportunityName), false, "名字不应再带原问题片段");
});

test("V0.3.11-hotfix: 真实例子「我建议你先做一个 AI 短视频选题助手」→ 名字应是 'AI 短视频选题助手' 或类似", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手，方向是把近期 AI 趋势和你的能力结合。"
  });
  assert.ok(/短视频|选题/.test(draft.opportunityName), `名字应反映回答里的核心方向: ${draft.opportunityName}`);
  // 不应含无意义前缀
  for (const prefix of ["我建议你", "适合做", "可以先", "做一个", "建议先"]) {
    assert.equal(draft.opportunityName.startsWith(prefix), false, `名字不应以"${prefix}"开头`);
  }
  // 长度合理
  assert.ok(draft.opportunityName.length <= 24, `名字应 ≤ 24 字: ${draft.opportunityName.length}`);
});

test("V0.3.11-hotfix: 无法提炼明确机会时 opportunityName 为空并返回 draftWarning", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "最近有什么趋势？",
    answer: "近期大模型更新比较快，多模态是热点。"
  });
  // 应为空 + draftWarning 提示
  assert.equal(draft.opportunityName, "", "无法识别时 opportunityName 应为空字符串");
  assert.ok(draft.draftWarning, "应有 draftWarning");
  assert.ok(/手动|补充|没有识别|无法/.test(draft.draftWarning), `draftWarning 应含中文提示: ${draft.draftWarning}`);
});

test("V0.3.11-hotfix: weather / 通用问答时返回 draftWarning", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "今天天气怎么样",
    answer: "今天多云转晴，最高温度 25 度。"
  });
  assert.equal(draft.opportunityName, "");
  assert.ok(draft.draftWarning, "weather 类应给 draftWarning");
});

test("V0.3.11-hotfix: 多个候选产品时优先选第一个明确的产品名", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "给我点建议",
    answer: "你可以做 AI 短视频选题助手，也可以做 AI 内容雷达。MVP 都用提示词跑通。"
  });
  assert.ok(/短视频|选题/.test(draft.opportunityName), `应选第一个明确产品: ${draft.opportunityName}`);
});

test("V0.3.11-hotfix: note ≤ 300 字且不等于 answer", () => {
  const longAnswer = "推荐做 AI 短视频选题助手。" + "细节。".repeat(200);
  const draft = deriveOpportunityDraftFromAnswer({ question: "q", answer: longAnswer });
  assert.ok(draft.note.length <= 300, `note ≤ 300: ${draft.note.length}`);
  assert.notEqual(draft.note, longAnswer);
  // 不应含 markdown 标题符
  assert.equal(/^#+\s/m.test(draft.note), false, "note 不应含 markdown 标题");
});

test("V0.3.11-hotfix: nextAction 包含可执行动词", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "我建议你先做一个 AI 短视频选题助手。"
  });
  assert.ok(draft.nextAction.length > 0);
  assert.ok(/(做|写|跑|选|建|搭|上线|验证|测试|找|列|出|填|输入|输出|用|生成)/.test(draft.nextAction), `nextAction 应含动词: ${draft.nextAction}`);
  // 不应只写"继续研究"
  assert.notEqual(draft.nextAction, "继续研究");
});

test("V0.3.11-hotfix: oneLineSummary 不含 markdown / 不等于 question", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "最近有什么适合独立开发者做的小型 AI 项目？",
    answer: "我建议你先做一个 AI 短视频选题助手。"
  });
  assert.notEqual(draft.oneLineSummary, "最近有什么适合独立开发者做的小型 AI 项目？");
  assert.equal(/^#+\s/m.test(draft.oneLineSummary), false);
  assert.ok(draft.oneLineSummary.length <= 80, `≤ 80: ${draft.oneLineSummary.length}`);
});

test("V0.3.11-hotfix: 机会名称长时尝试压缩而非简单截断", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "我建议你做一个超级无敌的 AI 短视频选题助手工具平台产品系统。"
  });
  assert.ok(draft.opportunityName.length <= 24);
  // 不应简单截断成半句（不应有"超级"等形容孤悬）
  assert.equal(draft.opportunityName.includes("超级"), false, "不应留下孤悬形容词");
});

test("V0.3.11-hotfix: 移除无意义前缀 '我建议你'/'做一个' 等", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "我建议你先做一个面向独立开发者的 AI 内容雷达。"
  });
  for (const prefix of ["我建议你", "适合做", "一个面向", "面向"]) {
    assert.equal(draft.opportunityName.startsWith(prefix), false);
  }
  assert.ok(draft.opportunityName.length > 0);
});

test("V0.3.11-hotfix: 提炼后含产品名后缀（助手/工具/平台）", () => {
  const draft = deriveOpportunityDraftFromAnswer({
    question: "q",
    answer: "做 AI 短视频选题助手。MVP 用提示词和网页表单跑通。"
  });
  assert.ok(/(助手|工具|平台|雷达|简报|看板|生成器|工作流|日历|模板|系统|插件|agent|Agent|bot|Bot|OS|选题器|分析器|检查器|体检器)/.test(draft.opportunityName), `应含产品后缀: ${draft.opportunityName}`);
});
