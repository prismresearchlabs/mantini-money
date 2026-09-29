import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Node's native TypeScript runner needs the same single alias used by the app.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/categories") return nextResolve(new URL("../../lib/categories.ts", import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const { categoryUpdates, csvCell, filterTransactions, needsCategory, transactionCsv } = await import("./transactions-model.ts");

// All inputs are synthetic and in memory. These tests never connect to a database or API.
const transaction = (overrides = {}) => ({
  id: "test-1", accountId: "test-checking", institutionName: "Test bank", accountName: "Test checking",
  accountMask: "0001", accountType: "depository", date: "2026-09-14", name: "Test Market 101",
  rawName: "TEST MARKET #101", amount: 45.12, pending: false, category: "Groceries", categorySource: "automatic",
  plaidCategory: "FOOD_AND_DRINK", detailCategory: "FOOD_AND_DRINK_GROCERIES", flowType: "spending", flowLabel: "Spending",
  ...overrides,
});
const filters = (overrides = {}) => ({ start: "2026-09-01", end: "2026-09-30", query: "", account: "all", category: "all", flow: "all", tab: "all", sort: "newest", ...overrides });

test("CSV neutralizes merchant formulas, including leading whitespace, without changing numeric amounts", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1+1", "\t=1+1", "\r=1+1"]) {
    assert.equal(csvCell(value), `"'${value}"`);
  }
  assert.equal(csvCell(-45.12), "-45.12");
  assert.equal(csvCell(45.12), "45.12");
  assert.equal(csvCell('Merchant, "Downtown"\nStore'), '"Merchant, ""Downtown""\nStore"');
});

test("CSV makes inflows positive, preserves pending status and has one row per supplied transaction", () => {
  const csv = transactionCsv([
    transaction({ name: "=malicious()", amount: 23.5 }),
    transaction({ id: "test-2", amount: -92.25, pending: true }),
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(csv.includes('"\'=malicious()"'));
  assert.ok(csv.includes(',-23.5,"Posted",'));
  assert.ok(csv.includes(',92.25,"Pending",'));
});

test("search finds precise raw and formatted amounts, merchant descriptions and account metadata", () => {
  const rows = [transaction({ amount: 1200.5, rawName: "UNIQUE RECEIPT DESCRIPTION" }), transaction({ id: "test-2", amount: 12, accountName: "Test savings", accountMask: "0002" })];
  for (const query of ["1200.50", "$1,200.50", "-1200.50", "−$1,200.50", "  unique receipt  ", "TEST CHECKING", "0001"]) {
    assert.deepEqual(filterTransactions(rows, filters({ query })).map((row) => row.id), ["test-1"]);
  }
});

test("date boundaries are inclusive and account, category, flow and status filters compose", () => {
  const rows = [
    transaction({ id: "start", date: "2026-09-01", pending: true }),
    transaction({ id: "end", date: "2026-09-30", pending: true }),
    transaction({ id: "before", date: "2026-08-31", pending: true }),
    transaction({ id: "after", date: "2026-10-01", pending: true }),
    transaction({ id: "wrong-account", accountId: "test-other", pending: true }),
    transaction({ id: "posted", pending: false }),
    transaction({ id: "wrong-category", category: "Dining", pending: true }),
    transaction({ id: "wrong-flow", flowType: "transfer", pending: true }),
  ];
  const result = filterTransactions(rows, filters({ account: "test-checking", category: "Groceries", flow: "spending", tab: "pending" }));
  assert.deepEqual(result.map((row) => row.id), ["end", "start"]);
});

test("an intentional manual Other category does not appear in the categorization queue", () => {
  assert.equal(needsCategory(transaction({ category: "Other", categorySource: "automatic" })), true);
  assert.equal(needsCategory(transaction({ category: "Other", categorySource: "manual" })), false);
  assert.equal(needsCategory(transaction({ category: "Groceries", categorySource: "automatic" })), false);
});

test("amount sorting uses magnitude for both directions and never mutates the source", () => {
  const rows = [transaction({ id: "small", amount: 10 }), transaction({ id: "large-inflow", amount: -200 }), transaction({ id: "medium", amount: 50 })];
  const original = rows.map((row) => row.id);
  assert.deepEqual(filterTransactions(rows, filters({ sort: "largest" })).map((row) => row.id), ["large-inflow", "medium", "small"]);
  assert.deepEqual(filterTransactions(rows, filters({ sort: "smallest" })).map((row) => row.id), ["small", "medium", "large-inflow"]);
  assert.deepEqual(rows.map((row) => row.id), original);
});

test("merchant learning matches normalized names and preserves previous manual choices", () => {
  const rows = [
    transaction({ id: "selected", name: "Test Market 101" }),
    transaction({ id: "automatic-match", name: "TEST MARKET #202" }),
    transaction({ id: "learned-match", name: "Test Market 303", categorySource: "learned" }),
    transaction({ id: "manual-match", name: "Test Market 404", category: "Business", categorySource: "manual" }),
    transaction({ id: "unrelated", name: "Another Market" }),
  ];
  const before = structuredClone(rows);
  assert.deepEqual(categoryUpdates(rows, "selected", "Shopping"), {
    selected: { category: "Shopping", categorySource: "manual" },
    "automatic-match": { category: "Shopping", categorySource: "learned" },
    "learned-match": { category: "Shopping", categorySource: "learned" },
  });
  assert.deepEqual(rows, before);
  assert.deepEqual(categoryUpdates(rows, "missing", "Shopping"), {});
});
