import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTransactions,
  detectRecurring,
  filterTransactions,
  getDateRange,
  getNetWorth,
  getPeriodAnchor,
  isFreshObservation,
  matchInternalTransfers,
} from "../src/lib/analytics.ts";

const now = new Date(2026, 8, 29, 12);
let nextId = 1;
function transaction(values = {}) {
  return { id: String(nextId++), accountId: "checking", date: "2026-09-10", name: "Example", amount: 30, pending: false, category: "Dining", categorySource: "automatic", flowType: "spending", ...values };
}

function transferRow(values = {}) {
  return { transaction_id: String(nextId++), account_id: "buffer", account_name: "Buffer", account_mask: "1111", account_type: "depository", account_subtype: "checking", institution_name: "Example bank", transaction_date: "2026-09-17", name: "Withdrawal to Personal ***********", amount: 12000, pending: 0, category_primary: "TRANSFER_OUT", ...values };
}

test("internal transfers override misclassified income when descriptions identify the owned accounts", () => {
  const outgoing = transferRow();
  const incoming = transferRow({ account_id: "personal", account_name: "Personal", account_mask: "2222", account_subtype: "savings", name: "Deposit from Buffer ***********", amount: -12000, category_primary: "INCOME" });
  const matches = matchInternalTransfers([incoming, outgoing]);
  assert.equal(matches.get(outgoing.transaction_id), "savings");
  assert.equal(matches.get(incoming.transaction_id), "savings");
});

test("tax-reserve transfers reconcile renamed bank aliases instead of being counted as taxes", () => {
  const outgoing = transferRow({ name: "Withdrawal to Tax Reserve ***********", amount: 2400, category_primary: "GOVERNMENT_AND_NON_PROFIT" });
  const incoming = transferRow({ account_id: "tax", account_name: "Tax", account_subtype: "savings", name: "Deposit from Old Checking ***********", amount: -2400, category_primary: "TRANSFER_IN" });
  const matches = matchInternalTransfers([outgoing, incoming]);
  assert.equal(matches.get(outgoing.transaction_id), "savings");
  assert.equal(matches.get(incoming.transaction_id), "savings");
});

test("matching never pairs same-account entries, pending movements or coincidental merchant purchases", () => {
  const outgoing = transferRow({ name: "Example Store", amount: 100, category_primary: "GENERAL_MERCHANDISE" });
  const incoming = transferRow({ account_id: "other", account_name: "Other", name: "Deposit from Buffer ***********", amount: -100, category_primary: "TRANSFER_IN" });
  assert.equal(matchInternalTransfers([outgoing, incoming]).size, 0);
  assert.equal(matchInternalTransfers([transferRow(), transferRow({ amount: -12000, name: "Deposit from Personal ***********", category_primary: "TRANSFER_IN" })]).size, 0);
  assert.equal(matchInternalTransfers([transferRow({ pending: 1 }), transferRow({ account_id: "other", amount: -12000, name: "Deposit from Buffer ***********", category_primary: "TRANSFER_IN" })]).size, 0);
});

test("ambiguous same-amount movements are not assigned to an arbitrary counterparty", () => {
  const outgoing = transferRow();
  const incoming = transferRow({ account_id: "other", account_name: "Personal", amount: -12000, name: "Deposit from Buffer ***********", category_primary: "TRANSFER_IN" });
  const duplicate = { ...incoming, transaction_id: "second-incoming", account_id: "third" };
  assert.equal(matchInternalTransfers([outgoing, incoming, duplicate]).size, 0);
});

test("date presets use calendar boundaries, clamp leap days, and compare month-to-date fairly", () => {
  assert.deepEqual(Object.values(getDateRange("month", [], now)).slice(0, 2), ["2026-09-01", "2026-09-29"]);
  const month = getDateRange("month", [], now);
  assert.equal(month.previousStart, "2026-08-01");
  assert.equal(month.previousEnd, "2026-08-29");
  const march = getDateRange("month", [], new Date(2024, 2, 31, 23));
  assert.equal(march.previousEnd, "2024-02-29");
  const ytd = getDateRange("ytd", [], new Date(2024, 1, 29, 12));
  assert.equal(ytd.previousEnd, "2023-02-28");
  assert.equal(getDateRange("last-month", [], now).end, "2026-08-31");
  assert.equal(getDateRange("3-months", [], now).start, "2026-07-01");
  assert.equal(getDateRange("all", [{ date: "2024-01-01" }, { date: "2027-01-01" }, { date: "invalid" }], now).start, "2024-01-01");
});

