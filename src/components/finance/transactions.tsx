"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft, ArrowDownUp, ArrowUpRight, Check, ChevronLeft, ChevronRight,
  Clock3, Download, Landmark, LoaderCircle, ReceiptText, Search, SlidersHorizontal,
  Sparkles, Tag, X,
} from "lucide-react";
import { TRANSACTION_CATEGORIES } from "@/lib/categories";
import { categoryUpdates, filterTransactions, needsCategory, transactionCsv } from "./transactions-model";
import type { CategoryUpdate, FilterTab, Transaction, TransactionSort } from "./transactions-model";
import "./transactions.css";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;

const PAGE_SIZE = 30;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (amount: number) => currency.format(Math.abs(amount));
const signedMoney = (amount: number) => `${amount < 0 ? "+" : amount > 0 ? "−" : ""}${money(amount)}`;

function displayDate(date: string, weekday = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "long" as const } : {}), month: "short", day: "numeric", year: "numeric",
  });
}

function merchantTone(name: string) {
  return ["sage", "blue", "plum", "amber", "rose"][
    [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 5
  ];
}

function initials(name: string) {
  return name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "↔";
}

function MerchantAvatar({ transaction, large = false }: { transaction: Transaction; large?: boolean }) {
  const transfer = ["transfer", "credit_payment", "savings", "investment"].includes(transaction.flowType);
  return <span className={`tx-avatar tx-avatar-${merchantTone(transaction.name)}${large ? " tx-avatar-large" : ""}`} aria-hidden="true">
    {transfer ? <ArrowDownUp size={large ? 24 : 17} /> : initials(transaction.name)}
  </span>;
}

function exportTransactions(transactions: Transaction[], start: string, end: string) {
  const url = URL.createObjectURL(new Blob([transactionCsv(transactions)], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `transactions-${start}-${end}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function TransactionDetails({
  transaction, onClose, onSaved,
}: {
  transaction: Transaction;
  onClose: () => void;
  onSaved: (transaction: Transaction, category: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(transaction.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function saveCategory() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/transactions/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: transaction.id, category }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save category. Please try again.");
      onSaved(transaction, category);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save category. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <dialog className="tx-dialog" ref={dialogRef} aria-labelledby="tx-detail-title" onCancel={(event) => {
    event.preventDefault();
    if (!saving) onClose();
  }} onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div className="tx-dialog-inner">
      <div className="tx-dialog-top"><span>Transaction details</span><button className="icon-btn" aria-label="Close transaction details" onClick={onClose} disabled={saving}><X size={19} /></button></div>
      <div className="tx-detail-hero">
        <MerchantAvatar transaction={transaction} large />
        <h2 id="tx-detail-title">{transaction.name}</h2>
        <strong className={`tx-detail-amount${transaction.amount < 0 ? " positive" : ""}`}>{signedMoney(transaction.amount)}</strong>
        <span className={`tx-status-pill${transaction.pending ? " tx-pending" : ""}`}>
          {transaction.pending ? <Clock3 size={12} /> : <Check size={12} />}{transaction.pending ? "Pending" : "Posted"}
        </span>
      </div>
      <dl className="tx-detail-facts">
        <div><dt>Date</dt><dd>{displayDate(transaction.date, true)}</dd></div>
        <div><dt>Account</dt><dd>{transaction.accountName}{transaction.accountMask ? ` ··${transaction.accountMask}` : ""}<small>{transaction.institutionName}</small></dd></div>
        <div><dt>Money movement</dt><dd>{transaction.flowLabel}</dd></div>
        {transaction.rawName !== transaction.name && <div><dt>Original description</dt><dd>{transaction.rawName}</dd></div>}
      </dl>
      <form className="tx-category-editor" onSubmit={(event) => { event.preventDefault(); void saveCategory(); }}>
        <label htmlFor="tx-edit-category">Category <span>{transaction.categorySource === "manual" ? "Manually set" : transaction.categorySource === "learned" ? "Learned from your edits" : "Automatically categorized"}</span></label>
        <div className="tx-edit-select"><Tag size={16} /><select id="tx-edit-category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={saving}>
          {TRANSACTION_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></div>
        <p className="tx-learning-note"><Sparkles size={15} /><span>We’ll remember this category for {transaction.name}. It also updates matching transactions that you haven’t categorized manually.</span></p>
        {error && <p className="tx-save-error" role="alert">{error}</p>}
        <div className="tx-dialog-actions"><button type="button" className="btn btn-quiet" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? <LoaderCircle size={16} className="tx-spin" /> : <Check size={16} />}{saving ? "Saving…" : "Save category"}
        </button></div>
      </form>
    </div>
  </dialog>;
}

export function TransactionsView({
  data, start, end, initialCategory, onRefresh,
}: {
  data: DashboardData;
  start: string;
  end: string;
  initialCategory?: string;
  onRefresh?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const validInitialCategory = TRANSACTION_CATEGORIES.find((value) => value === initialCategory) || "all";
  const [categorySelection, setCategorySelection] = useState<{ initial: string | undefined; value: string }>({ initial: initialCategory, value: validInitialCategory });
  const category = categorySelection.initial === initialCategory ? categorySelection.value : validInitialCategory;
  function setCategory(value: string) { setCategorySelection({ initial: initialCategory, value }); }
  const [flow, setFlow] = useState("all");
  const [tab, setTab] = useState<FilterTab>("all");
  const [sort, setSort] = useState<TransactionSort>("newest");
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(Boolean(initialCategory));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, CategoryUpdate>>({});
  const [notice, setNotice] = useState("");

  const transactions = useMemo(() => data.transactions.map((transaction) => updates[transaction.id]
    ? { ...transaction, ...updates[transaction.id] } : transaction), [data.transactions, updates]);
  const periodTransactions = useMemo(() => transactions.filter((transaction) => transaction.date >= start && transaction.date <= end), [transactions, start, end]);
  const filtered = useMemo(() => filterTransactions(periodTransactions, {
    start, end, query, account, category, flow, tab, sort,
  }), [periodTransactions, start, end, query, account, category, flow, tab, sort]);

  const posted = filtered.filter((transaction) => !transaction.pending);
  const inflow = posted.reduce((sum, transaction) => sum + Math.max(0, -transaction.amount), 0);
  const outflow = posted.reduce((sum, transaction) => sum + Math.max(0, transaction.amount), 0);
  const pending = filtered.filter((transaction) => transaction.pending);
  const pendingOutflow = pending.reduce((sum, transaction) => sum + Math.max(0, transaction.amount), 0);
  const unassignedCount = periodTransactions.filter(needsCategory).length;
  const pendingCount = periodTransactions.filter((transaction) => transaction.pending).length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const grouped = sort === "newest" || sort === "oldest";
  const selected = transactions.find((transaction) => transaction.id === selectedId);
  const filterCount = [account, category, flow].filter((value) => value !== "all").length;
  const hasFilters = Boolean(query || filterCount || tab !== "all");
  const flowOptions = [...new Map(transactions.map((transaction) => [transaction.flowType, transaction.flowLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  function resetFilters() {
    setQuery(""); setAccount("all"); setCategory("all"); setFlow("all"); setTab("all"); setPage(0);
  }

  function categorySaved(transaction: Transaction, nextCategory: string) {
    setUpdates((previous) => ({ ...previous, ...categoryUpdates(transactions, transaction.id, nextCategory) }));
    setSelectedId(null);
    setNotice(`Saved ${nextCategory} for ${transaction.name}. Future matches will use this category.`);
    if (onRefresh) void onRefresh();
    else router.refresh();
  }

  return <div className="tx-view">
    <div className="tx-summary-grid">
      <article className="panel tx-summary-card"><div className="tx-summary-title"><span className="tx-summary-icon tx-in"><ArrowDownLeft size={17} /></span>Money in<span className="tx-summary-context">Posted</span></div><strong className="tx-summary-value">{money(inflow)}</strong><span className="tx-summary-caption">Across {posted.filter((transaction) => transaction.amount < 0).length} incoming transactions</span></article>
      <article className="panel tx-summary-card"><div className="tx-summary-title"><span className="tx-summary-icon tx-out"><ArrowUpRight size={17} /></span>Money out<span className="tx-summary-context">Posted</span></div><strong className="tx-summary-value">{money(outflow)}</strong><span className="tx-summary-caption">Includes transfers and card payments</span></article>
      <article className="panel tx-summary-card"><div className="tx-summary-title"><span className="tx-summary-icon tx-wait"><Clock3 size={16} /></span>Pending<span className="tx-summary-context">{pending.length} {pending.length === 1 ? "transaction" : "transactions"}</span></div><strong className="tx-summary-value">{money(pendingOutflow)}</strong><span className="tx-summary-caption">Outgoing charges awaiting settlement</span></article>
    </div>
    {notice && <div className="tx-notice" role="status"><Check size={16} /><span>{notice}</span><button className="icon-btn" onClick={() => setNotice("")} aria-label="Dismiss confirmation"><X size={14} /></button></div>}
    <section className="panel tx-ledger" aria-label="Transaction activity">
      <div className="tx-ledger-heading"><div><h2>All your activity</h2><p>Every account. Every transaction. One clear picture.</p></div><button className="btn tx-export" aria-label="Export filtered transactions as CSV" disabled={!filtered.length} onClick={() => exportTransactions(filtered, start, end)}><Download size={15} /><span>Export CSV</span></button></div>
      <div className="tx-toolbar">
        <div className="tx-search"><Search size={17} /><input type="search" aria-label="Search transactions" placeholder="Search merchant, category, account or amount" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></div>
        <button className={`btn tx-filter-toggle${showFilters ? " tx-filter-active" : ""}`} aria-expanded={showFilters} aria-controls="tx-filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={16} />Filters{filterCount > 0 && <span>{filterCount}</span>}</button>
      </div>
      {showFilters && <div className="tx-filters" id="tx-filters">
        <label>Account<select value={account} onChange={(event) => { setAccount(event.target.value); setPage(0); }}><option value="all">All accounts</option>{data.accounts.map((value) => <option value={value.id} key={value.id}>{value.name}{value.mask ? ` ··${value.mask}` : ""}</option>)}</select></label>
        <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setPage(0); }}><option value="all">All categories</option>{TRANSACTION_CATEGORIES.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <label>Money movement<select value={flow} onChange={(event) => { setFlow(event.target.value); setPage(0); }}><option value="all">All types</option>{flowOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {filterCount > 0 && <button className="btn btn-quiet tx-clear-filters" onClick={resetFilters}><X size={14} />Clear filters</button>}
      </div>}
      <div className="tx-tabs-and-sort"><div className="tx-tabs" role="group" aria-label="Transaction status">
        {([
          { id: "all", label: "All transactions", count: periodTransactions.length },
          { id: "uncategorized", label: "Needs category", count: unassignedCount },
          { id: "pending", label: "Pending", count: pendingCount },
        ] as const).map((item) => <button key={item.id} aria-pressed={tab === item.id} className={tab === item.id ? "tx-tab-active" : ""} onClick={() => { setTab(item.id); setPage(0); }}>{item.label}<span>{item.count}</span></button>)}
      </div><label className="tx-sort"><span className="tx-sr-only">Sort transactions</span><select value={sort} onChange={(event) => { setSort(event.target.value as TransactionSort); setPage(0); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="largest">Largest amount</option><option value="smallest">Smallest amount</option></select></label></div>
      <div className="tx-result-summary" aria-live="polite"><span><strong>{filtered.length.toLocaleString()}</strong> {filtered.length === 1 ? "transaction" : "transactions"}{hasFilters ? " match your filters" : " in this period"}</span>{hasFilters && <button onClick={resetFilters}>Reset filters</button>}</div>
      {filtered.length ? <>
        <table className="tx-table"><thead><tr><th>Merchant</th><th>Category</th><th className="tx-account-column">Account</th><th className="tx-amount-column">Amount</th><th className="tx-open-column"><span className="tx-sr-only">Details</span></th></tr></thead><tbody>
          {visible.map((transaction, index) => <Fragment key={transaction.id}>
            {grouped && (index === 0 || visible[index - 1].date !== transaction.date) && <tr className="tx-date-row"><th colSpan={5} scope="rowgroup">{displayDate(transaction.date)}</th></tr>}
            <tr className="tx-row">
              <td><button className="tx-merchant-button" onClick={() => setSelectedId(transaction.id)} aria-label={`View ${transaction.name}, ${signedMoney(transaction.amount)}, ${displayDate(transaction.date)}`}><MerchantAvatar transaction={transaction} /><span className="tx-merchant-copy"><strong>{transaction.name}</strong><span><span className="tx-desktop-description">{!grouped ? `${displayDate(transaction.date)} · ` : ""}{transaction.pending ? <><span className="tx-pending-dot" />Pending</> : transaction.flowLabel}</span><span className={`tx-mobile-category${needsCategory(transaction) ? " tx-mobile-uncategorized" : ""}`}>{!grouped ? `${displayDate(transaction.date)} · ` : ""}{needsCategory(transaction) ? "Uncategorized" : transaction.category}{transaction.pending ? " · Pending" : ""}</span></span></span></button></td>
              <td className="tx-category-column"><button className={`tx-category-badge${needsCategory(transaction) ? " tx-needs-category" : ""}`} onClick={() => setSelectedId(transaction.id)} aria-label={`Edit category for ${transaction.name}: ${transaction.category}`}><span />{needsCategory(transaction) ? "Uncategorized" : transaction.category}</button></td>
              <td className="tx-account-column"><div className="tx-account-copy"><span>{transaction.accountName}{transaction.accountMask ? ` ··${transaction.accountMask}` : ""}</span><small>{transaction.institutionName}</small></div></td>
              <td className={`tx-amount-column${transaction.amount < 0 ? " positive" : ""}`}><strong>{signedMoney(transaction.amount)}</strong>{transaction.pending && <small>Pending</small>}</td>
              <td className="tx-open-column"><button className="icon-btn" aria-label={`Open ${transaction.name} details`} onClick={() => setSelectedId(transaction.id)}><ChevronRight size={16} /></button></td>
            </tr>
          </Fragment>)}
        </tbody></table>
        <div className="tx-pagination"><span>Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}</span><div><button className="icon-btn" aria-label="Previous transaction page" disabled={currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}><ChevronLeft size={17} /></button><span>{currentPage + 1} / {pageCount}</span><button className="icon-btn" aria-label="Next transaction page" disabled={currentPage === pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}><ChevronRight size={17} /></button></div></div>
      </> : <div className="tx-empty"><span className="tx-empty-icon">{hasFilters ? <Search size={25} /> : <ReceiptText size={25} />}</span><h3>{hasFilters ? "No matching transactions" : "A fresh page"}</h3><p>{hasFilters ? "Try another search or clear your filters to see more activity." : "Transactions from your connected accounts will appear here. Try a different date range or sync your accounts."}</p>{hasFilters && <button className="btn" onClick={resetFilters}>Clear all filters</button>}</div>}
    </section>
    <p className="tx-footnote"><Landmark size={13} />Amounts reflect imported account activity. Pending transactions can change before posting.</p>
    {selected && <TransactionDetails key={selected.id} transaction={selected} onClose={() => setSelectedId(null)} onSaved={categorySaved} />}
  </div>;
}
