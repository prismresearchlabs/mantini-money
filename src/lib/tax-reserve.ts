/** Cash earmarked for tax payments stays an asset, but is excluded from usable cash. */
export type ReserveAccount = {
  id: string;
  name: string;
  type: string;
  subtype?: string | null;
  currentBalance: number | null;
  currency?: string | null;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isUsd = (account: ReserveAccount) => !account.currency || account.currency === "USD";

export function isAutomaticTaxReserve(account: Pick<ReserveAccount, "name" | "type">) {
  if (account.type !== "depository") return false;
  const name = account.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return /^(?:(?:federal |state |quarterly |estimated )?tax(?:es)?(?: (?:reserve|reserves|savings|account|fund|funds|bucket|escrow))?|irs(?: (?:reserve|savings|account|fund|funds))?)$/.test(name);
}

export function resolveTaxReserve(accounts: readonly ReserveAccount[], storedSetting?: string | null) {
  let configuredIds: string[] | null = null;
  let invalidSetting = false;
  if (storedSetting !== undefined && storedSetting !== null) {
    try {
      const parsed: unknown = JSON.parse(storedSetting);
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string" && id.length > 0)) configuredIds = [...new Set(parsed as string[])];
      else invalidSetting = true;
    } catch { invalidSetting = true; }
  }
  const requestedIds = configuredIds ?? accounts.filter(isAutomaticTaxReserve).map((account) => account.id);
  const eligible = new Map(accounts.filter((account) => account.type === "depository").map((account) => [account.id, account]));
  const accountIds = requestedIds.filter((id) => eligible.has(id)).sort();
  const unavailableAccountIds = requestedIds.filter((id) => !eligible.has(id)).sort();
  const selected = accountIds.map((id) => eligible.get(id)!);
  const missingBalances = unavailableAccountIds.length + selected.filter((account) => account.currentBalance === null || !Number.isFinite(account.currentBalance)).length;
  const unsupportedCurrencies = selected.filter((account) => !isUsd(account)).length;
  // An overdrawn reserve is still a liability; only positive tax funds are set aside.
  const balance = selected.reduce((sum, account) => sum + (isUsd(account) && Number.isFinite(account.currentBalance) ? Math.max(0, account.currentBalance ?? 0) : 0), 0);
  return {
    accountIds,
    balance: round(balance),
    source: configuredIds === null ? "automatic" as const : "configured" as const,
    missingBalances,
    unsupportedCurrencies,
    unavailableAccountIds,
    invalidSetting,
  };
}

/** Include the selection in history identity so a settings change cannot rewrite old totals. */
export function taxReserveScopeKey(accountIds: readonly string[]) {
  return JSON.stringify([...new Set(accountIds)].sort());
}

export function getReserveAwareCash(accounts: readonly ReserveAccount[], reserveAccountIds: readonly string[]) {
  const reserved = new Set(reserveAccountIds);
  let grossCash = 0, totalCash = 0, nonTaxSavings = 0;
  for (const account of accounts) {
    if (account.type !== "depository" || !isUsd(account) || account.currentBalance === null || !Number.isFinite(account.currentBalance)) continue;
    grossCash += account.currentBalance;
    if (!reserved.has(account.id)) {
      totalCash += account.currentBalance;
      if (account.subtype === "savings") nonTaxSavings += Math.max(0, account.currentBalance);
    } else totalCash += Math.min(0, account.currentBalance);
  }
  return { grossCash: round(grossCash), totalCash: round(totalCash), nonTaxSavings: round(nonTaxSavings) };
}

type CashTransaction = { accountId: string; accountType: string; date: string; amount: number; pending: boolean; currency?: string | null };

export function buildReserveAwareCashHistory(
  currentCash: number,
  transactions: readonly CashTransaction[],
  reserveAccountIds: readonly string[],
  now = new Date(),
  reserveBalances: readonly Pick<ReserveAccount, "id" | "currentBalance">[] = [],
) {
  const reserved = new Set(reserveAccountIds);
  const today = now.toISOString().slice(0, 10);
  const currentDay = Date.parse(`${today}T12:00:00Z`);
  const dayMs = 86_400_000;
  const eligible = transactions.filter((transaction) => transaction.accountType === "depository" &&
    !transaction.pending && Number.isFinite(transaction.amount) && (!transaction.currency || transaction.currency === "USD") &&
    /^\d{4}-\d{2}-\d{2}$/.test(transaction.date) && Number.isFinite(Date.parse(`${transaction.date}T12:00:00Z`)) && transaction.date <= today);
  const cash = eligible.filter((transaction) => !reserved.has(transaction.accountId));
  const firstImportedDay = cash.map((transaction) => transaction.date).sort()[0];
  const historyStart = Math.min(currentDay - 29 * dayMs, Math.max(currentDay - 179 * dayMs, firstImportedDay ? Date.parse(`${firstImportedDay}T12:00:00Z`) : currentDay));
  const historyDays = Math.round((currentDay - historyStart) / dayMs) + 1;
  const daily = new Map<string, { incoming: number; outgoing: number; net: number }>();
  for (const transaction of cash) {
    const entry = daily.get(transaction.date) ?? { incoming: 0, outgoing: 0, net: 0 };
    entry.net += transaction.amount;
    entry.incoming += Math.max(0, -transaction.amount);
    entry.outgoing += Math.max(0, transaction.amount);
    daily.set(transaction.date, entry);
  }
  const reserveClosingBalances = new Map(reserveBalances.filter((account) => reserved.has(account.id) && account.currentBalance !== null && Number.isFinite(account.currentBalance)).map((account) => [account.id, account.currentBalance!]));
  const reserveTransactions = new Map<string, CashTransaction[]>();
  for (const transaction of eligible.filter((transaction) => reserveClosingBalances.has(transaction.accountId))) {
    reserveTransactions.set(transaction.date, [...(reserveTransactions.get(transaction.date) ?? []), transaction]);
  }
  const reserveDeficit = () => [...reserveClosingBalances.values()].reduce((sum, balance) => sum + Math.min(0, balance), 0);
  // Positive tax funds never enter the chart. Reserve overdrafts remain real liabilities.
  let closingBalance = currentCash - reserveDeficit();
  const result = [];
  for (let offset = 0; offset < historyDays; offset++) {
    const date = new Date(currentDay - offset * dayMs);
    const day = date.toISOString().slice(0, 10);
    const movement = daily.get(day) ?? { incoming: 0, outgoing: 0, net: 0 };
    const deficit = reserveDeficit();
    for (const transaction of reserveTransactions.get(day) ?? []) {
      reserveClosingBalances.set(transaction.accountId, reserveClosingBalances.get(transaction.accountId)! + transaction.amount);
    }
    const deficitMovement = deficit - reserveDeficit();
    result.push({ day, date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), balance: round(closingBalance + deficit), cashIn: round(movement.incoming + Math.max(0, deficitMovement)), cashOut: round(movement.outgoing + Math.max(0, -deficitMovement)) });
    closingBalance += movement.net;
  }
  return result.reverse();
}