test("date filtering includes boundaries and excludes malformed or impossible dates", () => {
  const rows = [{ date: "2026-02-01" }, { date: "2026-02-28" }, { date: "2026-02-31" }, { date: "2026-03-01" }, { date: "invalid" }];
  assert.equal(filterTransactions(rows, { start: "2026-02-01", end: "2026-02-31" }).length, 2);
});

test("period navigation preserves YTD cutoff days and handles month/year boundaries", () => {
  assert.equal(getDateRange("ytd", [], getPeriodAnchor("ytd", -12, now)).end, "2025-09-29");
  assert.equal(getDateRange("ytd", [], getPeriodAnchor("ytd", -12, new Date(2024, 1, 29, 12))).end, "2023-02-28");
  assert.equal(getDateRange("month", [], getPeriodAnchor("month", -1, new Date(2026, 2, 31, 12))).end, "2026-02-28");
  assert.equal(getDateRange("last-month", [], getPeriodAnchor("last-month", -1, new Date(2026, 0, 31, 12))).start, "2025-11-01");
  const quarter = getDateRange("3-months", [], getPeriodAnchor("3-months", -3, new Date(2026, 0, 31, 12)));
  assert.equal(quarter.start, "2025-08-01");
  assert.equal(quarter.end, "2025-10-31");
});

test("snapshot freshness parses SQLite timestamps as UTC and rejects stale, invalid or future observations", () => {
  const observedAt = new Date("2026-09-29T12:00:00Z");
  assert.equal(isFreshObservation("2026-09-29 12:00:00", observedAt), true);
  assert.equal(isFreshObservation("2026-09-27T12:00:00Z", observedAt), true);
  assert.equal(isFreshObservation("2026-09-27T11:59:59Z", observedAt), false);
  assert.equal(isFreshObservation("2026-09-30T12:00:00Z", observedAt), false);
  assert.equal(isFreshObservation(null, observedAt), false);
  assert.equal(isFreshObservation("invalid", observedAt), false);
});

test("cash flow excludes pending items and both sides of transfers and card payments", () => {
  const rows = [
    transaction({ amount: -1000, flowType: "income", category: "Income" }),
    transaction({ amount: 100 }),
    transaction({ amount: 20, flowType: "taxes", category: "Taxes" }),
    transaction({ amount: -15, flowType: "refund", category: "Refund" }),
    transaction({ amount: 50, pending: true }),
    transaction({ amount: -500, pending: true, flowType: "income" }),
    transaction({ amount: 200, flowType: "transfer" }),
    transaction({ amount: -200, flowType: "transfer" }),
    transaction({ amount: 100, flowType: "credit_payment" }),
    transaction({ amount: -100, flowType: "credit_payment" }),
    transaction({ amount: 80, flowType: "investment" }),
    transaction({ amount: 90, flowType: "savings" }),
    transaction({ amount: -90, flowType: "savings" }),
    transaction({ amount: 40, date: "2026-10-01" }),
  ];
  const result = analyzeTransactions(rows, getDateRange("month", rows, now));
  assert.deepEqual(result.totals, { income: 1000, spending: 120, taxes: 20, refunds: 15, net: 895, savingsRate: 89.5, transfers: 200, cardPayments: 100, invested: 80, saved: 90, pendingSpending: 50 });
  assert.equal(result.breakdown.reduce((sum, entry) => sum + entry.value, 0), 120);
  assert.equal(result.monthlyTrend[0].net, 895);
});

