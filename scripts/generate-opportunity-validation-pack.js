#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getDateString } = require("./generate-report");

const DEFAULT_OPPORTUNITY_NAME = "Independent AI opportunity brief MVP";

function readRequired(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-");
}

function validationSlug(opportunityName) {
  return slugify(opportunityName).replace(/-mvp$/, "");
}

function validationPaths(rootDir, date, opportunityName) {
  return {
    poolJsonPath: path.join(rootDir, "data", "opportunities", "opportunity-pool.json"),
    validationPackPath: path.join(
      rootDir,
      "opportunities",
      "validation",
      `${date}-${validationSlug(opportunityName)}-validation.md`
    )
  };
}

function isValidateAccepted(item) {
  return item?.status === "validate" && item?.humanDecision === "accepted";
}

function renderScores(scores = {}) {
  return [
    `- monetizationPotential: ${scores.monetizationPotential ?? ""}`,
    `- ericChanFit: ${scores.ericChanFit ?? ""}`,
    `- mvpSpeed: ${scores.mvpSpeed ?? ""}`,
    `- aiLeverage: ${scores.aiLeverage ?? ""}`,
    `- opcFit: ${scores.opcFit ?? ""}`,
    `- contentAssetPotential: ${scores.contentAssetPotential ?? ""}`,
    `- longTermCompounding: ${scores.longTermCompounding ?? ""}`,
    `- complexityRisk: ${scores.complexityRisk ?? ""}`,
    `- currentStageFit: ${scores.currentStageFit ?? ""}`
  ].join("\n");
}

function renderValidationPack(opportunity) {
  return `# Opportunity Validation Pack

## 1. Opportunity Summary

- opportunityName: ${opportunity.opportunityName}
- sourceTrend: ${opportunity.sourceTrend}
- whyItMatters: ${opportunity.whyItMatters}
- monetizationPotential: ${opportunity.monetizationPotential}
- ericChanFit: ${opportunity.ericChanFit}
- mvpForm: ${opportunity.mvpForm}
- firstValidationAction: ${opportunity.firstValidationAction}
- recommendedAgent: ${opportunity.recommendedAgent}
- scores:
${renderScores(opportunity.scores)}

## 2. Target User Hypotheses

### 独立开发者

- pain point: 信息很多，但很少有人把趋势翻译成适合个人快速试做的小机会。
- why they might care: 他们更关心一周内能试什么，而不是模型公司又发布了什么。
- willingness-to-pay hypothesis: 如果 brief 能直接给到可验证机会，愿意为节省筛选时间付小额订阅费。
- easiest way to reach them: X/Twitter、独立开发者社区、产品构建者群。

### 一人公司 / OPC 探索者

- pain point: 需要兼顾选题、变现、执行速度，普通 AI 新闻很难直接服务业务决策。
- why they might care: 他们需要的是“下一步可以卖什么、试什么”，不是泛趋势。
- willingness-to-pay hypothesis: 如果 brief 能持续带来可变现线索，愿意为高信号机会情报付费。
- easiest way to reach them: OPC 社群、创业者朋友圈、长期内容订阅者。

### AI 工具重度使用者

- pain point: 对工具更新非常敏感，但缺少把工具变化映射到新项目机会的方法。
- why they might care: 他们往往最早看到工具变化，也最适合把变化变成产品实验。
- willingness-to-pay hypothesis: 若内容能比官方 changelog 更快转成机会判断，愿意持续阅读并付费。
- easiest way to reach them: AI 工具社区、开发者 newsletter、产品实验人群。

### 内容创业者

- pain point: 需要持续找到高信号主题，同时避免内容只剩新闻复述。
- why they might care: 机会 brief 能直接变成选题、分析稿、付费专栏或咨询引流材料。
- willingness-to-pay hypothesis: 若 brief 既能启发内容又能启发变现，付费意愿会高于普通资讯订阅。
- easiest way to reach them: 内容创业社群、知识付费作者、个人品牌操盘者。

## 3. Value Proposition Drafts

- 理性效率型: 每周一份，把 AI 趋势直接翻译成你本周能验证的新项目机会。
- 趋势洞察型: 不再追 AI 新闻本身，而是提取新闻背后真正值得下注的隐性机会。
- 商业机会型: 帮 solo builder 和 OPC 探索者更快找到能试做、能变现、能讲清楚的 AI 项目方向。

## 4. Sample Opportunity Brief

- trend signal: AI agents 和 coding tools 正在把“个人开发者的执行上限”继续抬高，越来越多复杂流程可以由单人完成第一轮验证。
- hidden opportunity: 市场上缺少面向 solo builder 的“机会级 brief”，大多数内容仍停留在新闻、评测或工具清单，而不是可验证的新项目建议。
- why now: 工具能力提升速度太快，普通开发者没有时间自己筛出哪些变化真正值得投入。谁先把趋势翻译成行动，谁就更可能拿到先手。
- who should care: 独立开发者、一人公司、AI 工具重度使用者、想把 AI 内容转成业务机会的内容创业者。
- MVP idea: 做一份每周更新的 Markdown brief，每期聚焦一个高信号主题，给出隐藏机会、可行 MVP 形式、第一轮验证动作和简单变现路径。
- first validation action: 先选一个细分人群，产出 1 份样例 brief，拿给 3 个目标用户做快速反馈，验证“是否明显比普通 AI 新闻更有用”。
- monetization path: 起步可以是免费样例换反馈，随后测试付费订阅、咨询引流、专题机会报告或社群内深度版。
- why EricChan might fit: EricChan 已经在做战略 OS、机会池和机会筛选逻辑，本身就具备把趋势信号转成行动判断的底子，且风格偏高级、克制、系统化，适合做高信号简报。

## 5. Validation Interview Questions

1. 这份 brief 第一眼看上去，最有价值的部分是什么？
2. 你觉得它和普通 AI 新闻摘要最大的区别是什么？
3. 如果你每周只能看一份 AI 相关内容，这种 brief 是否值得进入你的固定阅读清单？
4. 哪个段落最像“真正能帮助你做决定”的内容？
5. 哪个部分最像噪声、过度推断或自嗨？
6. 你是否愿意把这种 brief 转发给一个也在找 AI 机会的朋友？为什么？
7. 如果它每周稳定提供 1-2 个高信号机会，你会考虑持续阅读吗？
8. 你会更希望它以什么形式出现：邮件、Markdown 文档、Notion、私域群内更新，还是别的形式？
9. 你对这类内容的价格敏感度大概在哪个区间？
10. 如果你不愿付费，最大的原因会是什么？
11. 你最希望它补充哪类信息，才能帮助你更快判断“值不值得做”？
12. 你觉得这更适合作为资讯产品、咨询前置样品，还是项目机会研究服务？

## 6. Validation Scorecard

- problem clarity: 1-5
- user urgency: 1-5
- differentiation from AI news: 1-5
- willingness to pay: 1-5
- repeat usage potential: 1-5
- content asset potential: 1-5
- EricChan execution fit: 1-5
- MVP simplicity: 1-5
- distribution feasibility: 1-5

## 7. Pass / Fail Criteria

- 至少访谈 3 个目标用户。
- 至少 2 人明确认为它比普通 AI 新闻更有价值。
- 至少 1 人表示愿意持续阅读、订阅或期待下一期。
- 平均 score >= 3.5。
- 没有明显“只有 EricChan 自己觉得有意思”的信号。

## 8. Recommended Next Action

- 如果通过：进入 V0.2 单机会 MVP Spec。
- 如果不通过：回到 opportunity pool，status 调整为 watch 或 rejected。
- 如果不确定：追加 3 个访谈样本，再决定是否进入 V0.2。
`;
}

