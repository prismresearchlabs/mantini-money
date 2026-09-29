import { automaticSpendingCategory, merchantKey } from "@/lib/categories";
import { getNetWorth, isFreshObservation, matchInternalTransfers } from "@/lib/analytics";
import { getCoinbasePortfolio } from "@/lib/coinbase";
import { execute, queryRows } from "@/lib/db";
import { getKrakenPortfolio } from "@/lib/kraken";
import { buildReserveAwareCashHistory, getReserveAwareCash, resolveTaxReserve, taxReserveScopeKey } from "@/lib/tax-reserve";
import { taxEstimateInputSchema, type TaxEstimateInput } from "@/lib/tax-estimate";

type AccountRow = {
  account_id: string;
  item_id: string;
  institution_name: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  minimum_payment: number | null;
  next_payment_due_date: string | null;
  currency: string;
  updated_at: string;
};

type TransactionRow = {
  transaction_id: string;
  account_id: string;
  institution_name: string;
  account_name: string;
  account_mask: string | null;
  account_type: string;
  account_subtype: string | null;
  transaction_date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  pending: number;
  category_primary: string | null;
  category_detailed: string | null;
  user_category: string | null;
  currency: string;
};

type RuleRow = { merchant_key: string; category: string };

type HoldingRow = {
  account_id: string;
  account_name: string;
  institution_name: string;
  security_id: string;
  security_name: string | null;
  ticker_symbol: string | null;
  security_type: string | null;
  security_subtype: string | null;
  quantity: number;
  institution_price: number | null;
  institution_value: number;
  cost_basis: number | null;
  unofficial_currency_code: string | null;
  update_datetime: string | null;
  currency: string | null;
};

export type FlowType =
  | "spending"
  | "income"
  | "investment"
  | "savings"
  | "credit_payment"
  | "transfer"
  | "refund"
  | "taxes";

type Classification = { flowType: FlowType; flowLabel: string };

const flowLabels: Record<FlowType, string> = {
  spending: "Spending",
  income: "Income",
  investment: "Investment",
  savings: "Savings",
  credit_payment: "Card payment",
  transfer: "Transfer",
  refund: "Refund",
  taxes: "Taxes",
};

const flowCategories: Record<Exclude<FlowType, "spending">, string> = {
  income: "Income",
  investment: "Investment",
  savings: "Savings",
  credit_payment: "Card Payment",
  transfer: "Transfer",
  refund: "Refund",
  taxes: "Taxes",
};

function matchedTransfers(rows: TransactionRow[]) {
  return new Map([...matchInternalTransfers(rows)].map(([id, flowType]) => [id, { flowType, flowLabel: flowLabels[flowType] }]));
}

