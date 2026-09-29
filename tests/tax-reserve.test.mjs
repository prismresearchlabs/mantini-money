import assert from "node:assert/strict";
import test from "node:test";
import { buildReserveAwareCashHistory, getReserveAwareCash, isAutomaticTaxReserve, resolveTaxReserve, taxReserveScopeKey } from "../src/lib/tax-reserve.ts";

function account(id, name, balance, values = {}) {
  return { id, name, currentBalance: balance, type: "depository", subtype: "savings", currency: "USD", ...values };
}

test("automatic reserve detection recognizes named tax cash accounts without hiding ordinary accounts", () => {
  for (const name of ["Tax", "Taxes", "Tax reserve", "Quarterly Taxes", "IRS", "IRS savings"]) {
    assert.equal(isAutomaticTaxReserve({ name, type: "depository" }), true, name);
  }
  for (const name of ["Taxable brokerage", "Tax refund spending", "Tax services business", "Vacation", "Personal"]) {
    assert.equal(isAutomaticTaxReserve({ name, type: "depository" }), false, name);
  }
  assert.equal(isAutomaticTaxReserve({ name: "Tax", type: "investment" }), false);
  assert.equal(isAutomaticTaxReserve({ name: "Tax", type: "credit" }), false);
});

test("explicit reserve settings override inference, including an intentionally empty selection", () => {
  const accounts = [account("tax", "Tax", 400), account("other", "Personal", 1000)];
  assert.deepEqual(resolveTaxReserve(accounts).accountIds, ["tax"]);
  const selected = resolveTaxReserve(accounts, '["other","other"]');
  assert.deepEqual(selected.accountIds, ["other"]);
  assert.equal(selected.balance, 1000);
  assert.equal(selected.source, "configured");
  const none = resolveTaxReserve(accounts, "[]");
  assert.deepEqual(none.accountIds, []);
  assert.equal(none.balance, 0);
  assert.equal(none.source, "configured");
});

test("malformed or unavailable settings are visible instead of breaking the dashboard", () => {
  const accounts = [account("tax", "Tax", 400), account("card", "Credit", 200, { type: "credit" })];
  for (const setting of ["{broken", "null", '["tax",10]']) {
    const resolved = resolveTaxReserve(accounts, setting);
    assert.equal(resolved.invalidSetting, true);
    assert.equal(resolved.balance, 400);
  }
  const missing = resolveTaxReserve(accounts, '["removed","card"]');
  assert.deepEqual(missing.accountIds, []);
  assert.equal(missing.missingBalances, 2);
  assert.deepEqual(missing.unavailableAccountIds, ["card", "removed"]);
});

test("tax reserve counts only positive USD funds and reports missing or unsupported balances", () => {
  const selected = resolveTaxReserve([
    account("positive", "Tax", 200), account("negative", "Tax reserve", -30),
    account("unknown", "IRS", null), account("foreign", "Taxes", 900, { currency: "EUR" }),
  ]);
  assert.equal(selected.balance, 200);
  assert.equal(selected.missingBalances, 1);
  assert.equal(selected.unsupportedCurrencies, 1);
});

test("cash and savings protection remove the tax reserve only once", () => {
  const accounts = [
    account("checking", "Spending", 1500, { subtype: "checking" }),
    account("savings", "Emergency", 600), account("tax", "Tax", 400),
    account("broker", "Investments", 2000, { type: "investment" }),
  ];
  assert.deepEqual(getReserveAwareCash(accounts, ["tax"]), { grossCash: 2500, totalCash: 2100, nonTaxSavings: 600 });
  assert.deepEqual(getReserveAwareCash(accounts, []), { grossCash: 2500, totalCash: 2500, nonTaxSavings: 1000 });
});

test("negative reserve balances remain cash deficits and never create a negative reserve deduction", () => {
  const accounts = [account("checking", "Everyday", 200, { subtype: "checking" }), account("tax", "Tax", -50)];
  const reserve = resolveTaxReserve(accounts);
  const cash = getReserveAwareCash(accounts, reserve.accountIds);
  assert.equal(reserve.balance, 0);
  assert.equal(cash.grossCash - reserve.balance, cash.totalCash);
  assert.equal(cash.totalCash, 150);
  const history = buildReserveAwareCashHistory(cash.totalCash, [
    { accountId: "tax", accountType: "depository", date: "2026-09-22", amount: 100, pending: false },
  ], reserve.accountIds, new Date("2026-09-23T12:00:00Z"), accounts);
  assert.equal(history.find((day) => day.day === "2026-09-21").balance, 200);
  assert.equal(history.find((day) => day.day === "2026-09-22").balance, 150);
  assert.equal(history.find((day) => day.day === "2026-09-22").cashOut, 50);
  assert.equal(history.at(-1).balance, cash.totalCash);
});

test("cash reconstruction excludes reserve-account activity and preserves the funding-account outflow", () => {
  const rows = [
    { accountId: "checking", accountType: "depository", date: "2026-09-20", amount: 100, pending: false },
    { accountId: "tax", accountType: "depository", date: "2026-09-20", amount: -100, pending: false },
    { accountId: "tax", accountType: "depository", date: "2026-09-21", amount: 60, pending: false },
    { accountId: "tax", accountType: "depository", date: "2026-09-22", amount: -5, pending: false },
    { accountId: "checking", accountType: "depository", date: "2026-09-23", amount: 99, pending: true },
    { accountId: "checking", accountType: "depository", date: "2026-10-01", amount: 300, pending: false },
  ];
  const history = buildReserveAwareCashHistory(400, rows, ["tax"], new Date("2026-09-23T12:00:00Z"));
  assert.equal(history.find((day) => day.day === "2026-09-19").balance, 500);
  assert.equal(history.find((day) => day.day === "2026-09-20").balance, 400);
  assert.equal(history.find((day) => day.day === "2026-09-20").cashOut, 100);
  assert.equal(history.find((day) => day.day === "2026-09-20").cashIn, 0);
  assert.equal(history.find((day) => day.day === "2026-09-21").cashOut, 0);
  assert.equal(history.at(-1).balance, 400);
});

test("snapshot history identity changes with reserve designation but not account order", () => {
  assert.equal(taxReserveScopeKey(["tax-b", "tax-a"]), taxReserveScopeKey(["tax-a", "tax-b", "tax-a"]));
  assert.notEqual(taxReserveScopeKey(["tax-a"]), taxReserveScopeKey([]));
  assert.notEqual(taxReserveScopeKey(["tax-a"]), taxReserveScopeKey(["tax-b"]));
});
