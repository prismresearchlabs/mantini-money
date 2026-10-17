import assert from "node:assert/strict";
import test from "node:test";
import { getSpendingGuide, resolveMonthlyBudget } from "../src/lib/spending-guide.ts";

const accounts = [
  { id: "buffer", name: "Buffer", type: "depository", subtype: "checking", currentBalance: 5106.14, currency: "USD" },
  { id: "personal", name: "Personal", type: "depository", subtype: "savings", currentBalance: 150134.11, currency: "USD" },
  { id: "tax", name: "Tax", type: "depository", subtype: "savings", currentBalance: 65109.15, currency: "USD" },
  { id: "card", name: "Discover", type: "credit", currentBalance: 24.74, currency: "USD" },
];
const transaction = (values = {}) => ({ accountId: "buffer", date: "2026-10-04", amount: 100, pending: false, flowType: "spending", currency: "USD", ...values });
const guide = (rows = [], balances = accounts, monthlyBudget = 10000, month = "2026-10") => getSpendingGuide(balances, rows, ["tax"], { monthlyBudget, month });
const balances = (changes) => accounts.map((account) => ({ ...account, ...changes[account.id] }));

test("screenshot regression: fully saving a draw does not impose the old $102.12 income fallback", () => {
  const result = guide([
    transaction({ amount: -48500, flowType: "income" }),
    transaction({ amount: 48500, flowType: "savings" }),
    transaction({ accountId: "personal", amount: -48500, flowType: "savings" }),
  ]);
  assert.equal(result.remaining, 5081.40);
  assert.equal(result.spendingCash, 5106.14);
  assert.equal(result.protectedCash, 150134.11);
  assert.equal(result.cardBalances, 24.74);
  assert.equal(result.available, true);
});

test("spending room is unchanged by draw posting month, no current income, or month rollover", () => {
  const september = guide([transaction({ amount: -48500, flowType: "income", date: "2026-09-30" })]);
  const october = guide([transaction({ amount: -48500, flowType: "income", date: "2026-10-01" })]);
  assert.deepEqual(september, october);
  assert.deepEqual(october, guide());
});

test("pending debit purchases reduce room once as they post, including prior-month pending entries", () => {
  const pending = guide([transaction({ pending: true, date: "2026-09-30" })]);
  const posted = guide([transaction()], balances({ buffer: { currentBalance: 5006.14 } }));
  assert.equal(pending.remaining, 4981.40);
  assert.equal(posted.remaining, pending.remaining);
});

test("card purchases and subsequent card payments do not deduct consumption twice", () => {
  const pending = guide([transaction({ accountId: "card", pending: true })]);
  const posted = guide([transaction({ accountId: "card" })], balances({ card: { currentBalance: 124.74 } }));
  const payment = guide([
    transaction({ amount: 124.74, flowType: "credit_payment" }),
    transaction({ accountId: "card", amount: -124.74, flowType: "credit_payment" }),
  ], balances({ card: { currentBalance: 0 }, buffer: { currentBalance: 4981.40 } }));
  assert.equal(pending.remaining, 4981.40);
  assert.equal(posted.remaining, pending.remaining);
  assert.equal(payment.remaining, posted.remaining);
  assert.equal(guide([transaction({ flowType: "credit_payment", pending: true })]).remaining, guide().remaining);
});

test("savings top-ups change funded money only after posting, while pending withdrawals reserve cash", () => {
  const futureTopUp = [transaction({ amount: -1000, pending: true, flowType: "transfer" })];
  assert.equal(guide(futureTopUp).remaining, 5081.40);
  assert.equal(guide([], balances({ buffer: { currentBalance: 6106.14 }, personal: { currentBalance: 149134.11 } })).remaining, 6081.40);
  assert.equal(guide([transaction({ amount: 1000, pending: true, flowType: "savings" })]).remaining, 4081.40);
  assert.equal(guide([transaction({ accountId: "tax", pending: true }), transaction({ accountId: "personal", pending: true })]).remaining, 5081.40);
});

test("tax checking and investments never become spending accounts", () => {
  const result = guide([], [...balances({ tax: { subtype: "checking" } }), { id: "broker", name: "Brokerage", type: "investment", currentBalance: 100000 }]);
  assert.deepEqual(result.spendingAccountNames, ["Buffer"]);
  assert.equal(result.remaining, 5081.40);
});

test("missing balances, non-USD accounts, and no checking do not report spendable money", () => {
  for (const rows of [balances({ buffer: { currentBalance: null } }), balances({ card: { currentBalance: NaN } }), balances({ card: { currency: "EUR" } }), accounts.filter((account) => account.id !== "buffer")]) {
    assert.equal(guide([], rows).available, false);
    assert.equal(guide([], rows).remaining, 0);
  }
});

test("overdrafts and obligations produce a shortfall, and overpaid cards do not create cash", () => {
  const result = guide([], balances({ buffer: { currentBalance: -100 } }));
  assert.equal(result.remaining, 0);
  assert.equal(result.shortfall, 124.74);
  assert.equal(guide([], balances({ card: { currentBalance: -1000 } })).remaining, 5106.14);
});


test("the chosen $5000 monthly budget is the limit when checking has enough funding", () => {
  const result = guide([], accounts, 5000);
  assert.equal(result.remaining, 5000);
  assert.equal(result.fundedCash, 5081.40);
  assert.equal(result.budgetRemaining, 5000);
  assert.equal(resolveMonthlyBudget(), 5000);
  assert.equal(resolveMonthlyBudget("0"), 0);
  assert.equal(resolveMonthlyBudget("-1"), 5000);
  assert.equal(resolveMonthlyBudget("not a number"), 5000);
});

test("$3000 monthly spending leaves $2000 and topping up checking does not reset the budget", () => {
  const purchases = [transaction({ amount: 3000 })];
  const before = guide(purchases, balances({ buffer: { currentBalance: 2106.14 } }), 5000);
  const after = guide(purchases, accounts, 5000);
  assert.equal(before.remaining, 2000);
  assert.equal(after.remaining, 2000);
  assert.equal(after.usedPercent, 60);
});

test("funding caps the budget and monthly pending purchases are counted once against each limit", () => {
  const result = guide([transaction({ amount: 3000 }), transaction({ amount: 500, pending: true })], balances({ buffer: { currentBalance: 1000 } }), 5000);
  assert.equal(result.budgetRemaining, 1500);
  assert.equal(result.fundedCash, 475.26);
  assert.equal(result.remaining, 475.26);
  const posted = guide([transaction({ amount: 3500 })], balances({ buffer: { currentBalance: 500 } }), 5000);
  assert.equal(posted.remaining, result.remaining);
  assert.equal(posted.budgetRemaining, result.budgetRemaining);
});

test("monthly allowance resets without rollover and income, transfers, taxes and card payments do not consume it", () => {
  const rows = [transaction({ amount: 3000, date: "2026-09-30" }), ...["income", "savings", "taxes", "credit_payment", "transfer", "investment"].map((flowType) => transaction({ amount: 100, flowType }))];
  assert.equal(guide(rows, accounts, 5000, "2026-09").budgetRemaining, 2000);
  assert.equal(guide(rows, accounts, 5000, "2026-10").budgetRemaining, 5000);
  assert.equal(guide([transaction({ amount: 6000 })], accounts, 5000).remaining, 0);
  assert.equal(guide([], accounts, 0).remaining, 0);
});
