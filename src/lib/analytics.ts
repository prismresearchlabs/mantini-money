/** Shared financial calculations. This module deliberately has no server or browser dependencies. */
export type DatePreset = "month" | "last-month" | "3-months" | "ytd" | "all";
export type BreakdownMode = "group" | "category" | "merchant";
export type AnalyticsTransaction = {
  id: string;
  accountId: string;
  date: string;
  name: string;
  amount: number;
  pending: boolean;
  category: string;
  categorySource?: string;
  flowType: string;
};

export type DateRange = {
  start: string;
  end: string;
  label: string;
  comparisonLabel: string;
  previousStart: string;
  previousEnd: string;
};

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "3-months", label: "Last 3 months" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

export const CHART_COLORS = ["#2d8067", "#e3a653", "#7b8bc5", "#cd8b7a", "#7ca89d", "#a799c7", "#6689a5", "#b8aa86", "#87928e", "#baa29b"];

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateKey(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function localDay(date: Date) {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function offsetDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dayDistance(start: string, end: string) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
}

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** Move period navigation without rolling a month-end into a different month. */
export function getPeriodAnchor(preset: DatePreset, monthOffset: number, now = new Date()) {
  if (!monthOffset || preset === "all") return new Date(now);
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1, 12);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  // Previous YTD views preserve the same cutoff day, including across leap years.
  return new Date(first.getFullYear(), first.getMonth(), preset === "ytd" ? Math.min(now.getDate(), lastDay) : lastDay, 12);
}

export function getDateRange(
  preset: DatePreset,
  transactions: readonly { date: string }[] = [],
  now = new Date(),
): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = localDay(now);
  let start = dateKey(year, month, 1);
  let end = today;
  let previousStart = dateKey(year, month - 1, 1);
  let previousEnd = dateKey(year, month - 1, Math.min(now.getDate(), new Date(year, month, 0).getDate()));
  let comparisonLabel = "vs. the same days last month";

  if (preset === "last-month") {
    start = dateKey(year, month - 1, 1);
    end = dateKey(year, month, 0);
    previousStart = dateKey(year, month - 2, 1);
    previousEnd = dateKey(year, month - 1, 0);
    comparisonLabel = "vs. the previous month";
  } else if (preset === "3-months") {
    start = dateKey(year, month - 2, 1);
    previousStart = dateKey(year, month - 5, 1);
    previousEnd = offsetDay(start, -1);
    comparisonLabel = "vs. the previous 3 months";
  } else if (preset === "ytd") {
    start = dateKey(year, 0, 1);
    previousStart = dateKey(year - 1, 0, 1);
    previousEnd = dateKey(year - 1, month, Math.min(now.getDate(), new Date(year - 1, month + 1, 0).getDate()));
    comparisonLabel = "vs. the same period last year";
  } else if (preset === "all") {
    start = transactions.map((row) => row.date).filter((date) => validDay(date) && date <= today).sort()[0] ?? today;
    previousEnd = offsetDay(start, -1);
    previousStart = offsetDay(previousEnd, -dayDistance(start, end));
    comparisonLabel = "No earlier imported history";
  }
  const format = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { start, end, label: `${format(start)} – ${format(end)}`, comparisonLabel, previousStart, previousEnd };
}

export function filterTransactions<T extends { date: string }>(transactions: readonly T[], range: Pick<DateRange, "start" | "end">) {
  return transactions.filter((row) => validDay(row.date) && row.date >= range.start && row.date <= range.end);
}

export function categoryGroup(category: string) {
  if (["Groceries", "Dining"].includes(category)) return "Food & dining";
  if (["Housing", "Subscriptions", "Fees"].includes(category)) return "Home & bills";
  if (["Transportation", "Travel"].includes(category)) return "Transport & travel";
  if (["Health & Fitness", "Personal Care"].includes(category)) return "Health & personal";
  if (["Shopping", "Entertainment"].includes(category)) return "Shopping & lifestyle";
  if (["Education", "Business"].includes(category)) return "Work & education";
  if (category === "Taxes") return "Taxes";
  if (category === "Gifts & Donations") return "Giving";
  return category === "Other" || !category ? "Uncategorized" : category;
}

