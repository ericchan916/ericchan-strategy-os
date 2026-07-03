const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { runToday } = require("../scripts/run-today");

test("runToday executes daily flow in order and returns a clear summary", async () => {
  const calls = [];
  const result = await runToday({
    rootDir: "E:/fake-root",
    date: "2026-07-03",
    force: false,
    impl: {
      runDailyReport: async ({ date }) => {
        calls.push(`daily:${date}`);
        return {
          mode: "mock",
          warnings: ["fetch failed; fallback mock analysis mode used."],
          markdownPath: "E:/fake-root/reports/2026-07-03.md",
          jsonPath: "E:/fake-root/data/reports/2026-07-03.json"
        };
      },
      updateOpportunityPool: ({ date }) => {
        calls.push(`update:${date}`);
        return { imported: 0, updated: 2, skipped: 1 };
      },
      validateOpportunityPoolFile: () => {
        calls.push("validate");
        return { ok: true, count: 2, failures: [] };
      },
      generateDailyCommand: ({ date, force }) => {
        calls.push(`command:${date}:${force}`);
        return {
          markdownPath: "E:/fake-root/daily-command/2026-07-03.md",
          jsonPath: "E:/fake-root/data/daily-command/2026-07-03.json",
          command: {
            sourceMode: "mock",
            recommendedActions: [{ action: "A" }, { action: "B" }, { action: "C" }]
          }
        };
      }
    }
  });

  assert.deepEqual(calls, ["daily:2026-07-03", "update:2026-07-03", "validate", "command:2026-07-03:false"]);
  assert.equal(result.sourceMode, "mock");
  assert.equal(result.recommendedActionCount, 3);
  assert.equal(result.mockFallback, true);
  assert.equal(result.dailyCommandPath, "E:/fake-root/daily-command/2026-07-03.md");
});

test("runToday passes --force to command generation", async () => {
  let forceValue = null;

  await runToday({
    rootDir: "E:/fake-root",
    date: "2026-07-03",
    force: true,
    impl: {
      runDailyReport: async () => ({ mode: "live", warnings: [] }),
      updateOpportunityPool: () => ({ imported: 0, updated: 0, skipped: 0 }),
      validateOpportunityPoolFile: () => ({ ok: true, count: 1, failures: [] }),
      generateDailyCommand: ({ force }) => {
        forceValue = force;
        return {
          markdownPath: "E:/fake-root/daily-command/2026-07-03.md",
          jsonPath: "E:/fake-root/data/daily-command/2026-07-03.json",
          command: { sourceMode: "live", recommendedActions: [{ action: "A" }] }
        };
      }
    }
  });

  assert.equal(forceValue, true);
});

test("runToday rewrites existing command errors with a force hint", async () => {
  await assert.rejects(
    () =>
      runToday({
        rootDir: "E:/fake-root",
        date: "2026-07-03",
        impl: {
          runDailyReport: async () => ({ mode: "live", warnings: [] }),
          updateOpportunityPool: () => ({ imported: 0, updated: 0, skipped: 0 }),
          validateOpportunityPoolFile: () => ({ ok: true, count: 1, failures: [] }),
          generateDailyCommand: () => {
            throw new Error("Daily Command already exists for 2026-07-03. Use --force to overwrite.");
          }
        }
      }),
    /Daily Command already exists[\s\S]*npm run today -- --force/
  );
});

test("runToday stops when daily generation fails", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      runToday({
        rootDir: "E:/fake-root",
        date: "2026-07-03",
        impl: {
          runDailyReport: async () => {
            calls.push("daily");
            throw new Error("daily failed");
          },
          updateOpportunityPool: () => {
            calls.push("update");
            return {};
          },
          validateOpportunityPoolFile: () => {
            calls.push("validate");
            return { ok: true, count: 0, failures: [] };
          },
          generateDailyCommand: () => {
            calls.push("command");
            return {};
          }
        }
      }),
    /Daily run failed: daily failed/
  );

  assert.deepEqual(calls, ["daily"]);
});