function generateOpportunityValidationPack({
  rootDir = process.cwd(),
  date = getDateString(),
  opportunityName = DEFAULT_OPPORTUNITY_NAME,
  force = false
} = {}) {
  const paths = validationPaths(rootDir, date, opportunityName);
  const pool = JSON.parse(readRequired(paths.poolJsonPath, "Opportunity pool JSON"));
  const opportunities = Array.isArray(pool.opportunities) ? pool.opportunities : [];
  const eligible = opportunities.filter(isValidateAccepted);
  const opportunity = eligible.find((item) => normalize(item.opportunityName) === normalize(opportunityName));

  if (!opportunity) {
    throw new Error(`No validate/accepted opportunity found for "${opportunityName}".`);
  }
  if (!force && fs.existsSync(paths.validationPackPath)) {
    throw new Error(`Validation pack already exists for ${opportunityName} on ${date}. Use --force to overwrite.`);
  }

  const markdown = renderValidationPack(opportunity);
  ensureDir(path.dirname(paths.validationPackPath));
  fs.writeFileSync(paths.validationPackPath, markdown);

  return {
    date,
    opportunity,
    poolJsonPath: paths.poolJsonPath,
    validationPackPath: paths.validationPackPath,
    skippedCount: opportunities.filter((item) => item.id !== opportunity.id && !isValidateAccepted(item)).length,
    markdown
  };
}

function printSummary(result) {
  console.log("Opportunity validation pack summary");
  console.log(`Date: ${result.date}`);
  console.log(`Opportunity: ${result.opportunity.opportunityName}`);
  console.log(`Skipped non-validate opportunities: ${result.skippedCount}`);
  console.log(`Opportunity pool JSON: ${result.poolJsonPath}`);
  console.log(`Validation pack: ${result.validationPackPath}`);
}

function main() {
  const args = process.argv.slice(2);
  const dateArgIndex = args.indexOf("--date");
  const opportunityArgIndex = args.indexOf("--opportunity");
  const date = dateArgIndex >= 0 ? args[dateArgIndex + 1] : getDateString();
  const opportunityName = opportunityArgIndex >= 0 ? args[opportunityArgIndex + 1] : DEFAULT_OPPORTUNITY_NAME;

  try {
    printSummary(generateOpportunityValidationPack({ rootDir: process.cwd(), date, opportunityName, force: args.includes("--force") }));
  } catch (error) {
    console.error(`Opportunity validation pack failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_OPPORTUNITY_NAME,
  generateOpportunityValidationPack,
  renderValidationPack
};
