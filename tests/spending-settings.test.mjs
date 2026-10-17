import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

globalThis.spendingSettingsTest = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "@/lib/auth": "export async function requireFinanceApi(){ return globalThis.spendingSettingsTest.denied; }",
      "@/lib/db": "export async function execute(sql, args){ if(globalThis.spendingSettingsTest.fail) throw Error('DB'); globalThis.spendingSettingsTest.writes.push(args); }",
    };
    return mocks[specifier] ? nextResolve(`data:text/javascript,${encodeURIComponent(mocks[specifier])}`, context) : nextResolve(specifier, context);
  },
});
const { PATCH } = await import("../src/app/api/spending-settings/route.ts");
const request = (body, origin = "https://finance.example") => new Request("https://finance.example/api/spending-settings", {
  method: "PATCH", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
beforeEach(() => { globalThis.spendingSettingsTest = { denied: null, writes: [] }; });

test("budget changes require authentication and same origin", async () => {
  globalThis.spendingSettingsTest.denied = new Response(null, { status: 401 });
  assert.equal((await PATCH(request({ monthlyBudget: 5000 }))).status, 401);
  globalThis.spendingSettingsTest.denied = null;
  assert.equal((await PATCH(request({ monthlyBudget: 5000 }, "https://elsewhere.example"))).status, 403);
  assert.deepEqual(globalThis.spendingSettingsTest.writes, []);
});
test("budget saves only the requested valid setting, including zero", async () => {
  for (const monthlyBudget of [5000, 3500.25, 0]) assert.equal((await PATCH(request({ monthlyBudget }))).status, 200);
  assert.deepEqual(globalThis.spendingSettingsTest.writes, [["monthly_spending_budget", "5000"], ["monthly_spending_budget", "3500.25"], ["monthly_spending_budget", "0"]]);
});
test("invalid budgets never write and storage failures surface", async () => {
  for (const body of [{}, { monthlyBudget: -1 }, { monthlyBudget: "5000" }, { monthlyBudget: 1e7 }, { monthlyBudget: 1.111 }, { monthlyBudget: 5000, extra: true }]) assert.equal((await PATCH(request(body))).status, 400);
  assert.deepEqual(globalThis.spendingSettingsTest.writes, []);
  globalThis.spendingSettingsTest.fail = true;
  assert.equal((await PATCH(request({ monthlyBudget: 5000 }))).status, 500);
});
