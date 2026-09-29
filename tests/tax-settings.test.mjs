import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

// Exercise request boundaries without touching bank data or a real database.
globalThis.taxSettingsTest = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mocks = {
      "@/lib/auth": "export async function requireFinanceApi(){ return globalThis.taxSettingsTest.denied; }",
      "@/lib/db": `export async function queryRows(sql) {
        return sql.includes("FROM accounts") ? globalThis.taxSettingsTest.accounts : [];
      }
      export function getDb(){ return {batch: async (statements) => {globalThis.taxSettingsTest.writes.push(...statements);}}; }`,
    };
    if (mocks[specifier]) return nextResolve(`data:text/javascript,${encodeURIComponent(mocks[specifier])}`, context);
    if (specifier === "@/lib/tax-estimate") return nextResolve(new URL("../src/lib/tax-estimate.ts", import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { PATCH } = await import("../src/app/api/tax-settings/route.ts");
const request = (body, origin = "https://finance.example") => new Request("https://finance.example/api/tax-settings", {
  method: "PATCH", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
const scenario = { annualIncome: 100000, filingStatus: "single", incomeType: "self-employed", federalWithholding: 0, estimatedPayments: 3000 };
beforeEach(() => { globalThis.taxSettingsTest = { denied: null, accounts: [{account_id:"cash"},{account_id:"reserve"}], writes: [] }; });

test("tax settings reject unauthenticated and cross-origin mutations before writes", async () => {
  globalThis.taxSettingsTest.denied = Response.json({ error: "Unauthorized" }, { status: 401 });
  assert.equal((await PATCH(request({accountIds: ["reserve"]}))).status, 401);
  globalThis.taxSettingsTest.denied = null;
  assert.equal((await PATCH(request({scenario}, "https://elsewhere.example"))).status, 403);
  assert.equal(globalThis.taxSettingsTest.writes.length, 0);
});
test("tax settings reject unknown reserve accounts and incomplete or invalid scenarios", async () => {
  for (const body of [{ accountIds: ["unknown"] }, { scenario: { ...scenario, annualIncome: -10 } },
    { scenario: { ...scenario, filingStatus: null } }, { scenario: { ...scenario, incomeType: "s-corp" } },
    { scenario: { ...scenario, annualIncome: "100000" } }, { unrelated: true }, {}]) {
    assert.equal((await PATCH(request(body))).status, 400);
  }
  assert.equal(globalThis.taxSettingsTest.writes.length, 0);
});
test("legitimate browser host works when Next uses an internal request URL, without trusting forwarded hosts", async () => {
  const proxied = (origin, host, forwarded) => new Request("http://localhost:3000/api/tax-settings", {
    method: "PATCH", headers: { origin, host, "x-forwarded-host": forwarded, "Content-Type": "application/json" },
    body: JSON.stringify({ accountIds: ["reserve"] }),
  });
  assert.equal((await PATCH(proxied("http://127.0.0.1:3000", "127.0.0.1:3000", "untrusted.example"))).status, 200);
  assert.equal((await PATCH(proxied("https://finance.example", "finance.example", "untrusted.example"))).status, 200);
  assert.equal((await PATCH(proxied("https://untrusted.example", "finance.example", "untrusted.example"))).status, 403);
  assert.equal((await PATCH(proxied("null", "finance.example", "untrusted.example"))).status, 403);
  assert.equal(globalThis.taxSettingsTest.writes.length, 2);
});
test("tax settings save reserve selection and tax assumptions independently and deduplicate accounts", async () => {
  assert.equal((await PATCH(request({ accountIds: ["reserve", "reserve"], scenario }))).status, 200);
  assert.deepEqual(globalThis.taxSettingsTest.writes.map((write) => write.args), [
    ["tax_account_ids", '["reserve"]'], ["tax_scenario_2026", JSON.stringify(scenario)],
  ]);
});
test("empty reserve selection and clearing a scenario are explicit saved choices", async () => {
  assert.equal((await PATCH(request({ accountIds: [], scenario: null }))).status, 200);
  assert.deepEqual(globalThis.taxSettingsTest.writes.map((write) => write.args), [
    ["tax_account_ids", "[]"], ["tax_scenario_2026", "null"],
  ]);
});
