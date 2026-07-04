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
  buildOpportunityContextForPrompt,
  TYPE_LABELS,
  SCORE_LABELS,
  PRESET_TAGS
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
      opportunityName: "should not change",
      filePath: "bad"
    }
  });
  const saved = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  assert.equal(result.opportunity.status, "watch");
  assert.equal(result.opportunity.notes, "new note");
  assert.deepEqual(result.opportunity.tags, ["agent", "brief"]);
  assert.equal(saved.opportunities[0].opportunityName, "Independent AI opportunity brief MVP");
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
