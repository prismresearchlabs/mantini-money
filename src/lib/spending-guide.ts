/** Funded spending money, independent of income cadence and savings transfers. */
type Account = {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  currentBalance: number | null;
  currency?: string | null;
};

type Transaction = {
  accountId: string;
  date: string;
  amount: number;
  pending: boolean;
  flowType: string;
  currency?: string | null;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isUsd = (value: { currency?: string | null }) => !value.currency || value.currency === "USD";

// The owner's chosen monthly allowance; bank location and draw cadence do not set it.
export const DEFAULT_MONTHLY_BUDGET = 5000;
export function resolveMonthlyBudget(stored?: string | null) {
  const value = stored === undefined || stored === null || stored.trim() === "" ? NaN : Number(stored);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? round(value) : DEFAULT_MONTHLY_BUDGET;
}

export function getSpendingGuide(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  taxAccountIds: readonly string[],
  budget: { monthlyBudget: number; month: string },
) {
  const taxIds = new Set(taxAccountIds);
  const spendingAccounts = accounts.filter((account) => account.type === "depository" && account.subtype === "checking" && !taxIds.has(account.id));
  const cards = accounts.filter((account) => account.type === "credit");
  const relevantAccounts = [...spendingAccounts, ...cards];
  const missingBalances = relevantAccounts.filter((account) => account.currentBalance === null || !Number.isFinite(account.currentBalance)).length;
  const unsupportedCurrencies = relevantAccounts.filter((account) => !isUsd(account)).length;
  const balance = (account: Account) => isUsd(account) && Number.isFinite(account.currentBalance) ? account.currentBalance ?? 0 : 0;
  const spendingCash = spendingAccounts.reduce((sum, account) => sum + balance(account), 0);
  // An overpaid card is not cash available to fund purchases on other accounts.
  const cardBalances = cards.reduce((sum, account) => sum + Math.max(0, balance(account)), 0);
  const spendingIds = new Set(spendingAccounts.filter(isUsd).map((account) => account.id));
  const cardIds = new Set(cards.filter(isUsd).map((account) => account.id));
  const pendingOutflows = transactions.reduce((sum, transaction) => {
    if (!transaction.pending || !isUsd(transaction) || !Number.isFinite(transaction.amount) || transaction.amount <= 0) return sum;
    // Card payments settle liabilities already reserved above. Pending income,
    // refunds and transfers into checking never increase the funded amount.
    if (transaction.flowType === "credit_payment") return sum;
    return spendingIds.has(transaction.accountId) || cardIds.has(transaction.accountId) ? sum + transaction.amount : sum;
  }, 0);
  const reservedCash = accounts.filter((account) => account.type === "depository" && account.subtype === "savings" && !taxIds.has(account.id))
    .reduce((sum, account) => sum + Math.max(0, balance(account)), 0);
  const available = spendingAccounts.length > 0 && missingBalances === 0 && unsupportedCurrencies === 0;
  const net = round(spendingCash - cardBalances - pendingOutflows);
  const monthlyBudget = resolveMonthlyBudget(String(budget.monthlyBudget));
  const monthSpending = transactions.filter((transaction) => transaction.date.slice(0, 7) === budget.month &&
    isUsd(transaction) && Number.isFinite(transaction.amount) && transaction.amount > 0 && transaction.flowType === "spending");
  const postedSpending = round(monthSpending.filter((transaction) => !transaction.pending).reduce((sum, transaction) => sum + transaction.amount, 0));
  const pendingSpending = round(monthSpending.filter((transaction) => transaction.pending).reduce((sum, transaction) => sum + transaction.amount, 0));
  const budgetRemaining = round(Math.max(0, monthlyBudget - postedSpending - pendingSpending));
  const fundedCash = available ? Math.max(0, net) : 0;
  return {
    basis: "monthly-budget-capped-by-checking" as const,
    monthlyBudget,
    postedSpending,
    pendingSpending,
    budgetRemaining,
    fundedCash,
    usedPercent: monthlyBudget > 0 ? Math.min(100, round((postedSpending + pendingSpending) / monthlyBudget * 100)) : 100,
    available,
    spendingAccountNames: spendingAccounts.map((account) => account.name),
    spendingCash: round(spendingCash),
    cardBalances: round(cardBalances),
    pendingOutflows: round(pendingOutflows),
    remaining: Math.min(budgetRemaining, fundedCash),
    shortfall: available ? Math.max(0, -net) : 0,
    protectedCash: round(reservedCash),
    missingBalances,
    unsupportedCurrencies,
  };
}
