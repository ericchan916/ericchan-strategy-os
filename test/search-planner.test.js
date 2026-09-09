const assert = require("node:assert/strict");
const test = require("node:test");

const {
  filterSearchResultsByRelevance,
  planSearchQueries
} = require("../scripts/search-planner");

test("wide trend question is rewritten for EricChan AI opportunity search", () => {
  const plan = planSearchQueries("今天有什么趋势？");

  assert.equal(plan.intent, "ai-opportunity");
  assert.equal(plan.queries.length >= 2, true);
  assert.equal(plan.queries.length <= 4, true);
  assert.equal(plan.queries.length === 1 && plan.queries[0] === "今天有什么趋势？", false);
  assert.ok(plan.queries.join(" ").match(/AI|Agent|大模型|独立开发者|商业机会|startup/i));
});

test("planner classifies common search intents", () => {
  assert.equal(planSearchQueries("最近 Anthropic 有什么新闻？").intent, "news");
  assert.equal(planSearchQueries("最近 AI Agent 有什么新机会？").intent, "ai-opportunity");
  assert.equal(planSearchQueries("这个 GitHub 项目值不值得做？").intent, "project-research");
  assert.equal(planSearchQueries("有没有类似产品？").intent, "competitor-research");
  assert.equal(planSearchQueries("API 文档怎么接？").intent, "technical-docs");
});

test("planner sets recency requirements by intent", () => {
  assert.equal(planSearchQueries("最近 Anthropic 有什么新闻？").recencyRequired, true);
  assert.equal(planSearchQueries("最近有什么 AI 机会？").recencyRequired, true);
  assert.equal(planSearchQueries("API 文档怎么接？").recencyRequired, true);
  assert.equal(planSearchQueries("普通战略问题").recencyRequired, false);
});

test("today and recent wording use narrower freshness", () => {
  assert.equal(planSearchQueries("今天有什么趋势？").freshness, "oneWeek");
  assert.equal(planSearchQueries("这两天 AI 新闻有什么？").freshness, "oneWeek");
  assert.equal(planSearchQueries("最近 Anthropic 有什么新闻？").freshness, "oneMonth");
});

test("V0.6.3-hotfix: planner redacts short sk-like values from queries", () => {
  const plan = planSearchQueries("请查一下 sk-leakTestABC 最近有什么新闻？");
  const serialized = JSON.stringify(plan);

  assert.equal(serialized.includes("sk-leakTestABC"), false);
  assert.ok(serialized.includes("[redacted]"));
});

test("ai opportunity search blocks finance pollution by default", () => {
  const plan = planSearchQueries("最近有什么机会？");

  assert.equal(plan.intent, "ai-opportunity");
  assert.ok(plan.blockedTopics.includes("A股"));
  assert.ok(plan.blockedTopics.includes("股票"));
  assert.ok(plan.blockedTopics.includes("行情"));
});

test("explicit finance questions do not block finance results", () => {
  const plan = planSearchQueries("今天股票有什么趋势？");
  const results = filterSearchResultsByRelevance(
    [
      {
        title: "A股行情缩量上涨",
        url: "https://finance.example/a",
        snippet: "股票 行情 板块 资金流入",
        source: "财经站"
      }
    ],
    plan,
    5
  );

  assert.equal(plan.allowFinance, true);
  assert.equal(plan.blockedTopics.length, 0);
  assert.equal(results.results.length, 1);
});

test("relevance filter removes market-board noise and keeps AI product results", () => {
  const plan = planSearchQueries("今天有什么趋势？");
  const filtered = filterSearchResultsByRelevance(
    [
      {
        title: "A股涨停板块资金流入，创业板缩量上涨",
        url: "https://finance.example/a",
        snippet: "股票 行情 大盘 盘面",
        source: "财经站"
      },
      {
        title: "AI Agent tools launch for developers",
        url: "https://ai.example/agent",
        snippet: "AI Agent 大模型 工具 开发者 workflow product",
        source: "AI Example"
      }
    ],
    plan,
    5
  );

  assert.equal(filtered.weak, false);
  assert.equal(filtered.results.length, 1);
  assert.equal(filtered.results[0].url, "https://ai.example/agent");
});