test("comparison is unavailable for partial imported history or a zero prior baseline", () => {
  const partial = [transaction({ date: "2026-08-15", amount: 100 }), transaction({ amount: 50 })];
  assert.equal(analyzeTransactions(partial, getDateRange("month", partial, now)).spendingChange, null);
  const full = [transaction({ date: "2026-08-01", amount: 100 }), transaction({ amount: 50 })];
  assert.equal(analyzeTransactions(full, getDateRange("month", full, now)).spendingChange, -50);
  const noIncome = analyzeTransactions(full, getDateRange("month", full, now));
  assert.equal(noIncome.incomeChange, null);
  assert.equal(noIncome.totals.savingsRate, null);
});

test("monthly series includes empty months and breakdown grouping reconciles", () => {
  const rows = [transaction({ date: "2026-07-10", amount: 10 }), transaction({ amount: 20, category: "Groceries" }), transaction({ amount: 30, category: "Other" })];
  const result = analyzeTransactions(rows, getDateRange("3-months", rows, now), "group");
  assert.deepEqual(result.monthlyTrend.map((month) => month.spending), [10, 0, 50]);
  assert.equal(result.averageMonthlySpending, 20);
  assert.equal(result.breakdown.find((entry) => entry.name === "Food & dining").value, 30);
  assert.equal(result.reviewCount, 1);
});

test("net worth uses each account once while adding independent crypto and retaining overdrafts", () => {
  const accounts = [
    { id: "checking", type: "depository", currentBalance: 1000 },
    { id: "overdraft", type: "depository", currentBalance: -25 },
    { id: "broker", type: "investment", currentBalance: 5000 },
    { id: "card", type: "credit", currentBalance: 200 },
    { id: "loan", type: "loan", currentBalance: 3000 },
    { id: "overpaid-card", type: "credit", currentBalance: -50 },
  ];
  const holdings = [
    { accountId: "broker", value: 4000, type: "equity" },
    { accountId: "broker", value: 1000, type: "cash" },
    { accountId: "coinbase:1", institutionName: "Coinbase", value: 1000, type: "cryptocurrency" },
    { accountId: "kraken", institutionName: "Kraken", value: 12, type: "cash" },
  ];
  const result = getNetWorth(accounts, holdings);
  assert.equal(result.assets, 7062);
  assert.equal(result.liabilities, 3225);
  assert.equal(result.netWorth, 3837);
  assert.equal(result.investments, 5000);
  assert.equal(result.crypto, 1000);
});

test("net worth uses holdings when balance is missing, reports unavailable values and excludes non-USD", () => {
  const result = getNetWorth([
    { id: "broker", type: "investment", currentBalance: null },
    { id: "missing", type: "depository", currentBalance: null },
    { id: "foreign", type: "depository", currentBalance: 10000, currency: "EUR" },
  ], [{ accountId: "broker", value: 42, type: "equity" }]);
  assert.equal(result.netWorth, 42);
  assert.equal(result.missingBalances, 1);
  assert.equal(result.unsupportedCurrencies, 1);
});

test("a Plaid exchange balance and direct connection are not double counted", () => {
  const result = getNetWorth([{ id: "plaid-coinbase", type: "investment", currentBalance: 100, institutionName: "Coinbase" }], [{ accountId: "coinbase:wallet", institutionName: "Coinbase", type: "cryptocurrency", value: 100 }]);
  assert.equal(result.assets, 100);
});

test("recurring predictions require regular cadence, stable amounts and recent activity", () => {
  const bill = ["2026-07-28", "2026-08-28", "2026-09-28"].map((date) => transaction({ date, name: "Internet", category: "Subscriptions", amount: 60 }));
  const shopping = ["2026-09-01", "2026-09-09", "2026-09-27"].map((date) => transaction({ date, name: "Store", amount: 40 }));
  const old = ["2026-01-01", "2026-02-01", "2026-03-01"].map((date) => transaction({ date, name: "Cancelled", amount: 20 }));
  const result = detectRecurring([...bill, ...shopping, ...old], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].cadence, "Monthly");
  assert.equal(result[0].nextDate, "2026-10-28");
  assert.equal(result[0].monthlyAmount, 60);
});

test("recurring month-end estimates clamp to the next month's real final day", () => {
  const rows = ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"].map((date) => transaction({ date, name: "Monthly", amount: 20 }));
  assert.equal(detectRecurring(rows, new Date(2027, 0, 1, 12))[0].nextDate, "2027-01-31");
});