export function isExpense(transaction: Pick<AnalyticsTransaction, "flowType" | "amount">) {
  return transaction.amount > 0 && ["spending", "taxes"].includes(transaction.flowType);
}

export function transactionNeedsReview(transaction: Pick<AnalyticsTransaction, "category" | "categorySource">) {
  return ["Other", "Uncategorized", ""].includes(transaction.category) && transaction.categorySource !== "manual";
}

export type TransferMatchRow = {
  transaction_id: string;
  account_id: string;
  account_name: string;
  account_mask?: string | null;
  account_type: string;
  account_subtype?: string | null;
  institution_name: string;
  transaction_date: string;
  name: string;
  amount: number;
  pending: number | boolean;
  category_primary: string | null;
  category_detailed?: string | null;
};

/** Reconcile both sides before trusting provider categories, which can mislabel owned-account transfers. */
export function matchInternalTransfers(rows: readonly TransferMatchRow[]) {
  const matches = new Map<string, "transfer" | "savings" | "credit_payment">();
  const usedInflows = new Set<string>();
  const inflows = rows.filter((row) => row.amount < 0 && !row.pending);
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const explicitMove = (value: string) => /^(deposit from|withdrawal to|(?:online )?transfer (?:from|to))\b/i.test(value);
  const namesCounterpart = (description: string, account: TransferMatchRow) => {
    const name = normalized(account.account_name);
    const words = ` ${normalized(description)} `;
    return (name.length >= 3 && words.includes(` ${name} `)) || Boolean(account.account_mask && new RegExp(`\\b${account.account_mask}\\b`).test(description));
  };
  for (const outgoing of rows.filter((row) => row.amount > 0 && !row.pending)) {
    const candidates = inflows.flatMap((incoming) => {
      if (usedInflows.has(incoming.transaction_id) || incoming.account_id === outgoing.account_id || Math.abs(-incoming.amount - outgoing.amount) >= 0.01) return [];
      const distance = Math.abs(dayDistance(outgoing.transaction_date, incoming.transaction_date));
      if (!Number.isFinite(distance) || distance > 3) return [];
      const cardPayment = incoming.account_type === "credit" &&
        ["TRANSFER_OUT", "LOAN_PAYMENTS"].includes(outgoing.category_primary ?? "") &&
        (incoming.category_primary === "TRANSFER_IN" || /payment|autopay/i.test(`${incoming.name} ${incoming.category_detailed ?? ""}`));
      const metadataPair = outgoing.category_primary === "TRANSFER_OUT" && incoming.category_primary === "TRANSFER_IN";
      const outgoingLooksLikeMove = explicitMove(outgoing.name) || outgoing.category_primary === "TRANSFER_OUT";
      const incomingLooksLikeMove = explicitMove(incoming.name) || incoming.category_primary === "TRANSFER_IN";
      const namedPair = outgoingLooksLikeMove && incomingLooksLikeMove &&
        ((explicitMove(outgoing.name) && namesCounterpart(outgoing.name, incoming)) || (explicitMove(incoming.name) && namesCounterpart(incoming.name, outgoing)));
      // Banks can keep old account aliases in descriptions after users rename accounts.
      const renamedAccountPair = incoming.institution_name === outgoing.institution_name &&
        incoming.account_type === "depository" && outgoing.account_type === "depository" &&
        explicitMove(outgoing.name) && explicitMove(incoming.name) &&
        (incoming.category_primary === "TRANSFER_IN" || outgoing.category_primary === "TRANSFER_OUT");
      if (!cardPayment && !metadataPair && !namedPair && !renamedAccountPair) return [];
      return [{ incoming, distance, score: (cardPayment ? 8 : 0) + (namedPair ? 4 : 0) + (metadataPair ? 2 : 0) + (renamedAccountPair ? 1 : 0) }];
    }).sort((a, b) => b.score - a.score || a.distance - b.distance);
    const best = candidates[0];
    if (!best || (candidates[1]?.score === best.score && candidates[1].distance === best.distance)) continue;
    const incoming = best.incoming;
    usedInflows.add(incoming.transaction_id);
    const flow = incoming.account_type === "credit" ? "credit_payment"
      : incoming.account_subtype === "savings" || /irs|tax|saving/i.test(incoming.account_name) ? "savings" : "transfer";
    matches.set(outgoing.transaction_id, flow);
    matches.set(incoming.transaction_id, flow);
  }
  return matches;
}