function classifyTransaction(row: TransactionRow, matches: Map<string, Classification>) {
  const matched = matches.get(row.transaction_id);
  if (matched) return matched;

  const description = `${row.merchant_name ?? ""} ${row.name}`;
  const detail = row.category_detailed ?? "";
  let flowType: FlowType;

  if (row.amount < 0) {
    if (row.category_primary === "INCOME") flowType = "income";
    else if (row.category_primary === "TRANSFER_IN") flowType = "transfer";
    else flowType = "refund";
  } else if (row.category_primary === "LOAN_PAYMENTS") {
    // Mortgage, auto and student-loan payments remain expenses. Only credit-card
    // payments duplicate purchases already present in card transactions.
    flowType = /CREDIT_CARD/.test(detail) || /credit card|card payment|cc payment/i.test(description)
      ? "credit_payment"
      : "spending";
  } else if (row.category_primary === "TRANSFER_OUT") {
    flowType = /coinbase|kraken|crypto|wire withdrawal/i.test(`${description} ${detail}`)
      ? "investment"
      : "transfer";
  } else if (row.category_primary === "GOVERNMENT_AND_NON_PROFIT") {
    flowType = /irs|tax/i.test(description) ? "taxes" : "spending";
  } else {
    flowType = "spending";
  }

  return { flowType, flowLabel: flowLabels[flowType] };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

const MINIMUM_DISPLAY_HOLDING_VALUE = 1;
const HIDDEN_HOLDING_NAME_PARTS = [
  "fidelity hereford street trust - fidelity government money market fund usd mnt",
];

function isHiddenHolding(name: string) {
  const normalizedName = name.trim().toLowerCase();
  return HIDDEN_HOLDING_NAME_PARTS.some((part) => normalizedName.includes(part));
}

export async function getDashboardData() {
  const [accounts, transactionRows, items, categoryRules, holdingRows, coinbasePortfolio, krakenPortfolio, taxSettings] = await Promise.all([
    queryRows<AccountRow>(`
      SELECT a.*, i.institution_name, l.minimum_payment, l.next_payment_due_date
      FROM accounts a
      JOIN plaid_items i ON i.item_id = a.item_id
      LEFT JOIN credit_liabilities l ON l.account_id = a.account_id
      ORDER BY i.institution_name, a.name
    `),
    queryRows<TransactionRow>(`
      SELECT t.*, a.name AS account_name, a.mask AS account_mask,
             a.type AS account_type, a.subtype AS account_subtype, i.institution_name
      FROM transactions t
      JOIN accounts a ON a.account_id = t.account_id
      JOIN plaid_items i ON i.item_id = a.item_id
      ORDER BY t.transaction_date DESC, t.updated_at DESC
    `),
    queryRows<{
      item_id: string;
      institution_name: string;
      status: string;
      error_message: string | null;
      updated_at: string;
    }>("SELECT item_id, institution_name, status, error_message, updated_at FROM plaid_items ORDER BY institution_name"),
    queryRows<RuleRow>("SELECT merchant_key, category FROM merchant_category_rules"),
    queryRows<HoldingRow>(`
      SELECT h.account_id, a.name AS account_name, i.institution_name,
             h.security_id, s.name AS security_name, s.ticker_symbol,
             s.type AS security_type, s.subtype AS security_subtype,
             h.quantity, h.institution_price, h.institution_value,
             h.cost_basis, h.unofficial_currency_code, h.currency, s.update_datetime
      FROM investment_holdings h
      JOIN investment_securities s ON s.security_id = h.security_id
      JOIN accounts a ON a.account_id = h.account_id
      JOIN plaid_items i ON i.item_id = a.item_id
      ORDER BY h.institution_value DESC
    `),
    getCoinbasePortfolio(),
    getKrakenPortfolio(),
    queryRows<{ key: string; value: string }>(
      "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
      ["tax_account_ids", "tax_scenario_2026"],
    ),
  ]);

  const rules = new Map(categoryRules.map((rule) => [rule.merchant_key, rule.category]));
  const transferMatches = matchedTransfers(transactionRows);
  const classified = transactionRows.map((transaction) => {
    const classification = classifyTransaction(transaction, transferMatches);
    const displayName = transaction.merchant_name || transaction.name;
    const learnedCategory = rules.get(merchantKey(displayName));
    const automaticCategory = classification.flowType === "spending"
      ? automaticSpendingCategory({
          name: displayName,
          primary: transaction.category_primary,
          detailed: transaction.category_detailed,
        })
      : flowCategories[classification.flowType];
    const category = transaction.user_category || learnedCategory || automaticCategory;
    return {
      ...transaction,
      ...classification,
      displayName,
      category,
      categorySource: transaction.user_category
        ? "manual"
        : learnedCategory
          ? "learned"
          : "automatic",
    };
  });

  const now = new Date();
  const settings = new Map(taxSettings.map((setting) => [setting.key, setting.value]));
  const reserveAccounts = accounts.map((account) => ({
    id: account.account_id,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    currentBalance: account.current_balance === null ? null : Number(account.current_balance),
    currency: account.currency,
  }));
  const reserve = resolveTaxReserve(reserveAccounts, settings.get("tax_account_ids"));
  const taxAccountIds = new Set(reserve.accountIds);
  const reserveRows = accounts.filter((account) => taxAccountIds.has(account.account_id));
  const reserveItemIds = new Set(reserveRows.map((account) => account.item_id));
  const taxReserve = {
    ...reserve,
    reliable: reserve.missingBalances === 0 && reserve.unsupportedCurrencies === 0 && !reserve.invalidSetting &&
      reserveRows.every((account) => isFreshObservation(account.updated_at, now)) &&
      items.filter((item) => reserveItemIds.has(item.item_id)).every((item) => item.status === "healthy"),
  };
  let taxScenario: TaxEstimateInput | null = null;
  try {
    const parsed = taxEstimateInputSchema.safeParse(JSON.parse(settings.get("tax_scenario_2026") ?? "null"));
    if (parsed.success) taxScenario = parsed.data;
  } catch { /* A missing or malformed saved scenario must not break the dashboard. */ }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const currentMonth = classified.filter((transaction) => transaction.transaction_date >= monthStart && !transaction.pending);
  const currentPending = classified.filter((transaction) => transaction.transaction_date >= monthStart && transaction.pending);
  const previousMonth = classified.filter(
    (transaction) =>
      transaction.transaction_date >= previousMonthStart &&
      transaction.transaction_date < monthStart &&
      !transaction.pending,
  );

  const outflow = (values: typeof classified, type: FlowType) =>
    values
      .filter((transaction) => transaction.flowType === type && transaction.amount > 0)
      .reduce((total, transaction) => total + transaction.amount, 0);
  const inflow = (values: typeof classified, type: FlowType) =>
    Math.abs(
      values
        .filter((transaction) => transaction.flowType === type && transaction.amount < 0)
        .reduce((total, transaction) => total + transaction.amount, 0),
    );

  const monthSpend = outflow(currentMonth, "spending");
  const monthPendingSpend = outflow(currentPending, "spending");
  const monthIncome = inflow(currentMonth, "income");
  const monthInvested = outflow(currentMonth, "investment");
  const monthSaved = outflow(currentMonth, "savings");
  const monthTaxes = outflow(currentMonth, "taxes");
  const monthCreditPayments = outflow(currentMonth, "credit_payment");
  const monthTransfers = outflow(currentMonth, "transfer");
  const monthRefunds = inflow(currentMonth, "refund");
  const previousMonthSpend = outflow(previousMonth, "spending");

  const categoryTotals = new Map<string, number>();
  for (const transaction of currentMonth.filter(
    (value) => value.flowType === "spending" && value.amount > 0,
  )) {
    categoryTotals.set(
      transaction.category,
      (categoryTotals.get(transaction.category) ?? 0) + transaction.amount,
    );
  }

  const monthlyTotals = new Map<string, { spending: number; income: number }>();
  for (const transaction of classified.filter((value) => !value.pending)) {
    const month = transaction.transaction_date.slice(0, 7);
    const current = monthlyTotals.get(month) ?? { spending: 0, income: 0 };
    if (transaction.flowType === "spending" && transaction.amount > 0) current.spending += transaction.amount;
    if (transaction.flowType === "income" && transaction.amount < 0) current.income += Math.abs(transaction.amount);
    monthlyTotals.set(month, current);
  }

  const pendingByAccount = new Map<string, number>();
  for (const transaction of classified.filter((value) => value.pending)) {
    pendingByAccount.set(
      transaction.account_id,
      (pendingByAccount.get(transaction.account_id) ?? 0) + transaction.amount,
    );
  }

  const { totalCash, grossCash, nonTaxSavings: reservedCash } = getReserveAwareCash(reserveAccounts, reserve.accountIds);
  const recentMonthlySpend = Math.max(monthSpend, previousMonthSpend);
  // Tax funds are already outside totalCash. Protect only the remaining savings here.
  const protectedCash = Math.max(0, Math.min(totalCash, reservedCash + recentMonthlySpend * 3));
  const postReserveIncome = Math.max(0, monthIncome - monthSaved);
  const incomeAllowance = postReserveIncome > 0
    ? postReserveIncome * 0.1
    : Math.max(0, totalCash - reservedCash) * 0.02;
  const cashCapacity = Math.max(0, totalCash - protectedCash);
  const monthlyFlexibleAllowance = Math.max(0, Math.min(incomeAllowance, cashCapacity));
  const flexibleRemaining = Math.max(0, monthlyFlexibleAllowance - monthSpend);

  const plaidHoldingAccountIds = new Set(holdingRows.map((holding) => holding.account_id));
  const portfolioHoldings = [
    ...holdingRows.map((holding) => ({
      accountId: holding.account_id,
      accountName: holding.account_name,
      institutionName: holding.institution_name,
      securityId: holding.security_id,
      name: holding.security_name || holding.ticker_symbol || "Unknown holding",
      ticker: holding.ticker_symbol,
      type: holding.security_type,
      subtype: holding.security_subtype,
      quantity: Number(holding.quantity),
      price: holding.institution_price === null ? null : Number(holding.institution_price),
      value: round(Number(holding.institution_value)),
      costBasis: holding.cost_basis === null ? null : round(Number(holding.cost_basis)),
      unofficialCurrencyCode: holding.unofficial_currency_code,
      updatedAt: holding.update_datetime,
    })),
    ...accounts
      .filter(
        (account) =>
          account.type === "investment" &&
          !plaidHoldingAccountIds.has(account.account_id) &&
          account.current_balance !== null &&
          Number(account.current_balance) > 0,
      )
      .map((account) => ({
        accountId: account.account_id,
        accountName: account.name,
        institutionName: account.institution_name,
        securityId: `account-balance:${account.account_id}`,
        name: account.name || "Investment account",
        ticker: null,
        type: "account",
        subtype: account.subtype,
        quantity: 1,
        price: null,
        value: round(Number(account.current_balance)),
        costBasis: null,
        unofficialCurrencyCode: null,
        updatedAt: null,
      })),
    ...coinbasePortfolio.holdings.map((holding) => ({
      ...holding,
      value: round(holding.value),
      price: round(holding.price),
    })),
    ...krakenPortfolio.holdings.map((holding) => ({
      ...holding,
      value: round(holding.value),
      price: round(holding.price),
    })),
  ]
    .filter(
      (holding) =>
        holding.value >= MINIMUM_DISPLAY_HOLDING_VALUE && !isHiddenHolding(holding.name),
    )
    .sort((a, b) => b.value - a.value);
  const investmentValue = portfolioHoldings.reduce((total, holding) => total + holding.value, 0);
  const holdingsWithCostBasis = portfolioHoldings.filter((holding) => holding.costBasis !== null);
  const investmentCostBasis = holdingsWithCostBasis.reduce(
    (total, holding) => total + (holding.costBasis || 0),
    0,
  );
  const portfolioInstitutions = new Map<string, number>();
  for (const holding of portfolioHoldings) {
    portfolioInstitutions.set(
      holding.institutionName,
      (portfolioInstitutions.get(holding.institutionName) ?? 0) + holding.value,
    );
  }

  const cashTrendData = buildReserveAwareCashHistory(
    totalCash,
    classified.map((transaction) => ({
      accountId: transaction.account_id,
      accountType: transaction.account_type,
      date: transaction.transaction_date,
      amount: Number(transaction.amount),
      pending: Boolean(transaction.pending),
      currency: transaction.currency,
    })),
    taxReserve.accountIds,
    now,
    reserveAccounts.filter((account) => !account.currency || account.currency === "USD"),
  );

  // Account balances already contain their holdings. Use full balances and raw
  // exchange holdings here, including assets omitted from the display table.
  const netWorth = getNetWorth(
    accounts.map((account) => ({
      id: account.account_id,
      type: account.type,
      institutionName: account.institution_name,
      currentBalance: account.current_balance === null ? null : Number(account.current_balance),
      currency: account.currency,
    })),
    [
      ...holdingRows.map((holding) => ({
        accountId: holding.account_id,
        institutionName: holding.institution_name,
        value: Number(holding.institution_value),
        type: holding.security_type,
        currency: holding.currency,
      })),
      ...coinbasePortfolio.holdings,
      ...krakenPortfolio.holdings,
    ],
  );
  const hasObservedBalances = accounts.length > 0 || coinbasePortfolio.holdings.length > 0 || krakenPortfolio.holdings.length > 0;
  const netWorthAfterTaxReserve = round(netWorth.netWorth - taxReserve.balance);
  const adjustedSnapshotScope = taxReserveScopeKey(taxReserve.accountIds);
  const contributingItemIds = new Set(accounts.map((account) => account.item_id));
  const balancesReliable = hasObservedBalances && netWorth.missingBalances === 0 && netWorth.unsupportedCurrencies === 0
    && items.filter((item) => contributingItemIds.has(item.item_id)).every((item) => item.status === "healthy")
    && accounts.every((account) => isFreshObservation(account.updated_at, now))
    && (!coinbasePortfolio.configured || (coinbasePortfolio.status === "connected" && isFreshObservation(coinbasePortfolio.updatedAt, now)))
    && (!krakenPortfolio.configured || (krakenPortfolio.status === "connected" && isFreshObservation(krakenPortfolio.updatedAt, now)));
  if (balancesReliable) {
    await execute(
      `INSERT INTO net_worth_snapshots (snapshot_date, assets, liabilities, net_worth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(snapshot_date) DO UPDATE SET
         assets = excluded.assets, liabilities = excluded.liabilities,
         net_worth = excluded.net_worth, recorded_at = CURRENT_TIMESTAMP`,
      [now.toISOString().slice(0, 10), netWorth.assets, netWorth.liabilities, netWorth.netWorth],
    );
    if (taxReserve.reliable) {
      await execute(
        `INSERT INTO tax_reserve_net_worth_snapshots (scope_key, snapshot_date, assets, liabilities, net_worth, tax_reserve)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, snapshot_date) DO UPDATE SET
           assets = excluded.assets, liabilities = excluded.liabilities,
           net_worth = excluded.net_worth, tax_reserve = excluded.tax_reserve,
           recorded_at = CURRENT_TIMESTAMP`,
        [adjustedSnapshotScope, now.toISOString().slice(0, 10), round(netWorth.assets - taxReserve.balance), netWorth.liabilities, netWorthAfterTaxReserve, taxReserve.balance],
      );
    }
  }
  const [snapshots, adjustedSnapshots] = await Promise.all([
    queryRows<{ snapshot_date: string; assets: number; liabilities: number; net_worth: number }>(
      "SELECT snapshot_date, assets, liabilities, net_worth FROM net_worth_snapshots ORDER BY snapshot_date",
    ),
    queryRows<{ snapshot_date: string; assets: number; liabilities: number; net_worth: number; tax_reserve: number }>(
      "SELECT snapshot_date, assets, liabilities, net_worth, tax_reserve FROM tax_reserve_net_worth_snapshots WHERE scope_key = ? ORDER BY snapshot_date",
      [adjustedSnapshotScope],
    ),
  ]);

  return {
    generatedAt: now.toISOString(),
    taxReserve,
    taxScenario,
    netWorth,
    netWorthAfterTaxReserve,
    netWorthReliable: balancesReliable && taxReserve.reliable,
    netWorthHistory: snapshots.map((snapshot) => ({
      date: snapshot.snapshot_date,
      assets: Number(snapshot.assets),
      liabilities: Number(snapshot.liabilities),
      netWorth: Number(snapshot.net_worth),
    })),
    netWorthAfterTaxReserveHistory: adjustedSnapshots.map((snapshot) => ({
      date: snapshot.snapshot_date,
      assets: Number(snapshot.assets),
      liabilities: Number(snapshot.liabilities),
      netWorth: Number(snapshot.net_worth),
      taxReserve: Number(snapshot.tax_reserve),
    })),
    totalCash: round(totalCash),
    grossCash: round(grossCash),
    accounts: accounts.map((account) => {
      const pendingOutflow = round(pendingByAccount.get(account.account_id) ?? 0);
      const currentBalance = account.current_balance === null ? null : Number(account.current_balance);
      return {
        id: account.account_id,
        isTaxReserve: taxAccountIds.has(account.account_id),
        institutionName: account.institution_name,
        name: account.name,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        currentBalance,
        availableBalance: account.available_balance === null ? null : Number(account.available_balance),
        creditLimit: account.credit_limit === null ? null : Number(account.credit_limit),
        minimumPayment: account.minimum_payment === null ? null : Number(account.minimum_payment),
        nextPaymentDueDate: account.next_payment_due_date,
        currency: account.currency,
        updatedAt: account.updated_at,
        pendingOutflow,
        estimatedBalance:
          account.type === "credit" && currentBalance !== null
            ? round(currentBalance + pendingOutflow)
            : currentBalance,
      };
    }),
    items: items.map((item) => ({
      id: item.item_id,
      institutionName: item.institution_name,
      status: item.status,
      errorMessage: item.error_message,
      updatedAt: item.updated_at,
    })),
    transactions: classified.map((transaction) => ({
      id: transaction.transaction_id,
      accountId: transaction.account_id,
      institutionName: transaction.institution_name,
      accountName: transaction.account_name,
      accountMask: transaction.account_mask,
      accountType: transaction.account_type,
      date: transaction.transaction_date,
      name: transaction.displayName,
      rawName: transaction.name,
      amount: Number(transaction.amount),
      pending: Boolean(transaction.pending),
      category: transaction.category,
      categorySource: transaction.categorySource,
      plaidCategory: transaction.category_primary,
      detailCategory: transaction.category_detailed,
      flowType: transaction.flowType,
      flowLabel: transaction.flowLabel,
    })),
    monthSpend: round(monthSpend),
    monthPendingSpend: round(monthPendingSpend),
    monthIncome: round(monthIncome),
    monthInvested: round(monthInvested),
    monthSaved: round(monthSaved),
    monthTaxes: round(monthTaxes),
    monthCreditPayments: round(monthCreditPayments),
    monthTransfers: round(monthTransfers),
    monthRefunds: round(monthRefunds),
    monthAfterSpending: round(monthIncome - monthSpend),
    monthUnallocated: round(monthIncome - monthSpend - monthInvested - monthSaved - monthTaxes),
    spendRate: monthIncome ? round((monthSpend / monthIncome) * 100) : 0,
    previousMonthSpend: round(previousMonthSpend),
    spendingGuide: {
      monthlyAllowance: round(monthlyFlexibleAllowance),
      remaining: round(flexibleRemaining),
      usedPercent: monthlyFlexibleAllowance
        ? round(Math.min(100, (monthSpend / monthlyFlexibleAllowance) * 100))
        : 100,
      protectedCash: round(protectedCash),
      reservedCash: round(reservedCash),
      recentMonthlySpend: round(recentMonthlySpend),
      postReserveIncome: round(postReserveIncome),
      incomeAllowance: round(incomeAllowance),
      cashCapacity: round(cashCapacity),
      incomeRate: 10,
    },
    portfolio: {
      totalValue: round(investmentValue),
      totalCostBasis: holdingsWithCostBasis.length ? round(investmentCostBasis) : null,
      totalGain:
        holdingsWithCostBasis.length === portfolioHoldings.length && portfolioHoldings.length
          ? round(investmentValue - investmentCostBasis)
          : null,
      byInstitution: [...portfolioInstitutions.entries()]
        .map(([name, value]) => ({ name, value: round(value) }))
        .sort((a, b) => b.value - a.value),
      holdings: portfolioHoldings,
      coinbase: {
        configured: coinbasePortfolio.configured,
        status: coinbasePortfolio.status,
        error: coinbasePortfolio.error,
        updatedAt: coinbasePortfolio.updatedAt,
      },
      kraken: {
        configured: krakenPortfolio.configured,
        status: krakenPortfolio.status,
        error: krakenPortfolio.error,
        updatedAt: krakenPortfolio.updatedAt,
      },
    },
    categoryData: [...categoryTotals.entries()]
      .map(([name, value]) => ({ name, value: round(value) }))
      .sort((a, b) => b.value - a.value),
    allocationData: [
      { name: "Spent", value: round(monthSpend), tone: "spending" },
      { name: "Invested", value: round(monthInvested), tone: "investment" },
      { name: "Saved", value: round(monthSaved), tone: "savings" },
      { name: "Taxes paid", value: round(monthTaxes), tone: "taxes" },
      {
        name: "Unallocated",
        value: round(Math.max(0, monthIncome - monthSpend - monthInvested - monthSaved - monthTaxes)),
        tone: "unallocated",
      },
    ].filter((value) => value.value > 0),
    monthlyData: [...monthlyTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, value]) => ({
        month: new Date(`${month}-02T12:00:00`).toLocaleDateString("en-US", { month: "short" }),
        spending: round(value.spending),
        income: round(value.income),
      })),
    cashTrendData,
  };
}
