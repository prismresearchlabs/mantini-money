import { merchantKey } from "@/lib/categories";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;
export type Transaction = DashboardData["transactions"][number];
export type CategoryUpdate = { category: string; categorySource: string };
export type FilterTab = "all" | "uncategorized" | "pending";
export type TransactionSort = "newest" | "oldest" | "largest" | "smallest";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const needsCategory = (transaction: Transaction) => transaction.category === "Other" && transaction.categorySource !== "manual";

export function filterTransactions(transactions: Transaction[], filters: {
  start: string; end: string; query: string; account: string; category: string;
  flow: string; tab: FilterTab; sort: TransactionSort;
}) {
  const term = filters.query.trim().toLowerCase();
  return transactions.filter((transaction) => {
    if (transaction.date < filters.start || transaction.date > filters.end) return false;
    if (filters.account !== "all" && transaction.accountId !== filters.account) return false;
    if (filters.category !== "all" && transaction.category !== filters.category) return false;
    if (filters.flow !== "all" && transaction.flowType !== filters.flow) return false;
    if (filters.tab === "uncategorized" && !needsCategory(transaction)) return false;
    if (filters.tab === "pending" && !transaction.pending) return false;
    const amountSign = transaction.amount < 0 ? "+" : "-";
    return !term || [transaction.name, transaction.rawName, transaction.category, transaction.accountName,
      transaction.institutionName, transaction.accountMask || "", Math.abs(transaction.amount).toFixed(2),
      `${amountSign}${Math.abs(transaction.amount).toFixed(2)}`, currency.format(Math.abs(transaction.amount)),
      `${amountSign}${currency.format(Math.abs(transaction.amount))}`, transaction.date].some((value) => value.toLowerCase().includes(term.replaceAll("−", "-")));
  }).sort((a, b) => {
    if (filters.sort === "largest") return Math.abs(b.amount) - Math.abs(a.amount) || b.date.localeCompare(a.date);
    if (filters.sort === "smallest") return Math.abs(a.amount) - Math.abs(b.amount) || b.date.localeCompare(a.date);
    return filters.sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
  });
}

export function categoryUpdates(transactions: Transaction[], transactionId: string, category: string) {
  const selected = transactions.find((transaction) => transaction.id === transactionId);
  const updates: Record<string, CategoryUpdate> = {};
  if (!selected) return updates;
  const key = merchantKey(selected.name);
  for (const transaction of transactions) {
    if (transaction.id === transactionId) updates[transaction.id] = { category, categorySource: "manual" };
    else if (transaction.categorySource !== "manual" && merchantKey(transaction.name) === key) {
      updates[transaction.id] = { category, categorySource: "learned" };
    }
  }
  return updates;
}

export function csvCell(value: string | number) {
  if (typeof value === "number") return String(value);
  // Merchant text is external input; prevent it being interpreted as a spreadsheet formula.
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function transactionCsv(transactions: Transaction[]) {
  const rows: (string | number)[][] = [
    ["Date", "Merchant", "Category", "Account", "Institution", "Amount (inflow positive)", "Status", "Flow"],
    ...transactions.map((transaction) => [
      transaction.date, transaction.name, transaction.category, transaction.accountName,
      transaction.institutionName, -transaction.amount, transaction.pending ? "Pending" : "Posted", transaction.flowLabel,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