function summarize(transactions: readonly AnalyticsTransaction[]) {
  let income = 0, spending = 0, taxes = 0, refunds = 0, transfers = 0, cardPayments = 0, invested = 0, saved = 0, pendingSpending = 0;
  for (const transaction of transactions) {
    if (!Number.isFinite(transaction.amount)) continue;
    const { amount, flowType } = transaction;
    if (transaction.pending) {
      if (isExpense(transaction)) pendingSpending += amount;
      continue;
    }
    if (isExpense(transaction)) spending += amount;
    if (flowType === "income" && amount < 0) income -= amount;
    if (flowType === "refund" && amount < 0) refunds -= amount;
    if (flowType === "taxes" && amount > 0) taxes += amount;
    if (flowType === "transfer" && amount > 0) transfers += amount;
    if (flowType === "credit_payment" && amount > 0) cardPayments += amount;
    if (flowType === "investment" && amount > 0) invested += amount;
    if (flowType === "savings" && amount > 0) saved += amount;
  }
  // Refunds are reported separately from gross spending and are included once in net cash flow.
  const net = income + refunds - spending;
  return {
    income: roundMoney(income), spending: roundMoney(spending), taxes: roundMoney(taxes), refunds: roundMoney(refunds),
    net: roundMoney(net), savingsRate: income > 0 ? roundMoney((net / income) * 100) : null,
    transfers: roundMoney(transfers), cardPayments: roundMoney(cardPayments), invested: roundMoney(invested),
    saved: roundMoney(saved), pendingSpending: roundMoney(pendingSpending),
  };
}

export type BreakdownEntry = { name: string; value: number; count: number; percent: number; color: string };

function makeBreakdown(transactions: readonly AnalyticsTransaction[], mode: BreakdownMode): BreakdownEntry[] {
  const values = new Map<string, { value: number; count: number }>();
  for (const transaction of transactions) {
    if (!Number.isFinite(transaction.amount)) continue;
    const name = mode === "merchant" ? transaction.name : mode === "group" ? categoryGroup(transaction.category) : transaction.category || "Uncategorized";
    const previous = values.get(name) ?? { value: 0, count: 0 };
    values.set(name, { value: previous.value + Math.abs(transaction.amount), count: previous.count + 1 });
  }
  const total = [...values.values()].reduce((sum, value) => sum + value.value, 0);
  return [...values.entries()].sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0])).map(([name, entry], index) => ({
    name, value: roundMoney(entry.value), count: entry.count, percent: total > 0 ? roundMoney(entry.value / total * 100) : 0,
    color: CHART_COLORS[index % CHART_COLORS.length],
  }));
}

export function analyzeTransactions<T extends AnalyticsTransaction>(
  transactions: readonly T[], range: DateRange, groupBy: BreakdownMode = "category",
) {
  const selected = filterTransactions(transactions, range);
  const posted = selected.filter((transaction) => !transaction.pending);
  const pending = selected.filter((transaction) => transaction.pending);
  const previous = filterTransactions(transactions, { start: range.previousStart, end: range.previousEnd });
  const totals = summarize(selected);
  const previousTotals = summarize(previous);
  const earliestDate = transactions.map((transaction) => transaction.date).filter(validDay).sort()[0];
  const hasComparison = Boolean(earliestDate && earliestDate <= range.previousStart);
  const percentChange = (current: number, last: number) => hasComparison && last > 0 ? roundMoney((current - last) / last * 100) : null;
  const months = new Map<string, { income: number; spending: number; refunds: number }>();
  const first = new Date(`${range.start.slice(0, 7)}-01T12:00:00Z`);
  const lastKey = range.end.slice(0, 7);
  for (let index = 0; index < 1200 && first.toISOString().slice(0, 7) <= lastKey; index++) {
    months.set(first.toISOString().slice(0, 7), { income: 0, spending: 0, refunds: 0 });
    first.setUTCMonth(first.getUTCMonth() + 1);
  }
  for (const transaction of posted) {
    if (!Number.isFinite(transaction.amount)) continue;
    const current = months.get(transaction.date.slice(0, 7));
    if (!current) continue;
    if (isExpense(transaction)) current.spending += transaction.amount;
    if (transaction.flowType === "income" && transaction.amount < 0) current.income -= transaction.amount;
    if (transaction.flowType === "refund" && transaction.amount < 0) current.refunds -= transaction.amount;
  }
  return {
    transactions: selected, posted, pending, totals, previousTotals, hasComparison,
    spendingChange: percentChange(totals.spending, previousTotals.spending),
    incomeChange: percentChange(totals.income, previousTotals.income),
    breakdown: makeBreakdown(posted.filter(isExpense), groupBy),
    incomeBreakdown: makeBreakdown(posted.filter((transaction) => transaction.flowType === "income" && transaction.amount < 0), "merchant"),
    monthlyTrend: [...months.entries()].map(([key, entry]) => ({
      key, label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
      income: roundMoney(entry.income), spending: roundMoney(entry.spending), net: roundMoney(entry.income + entry.refunds - entry.spending),
    })),
    averageMonthlySpending: roundMoney(totals.spending / Math.max(1, months.size)),
    transactionCount: selected.length,
    reviewCount: selected.filter(transactionNeedsReview).length,
  };
}

export type NetWorthAccount = { id: string; type: string; currentBalance: number | null; currency?: string | null; institutionName?: string };
export type NetWorthHolding = { accountId: string; value: number; type: string | null; institutionName?: string; currency?: string | null };

export function isFreshObservation(value: string | null, now = new Date()) {
  if (!value) return false;
  // SQLite CURRENT_TIMESTAMP is UTC but is stored without a zone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const age = now.getTime() - Date.parse(normalized);
  return Number.isFinite(age) && age >= -60_000 && age <= 48 * 60 * 60 * 1000;
}

export function getNetWorth(accounts: readonly NetWorthAccount[], holdings: readonly NetWorthHolding[]) {
  const allAccountIds = new Set(accounts.map((account) => account.id));
  const representedAccounts = new Set<string>();
  const fallbackAccounts = new Set<string>();
  let cash = 0, investments = 0, crypto = 0, otherAssets = 0, liabilities = 0, missingBalances = 0, unsupportedCurrencies = 0;
  const addAsset = (value: number, bucket: "cash" | "investments" | "crypto" | "other") => {
    if (value < 0) { liabilities -= value; return; }
    if (bucket === "cash") cash += value;
    else if (bucket === "investments") investments += value;
    else if (bucket === "crypto") crypto += value;
    else otherAssets += value;
  };
  for (const account of accounts) {
    if (account.currency && account.currency !== "USD") { unsupportedCurrencies++; representedAccounts.add(account.id); continue; }
    if (account.currentBalance === null || !Number.isFinite(account.currentBalance)) {
      // Holdings can supply an observed investment value if its account balance is unavailable.
      if (account.type === "investment" && holdings.some((holding) => holding.accountId === account.id && Number.isFinite(holding.value))) fallbackAccounts.add(account.id);
      else missingBalances++;
      continue;
    }
    representedAccounts.add(account.id);
    if (["credit", "loan"].includes(account.type)) {
      if (account.currentBalance >= 0) liabilities += account.currentBalance;
      else otherAssets -= account.currentBalance;
    } else {
      addAsset(account.currentBalance, account.type === "depository" ? "cash" : account.type === "investment" ? "investments" : "other");
    }
  }
  const externalInstitutionsWithPlaidBalances = new Set(accounts.filter((account) => representedAccounts.has(account.id)).map((account) => account.institutionName?.trim().toLowerCase()).filter(Boolean));
  for (const holding of holdings) {
    if (!Number.isFinite(holding.value) || representedAccounts.has(holding.accountId)) continue;
    if (holding.currency && holding.currency !== "USD") { unsupportedCurrencies++; continue; }
    if (allAccountIds.has(holding.accountId) && !fallbackAccounts.has(holding.accountId)) continue;
    // A directly connected exchange already represented by a Plaid account is counted once.
    if (!fallbackAccounts.has(holding.accountId) && /^(coinbase|kraken)(:|$)/i.test(holding.accountId) && externalInstitutionsWithPlaidBalances.has(holding.institutionName?.trim().toLowerCase())) continue;
    addAsset(holding.value, holding.type === "cryptocurrency" ? "crypto" : holding.type === "cash" ? "cash" : "investments");
  }
  const assets = cash + investments + crypto + otherAssets;
  return {
    assets: roundMoney(assets), liabilities: roundMoney(liabilities), netWorth: roundMoney(assets - liabilities),
    cash: roundMoney(cash), investments: roundMoney(investments), crypto: roundMoney(crypto), otherAssets: roundMoney(otherAssets),
    missingBalances, unsupportedCurrencies,
    allocation: [
      { name: "Cash", value: roundMoney(cash), color: CHART_COLORS[0] },
      { name: "Investments", value: roundMoney(investments), color: CHART_COLORS[2] },
      { name: "Crypto", value: roundMoney(crypto), color: CHART_COLORS[1] },
      { name: "Other assets", value: roundMoney(otherAssets), color: CHART_COLORS[3] },
    ].filter((entry) => entry.value > 0),
  };
}

export function detectRecurring(transactions: readonly AnalyticsTransaction[], now = new Date()) {
  const today = localDay(now);
  const groups = new Map<string, AnalyticsTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.pending || !isExpense(transaction) || !validDay(transaction.date) || transaction.date > today || !Number.isFinite(transaction.amount)) continue;
    const key = `${transaction.accountId}:${transaction.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    groups.set(key, [...(groups.get(key) ?? []), transaction]);
  }
  const recurring = [];
  for (const values of groups.values()) {
    const rows = values.toSorted((a, b) => a.date.localeCompare(b.date)).slice(-6);
    if (rows.length < 3) continue;
    const intervals = rows.slice(1).map((row, index) => dayDistance(rows[index].date, row.date));
    const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const cadence = averageInterval >= 6 && averageInterval <= 8 ? "Weekly" : averageInterval >= 12 && averageInterval <= 16 ? "Every 2 weeks" : averageInterval >= 26 && averageInterval <= 35 ? "Monthly" : null;
    if (!cadence || intervals.some((interval) => Math.abs(interval - averageInterval) > (cadence === "Monthly" ? 5 : 2))) continue;
    const averageAmount = rows.reduce((sum, row) => sum + row.amount, 0) / rows.length;
    if (rows.some((row) => Math.abs(row.amount - averageAmount) > Math.max(2, averageAmount * 0.15))) continue;
    const latest = rows.at(-1)!;
    if (dayDistance(latest.date, today) > averageInterval * 1.6) continue;
    let nextDate: string;
    if (cadence === "Monthly") {
      const last = new Date(`${latest.date}T12:00:00Z`);
      const nextYear = last.getUTCFullYear(), nextMonth = last.getUTCMonth() + 1;
      nextDate = dateKey(nextYear, nextMonth, Math.min(last.getUTCDate(), new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate()));
    } else nextDate = offsetDay(latest.date, cadence === "Weekly" ? 7 : 14);
    recurring.push({ name: latest.name, amount: roundMoney(averageAmount), monthlyAmount: roundMoney(averageAmount * (cadence === "Weekly" ? 52 / 12 : cadence === "Every 2 weeks" ? 26 / 12 : 1)), cadence, nextDate, lastDate: latest.date, accountId: latest.accountId, category: latest.category, count: rows.length });
  }
  return recurring.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || b.amount - a.amount);
}
