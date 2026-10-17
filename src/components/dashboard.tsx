"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { UserButton } from "@clerk/nextjs";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Building2,
  CreditCard,
  ChevronDown,
  CircleGauge,
  Landmark,
  LoaderCircle,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ConnectionControls, InvestmentConsentButton, ManageConnectionButton } from "./finance/connections";
import { PurchaseCheck, BudgetEditor } from "./finance/advisor";
import { AdvisorMarkdown } from "./finance/advisor-markdown";
import "./classic-dashboard.css";
import { TRANSACTION_CATEGORIES } from "@/lib/categories";
import type { FinanceAgentUIMessage } from "@/lib/ai/finance-agent";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;
const TaxesView = dynamic(() => import("./finance/taxes").then((module) => module.TaxesView), { loading: () => <p className="muted" role="status">Loading tax details…</p> });

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function isTaxView() { return window.location.hash === "#taxes"; }
function serverTaxView() { return false; }

type FlowType = DashboardData["transactions"][number]["flowType"];
type AccountKind = "all" | "depository" | "credit";
type DateRange = "month" | "three_months" | "all";

function formatMoney(value: number | null, cents = false) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents ? 2 : 0,
  }).format(value);
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}

function parseStoredTimestamp(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function AccountPanel({ data }: { data: DashboardData }) {
  const bankingAccounts = data.accounts.filter(
    (account) => account.type === "depository" || account.type === "credit",
  );

  return (
    <article className="panel accounts-hero" id="accounts">
      <div className="panel-title"><h2>Accounts</h2><span>{bankingAccounts.length}</span></div>
      <div className="hero-account-list">
        {bankingAccounts.map((account) => {
          const credit = account.type === "credit";
          return (
            <div className="hero-account" key={account.id}>
              <div className={`account-glyph ${credit ? "credit" : "bank"}`}>
                {credit ? <CreditCard size={18} /> : <Building2 size={18} />}
              </div>
              <div className="account-copy">
                <strong>{account.name}</strong>
                <span>{account.institutionName}{account.mask ? ` ··${account.mask}` : ""}</span>
              </div>
              <div className="account-amount">
                <strong>{formatMoney(credit ? account.estimatedBalance : account.currentBalance, true)}</strong>
                {credit ? (
                  <span>
                    Posted {formatMoney(account.currentBalance, true)} · Pending {formatMoney(account.pendingOutflow, true)}
                  </span>
                ) : <span>{account.isTaxReserve ? "Tax reserve · excluded" : "Reported balance"}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <details className="classic-connections">
        <summary>Manage connections{data.items.some((item) => item.status !== "healthy") ? " · attention needed" : ""}</summary>
        {data.items.map((item) => <div className="classic-connection" key={item.id}><div><strong>{item.institutionName}</strong><span>{item.status === "healthy" ? "Connected" : item.errorMessage || "Connection needs attention"}</span></div><ManageConnectionButton itemId={item.id} /></div>)}
      </details>
    </article>
  );
}

function BalancePanel({ data }: { data: DashboardData }) {
  const [range, setRange] = useState<"30" | "90" | "all">("30");
  const visibleData = useMemo(() => {
    if (range === "all") return data.cashTrendData;
    return data.cashTrendData.slice(-Number(range));
  }, [data.cashTrendData, range]);
  const firstBalance = visibleData[0]?.balance ?? data.totalCash;
  const lastBalance = visibleData.at(-1)?.balance ?? data.totalCash;
  const balanceChange = lastBalance - firstBalance;
  const changePercent = firstBalance ? (balanceChange / firstBalance) * 100 : 0;
  const cashIn = visibleData.reduce((sum, point) => sum + point.cashIn, 0);
  const cashOut = visibleData.reduce((sum, point) => sum + point.cashOut, 0);
  const rangeLabel = range === "all" ? "Imported history" : `${range} days`;

  return (
    <article className="panel balance-hero">
      <div className="balance-heading">
        <div><span>Cash outside tax reserve</span><strong>{formatMoney(data.totalCash, true)}</strong></div>
        <div className="range-switch" aria-label="Cash history range">
          {(["30", "90", "all"] as const).map((value) => (
            <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>
              {value === "all" ? "All" : `${value}D`}
            </button>
          ))}
        </div>
      </div>
      <a className="classic-reserve-note" href="#taxes">{formatMoney(data.taxReserve.balance)} set aside for taxes · View reserve</a>
      {!data.taxReserve.reliable ? <p className="classic-data-warning">Some reserve balances need a refresh. Totals may be incomplete.</p> : null}
      <div className="hero-flow">
        <span className={balanceChange >= 0 ? "positive" : "negative"}>
          {balanceChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {balanceChange >= 0 ? "+" : "−"}{formatMoney(Math.abs(balanceChange))} ({Math.abs(changePercent).toFixed(1)}%)
        </span>
        <span className="range-context">{rangeLabel}</span>
        <span className="positive flow-stat"><ArrowUpRight size={14} /> {formatMoney(cashIn)} in</span>
        <span className="negative flow-stat"><ArrowDownRight size={14} /> {formatMoney(cashOut)} out</span>
      </div>
      <div className="balance-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visibleData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8294ff" stopOpacity={0.34} />
                <stop offset="64%" stopColor="#6578f4" stopOpacity={0.11} />
                <stop offset="100%" stopColor="#6578f4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#2b2b3a" strokeDasharray="3 7" />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={48}
              tick={{ fill: "#77788a", fontSize: 10 }}
              dy={9}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={formatCompactMoney}
              tick={{ fill: "#77788a", fontSize: 10 }}
              domain={["auto", "auto"]}
            />
            <Tooltip
              formatter={(value) => [formatMoney(Number(value), true), "Cash outside tax reserve"]}
              labelStyle={{ color: "#9697a9" }}
              cursor={{ stroke: "#555a85", strokeDasharray: "3 4" }}
              contentStyle={{ background: "#242432", border: "1px solid #3a3a4c", borderRadius: 10, boxShadow: "0 14px 32px rgba(0,0,0,.28)" }}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="balance"
              stroke="#8b9bff"
              strokeWidth={2.4}
              fill="url(#cashFill)"
              activeDot={{ r: 4, fill: "#dfe3ff", stroke: "#6578f4", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="classic-chart-note">Reconstructed from imported activity, using your current cash balance.</p>
    </article>
  );
}

function SummaryCard({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{formatMoney(value)}</strong>
      <small className={tone}>{note}</small>
    </article>
  );
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value < 1 ? 8 : 4,
  }).format(value);
}

function PortfolioPanel({ data }: { data: DashboardData }) {
  const portfolio = data.portfolio;
  const maximumInstitutionValue = portfolio.byInstitution[0]?.value || 1;
  const fidelityItem = data.items.find((item) => item.institutionName.toLowerCase().includes("fidelity"));
  const fidelityNeedsHoldingsConsent = portfolio.holdings.some(
    (holding) => holding.institutionName.toLowerCase().includes("fidelity") && holding.type === "account",
  );

  return (
    <section className="panel portfolio-panel">
      <div className="portfolio-summary">
        <div className="portfolio-heading">
          <div className="portfolio-icon"><WalletCards size={19} /></div>
          <div><span>Investments</span><h2>Portfolio</h2></div>
        </div>
        <strong className="portfolio-total">{formatMoney(portfolio.totalValue, true)}</strong>
        {portfolio.totalGain !== null ? (
          <span className={portfolio.totalGain >= 0 ? "portfolio-gain positive" : "portfolio-gain negative"}>
            <TrendingUp size={14} /> {portfolio.totalGain >= 0 ? "+" : "−"}{formatMoney(Math.abs(portfolio.totalGain), true)} unrealized
          </span>
        ) : (
          <span className="portfolio-gain muted">Current connected value</span>
        )}
        {portfolio.coinbase.status === "connected" ? (
          <span className="portfolio-source connected">Coinbase live</span>
        ) : portfolio.coinbase.status === "error" ? (
          <span className="portfolio-source error" title={portfolio.coinbase.error || undefined}>Coinbase needs attention</span>
        ) : null}
        {portfolio.kraken.status === "connected" ? (
          <span className="portfolio-source connected">Kraken live</span>
        ) : portfolio.kraken.status === "error" ? (
          <span className="portfolio-source error" title={portfolio.kraken.error || undefined}>Kraken needs attention</span>
        ) : (
          <span className="portfolio-source pending">Kraken key needed</span>
        )}
        {fidelityItem && fidelityNeedsHoldingsConsent ? (
          <InvestmentConsentButton itemId={fidelityItem.id} />
        ) : null}
        <div className="institution-allocation">
          {portfolio.byInstitution.map((institution) => (
            <div key={institution.name}>
              <div><span>{institution.name}</span><strong>{formatMoney(institution.value, true)}</strong></div>
              <i><span style={{ width: `${(institution.value / maximumInstitutionValue) * 100}%` }} /></i>
            </div>
          ))}
        </div>
      </div>
      <div className="portfolio-holdings">
        <div className="portfolio-list-head"><h3>Holdings</h3><span>{portfolio.holdings.length}</span></div>
        {portfolio.holdings.length ? (
          <div className="holding-list">
            {portfolio.holdings.slice(0, 10).map((holding) => (
              <div className="holding-row" key={`${holding.accountId}-${holding.securityId}`}>
                <div className={`holding-mark ${holding.type === "cryptocurrency" ? "crypto" : "security"}`}>
                  {(holding.ticker || (holding.type === "account" ? holding.institutionName : holding.name)).slice(0, 2).toUpperCase()}
                </div>
                <div className="holding-name">
                  <strong>{holding.name}</strong>
                  <span>{holding.type === "account" ? `${holding.subtype || "Investment"} account` : holding.ticker || holding.type || "Holding"} · {holding.institutionName}</span>
                </div>
                <div className="holding-quantity">
                  {holding.type === "account" ? (
                    <><strong>Connected</strong><span>Account balance</span></>
                  ) : (
                    <><strong>{formatQuantity(holding.quantity)}</strong><span>{holding.price === null ? "Quantity" : `${formatMoney(holding.price, true)} each`}</span></>
                  )}
                </div>
                <div className="holding-value">
                  <strong>{formatMoney(holding.value, true)}</strong>
                  {holding.costBasis !== null ? <span>Cost {formatMoney(holding.costBasis, true)}</span> : <span>Market value</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="portfolio-empty">
            <p>This connection has not shared holdings yet.</p>
            <span>Use Add account again and choose the investment or crypto accounts Plaid shows.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryPanel({ data }: { data: DashboardData }) {
  const total = data.categoryData.reduce((sum, value) => sum + value.value, 0) || 1;
  const allocationTotal = data.allocationData.reduce((sum, value) => sum + value.value, 0) || 1;
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  return (
    <article className="panel category-panel">
      <div className="panel-title">
        <div><span>This month</span><h2>Spending</h2></div>
        <strong>{formatMoney(data.monthSpend, true)}</strong>
      </div>
      <div className="allocation-bar">
        {data.allocationData.map((item) => (
          <span
            key={item.name}
            className={`allocation-segment ${item.tone}`}
            style={{ width: `${(item.value / allocationTotal) * 100}%` }}
            title={`${item.name}: ${formatMoney(item.value, true)}`}
          />
        ))}
      </div>
      <div className="allocation-key">
        {data.allocationData.map((item) => (
          <span key={item.name}><i className={item.tone} />{item.name} {formatMoney(item.value)}</span>
        ))}
      </div>
      <div className="category-list">
        {data.categoryData.slice(0, 8).map((category, index) => {
          const expanded = expandedCategory === category.name;
          const transactions = data.transactions.filter((transaction) =>
            transaction.date >= monthStart &&
            !transaction.pending &&
            transaction.amount > 0 &&
            transaction.flowType === "spending" &&
            transaction.category === category.name,
          );
          return (
            <div className={`category-group ${expanded ? "expanded" : ""}`} key={category.name}>
              <button
                className="category-row"
                onClick={() => setExpandedCategory(expanded ? null : category.name)}
                aria-expanded={expanded}
              >
                <div><ChevronDown size={14} className="category-chevron" /><span className={`category-dot dot-${index % 5}`} />{category.name}<small>{transactions.length}</small></div>
                <div className="category-track"><span style={{ width: `${(category.value / total) * 100}%` }} /></div>
                <strong>{formatMoney(category.value)}</strong>
              </button>
              {expanded ? (
                <div className="category-transactions">
                  {transactions.map((transaction) => (
                    <div key={transaction.id}>
                      <span>{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <strong>{transaction.name}</strong>
                      <span>{transaction.accountName}</span>
                      <b>−{formatMoney(transaction.amount, true)}</b>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function SpendGuidePanel({ data }: { data: DashboardData }) {
  const guide = data.spendingGuide;
  return (
    <section className="panel spend-guide">
      <div className="guide-main">
        <div className="guide-heading"><div className="guide-icon"><CircleGauge size={19} /></div><div><span>This month</span><h2>Your spending room</h2></div></div>
        <div className="guide-balance"><strong>{guide.available ? formatMoney(guide.remaining, true) : "Unavailable"}</strong><span>remaining this month</span></div>
        <div className="guide-progress" role="progressbar" aria-label="Monthly budget used" aria-valuenow={guide.usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${guide.usedPercent}%` }} /></div>
        <div className="guide-stats">
          <div><span>Monthly budget</span><strong>{formatMoney(guide.monthlyBudget)}</strong></div>
          <div><span>Spent + pending</span><strong>{formatMoney(guide.postedSpending + guide.pendingSpending)}</strong></div>
          <div><span>Funded checking cash</span><strong>{guide.available ? formatMoney(guide.fundedCash) : "Unavailable"}</strong></div>
        </div>
        {!guide.available ? <p className="classic-data-warning">Connect a checking account and resolve missing or unsupported balances to calculate spending room.</p> : guide.fundedCash < guide.budgetRemaining ? <p className="classic-budget-note">Your budget has {formatMoney(guide.budgetRemaining, true)} left; checking currently funds {formatMoney(guide.fundedCash, true)} of it.</p> : null}
        {guide.shortfall > 0 ? <p className="classic-data-warning">Card balances and pending outflows exceed checking cash by {formatMoney(guide.shortfall, true)}.</p> : null}
        <details className="guide-explainer">
          <summary>How this number is calculated</summary>
          <ol>
            <li><span>Budget remaining</span><strong>{formatMoney(guide.monthlyBudget, true)} − {formatMoney(guide.postedSpending, true)} posted − {formatMoney(guide.pendingSpending, true)} pending = {formatMoney(guide.budgetRemaining, true)}</strong></li>
            <li><span>Funded checking cash</span><strong>{formatMoney(guide.spendingCash, true)} checking − {formatMoney(guide.cardBalances, true)} card balances − {formatMoney(guide.pendingOutflows, true)} pending outflows = {guide.available ? formatMoney(guide.fundedCash, true) : "Unavailable"}</strong></li>
            <li><span>Available now</span><strong>The lower of budget remaining and funded checking cash.</strong></li>
          </ol>
          <p>{formatMoney(guide.protectedCash)} in savings and {formatMoney(data.taxReserve.balance)} in your tax reserve stay outside spending room. Transfers between your accounts do not change income or increase the budget. Posted purchases are not deducted from account balances twice.</p>
          <p>The budget resets each calendar month. Upcoming bills still need to fit within the remaining amount.</p>
        </details>
        <div className="classic-budget-editor"><BudgetEditor amount={guide.monthlyBudget} /></div>
      </div>
      <PurchaseCheck data={data} />
    </section>
  );
}

function AdvisorPanel() {
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefError, setBriefError] = useState(false);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/advisor" }), []);
  const { messages, sendMessage, status, error, clearError } = useChat<FinanceAgentUIMessage>({ transport });

  useEffect(() => {
    let active = true;
    fetch("/api/advisor/brief")
      .then(async (response) => {
        if (!response.ok) throw new Error("Brief unavailable");
        return response.json();
      })
      .then((value) => { if (active) setBrief(value.content); })
      .catch(() => { if (active) setBriefError(true); });
    return () => { active = false; };
  }, []);

  function ask(text: string) {
    if (!text.trim() || status === "submitted" || status === "streaming") return;
    clearError();
    void sendMessage({ text }).catch(() => { /* useChat exposes failures through error. */ });
    setInput("");
  }

  return (
    <article className="panel advisor-panel">
      <div className="advisor-head">
        <div className="advisor-mark"><Sparkles size={17} /></div>
        <div><span>Claude Opus 4.6</span><h2>Money copilot</h2></div>
        <i className="live-dot" />
      </div>
      <div className="advisor-body">
        {!brief && !briefError ? (
          <div className="advisor-loading"><LoaderCircle className="spin" size={17} /> Analyzing today’s numbers…</div>
        ) : null}
        {brief ? <div className="advisor-brief"><Bot size={16} /><AdvisorMarkdown>{brief}</AdvisorMarkdown></div> : null}
        {briefError ? <div className="advisor-brief"><Bot size={16} /><p>Ask me anything about the connected accounts and spending.</p></div> : null}
        {messages.map((message) => (
          <div className={`advisor-message ${message.role}`} key={message.id}>
            {message.parts.map((part, index) => part.type === "text" ? <AdvisorMarkdown key={index}>{part.text}</AdvisorMarkdown> : null)}
          </div>
        ))}
        {status === "submitted" ? <div className="advisor-thinking"><span /><span /><span /></div> : null}
        {error ? <p className="advisor-error">The copilot hit a temporary error. Try again.</p> : null}
      </div>
      {!messages.length ? (
        <div className="quick-prompts">
          <button onClick={() => ask("Where am I overspending?")}>Overspending</button>
          <button onClick={() => ask("What should I watch this week?")}>This week</button>
          <button onClick={() => ask("Help me set smart guardrails for this income.")}>Guardrails</button>
        </div>
      ) : null}
      <form className="advisor-input" onSubmit={(event) => { event.preventDefault(); ask(input); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} aria-label="Ask about your money" placeholder="Ask about your money" />
        <button type="submit" disabled={!input.trim() || (status === "submitted" || status === "streaming")} aria-label="Send"><Send size={15} /></button>
      </form>
    </article>
  );
}

function CategorySelect({ transaction }: { transaction: DashboardData["transactions"][number] }) {
  const router = useRouter();
  const [category, setCategory] = useState(transaction.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function update(next: string) {
    const previous = category;
    setCategory(next);
    setSaving(true);
    setError(false);
    try {
      const response = await fetch("/api/transactions/category", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: transaction.id, category: next }),
      });
      if (!response.ok) throw new Error("Category update failed");
      router.refresh();
    } catch {
      setCategory(previous);
      setError(true);
    } finally { setSaving(false); }
  }

  return (
    <div className="category-control">
      <Sparkles size={11} />
      <select value={category} onChange={(event) => update(event.target.value)} disabled={saving} aria-label={`Category for ${transaction.name}`}>
        {TRANSACTION_CATEGORIES.map((option) => <option key={option}>{option}</option>)}
      </select>
      {saving ? <LoaderCircle size={11} className="spin" /> : null}
      {error ? <span role="alert" className="classic-data-warning">Couldn’t save. Try again.</span> : null}
    </div>
  );
}

function TransactionExplorer({ data }: { data: DashboardData }) {
  const [accountKind, setAccountKind] = useState<AccountKind>("all");
  const [accountId, setAccountId] = useState("all");
  const [flowType, setFlowType] = useState<"all" | FlowType>("all");
  const [dateRange, setDateRange] = useState<DateRange>("month");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);

  const filtered = useMemo(() => {
    const now = new Date();
    const monthCutoff = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const threeMonthCutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    const normalizedQuery = query.trim().toLowerCase();
    return data.transactions.filter((transaction) => {
      if (accountKind !== "all" && transaction.accountType !== accountKind) return false;
      if (accountId !== "all" && transaction.accountId !== accountId) return false;
      if (flowType !== "all" && transaction.flowType !== flowType) return false;
      if (dateRange === "month" && transaction.date < monthCutoff) return false;
      if (dateRange === "three_months" && transaction.date < threeMonthCutoff) return false;
      if (normalizedQuery && !`${transaction.name} ${transaction.rawName} ${transaction.category} ${transaction.accountName}`.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [accountId, accountKind, data.transactions, dateRange, flowType, query]);

  return (
    <section className="panel transactions-panel">
      <div className="transactions-head">
        <div><h2>Transactions</h2><span>{filtered.length} results</span></div>
        <div className="segmented-control">
          {(["all", "depository", "credit"] as const).map((value) => (
            <button key={value} className={accountKind === value ? "active" : ""} onClick={() => setAccountKind(value)}>
              {value === "all" ? "All" : value === "depository" ? "Bank" : "Credit card"}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-row">
        <label className="search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search transactions" placeholder="Search" /></label>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Account">
          <option value="all">All accounts</option>
          {data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ··{account.mask}</option>)}
        </select>
        <select value={flowType} onChange={(event) => setFlowType(event.target.value as "all" | FlowType)} aria-label="Activity type">
          <option value="all">All activity</option><option value="spending">Spending</option><option value="income">Income</option><option value="investment">Investments</option><option value="savings">Savings</option><option value="credit_payment">Card payments</option><option value="transfer">Transfers</option><option value="refund">Refunds</option><option value="taxes">Taxes</option>
        </select>
        <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)} aria-label="Date range">
          <option value="month">This month</option><option value="three_months">Last 3 months</option><option value="all">All imported</option>
        </select>
      </div>
      <div className="transaction-table">
        <div className="transaction-header"><span>Date</span><span>To / From</span><span>Account</span><span>Category</span><span>Type</span><span>Amount</span></div>
        {filtered.slice(0, visibleCount).map((transaction) => (
          <div className="transaction-row" key={transaction.id}>
            <span className="transaction-date">{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <div className="merchant-cell"><div className="merchant-mark">{transaction.name.slice(0, 1).toUpperCase()}</div><div><strong>{transaction.name}</strong>{transaction.pending ? <span className="pending-badge">Pending</span> : null}</div></div>
            <span className="account-cell">{transaction.accountName} ··{transaction.accountMask}</span>
            <CategorySelect transaction={transaction} />
            <span className={`flow-badge ${transaction.flowType}`}>{transaction.flowLabel}</span>
            <strong className={transaction.amount < 0 ? "income" : "expense"}>{transaction.amount < 0 ? "+" : "−"}{formatMoney(Math.abs(transaction.amount), true)}</strong>
          </div>
        ))}
        {filtered.length > visibleCount ? <div className="classic-more"><button className="btn btn-quiet" onClick={() => setVisibleCount((count) => count + 100)}>Show more transactions ({visibleCount} of {filtered.length})</button></div> : null}
        {!filtered.length ? <div className="no-results">No transactions match these filters.</div> : null}
      </div>
    </section>
  );
}

export function Dashboard({ initialData, environment }: { initialData: DashboardData; environment: "sandbox" | "production" }) {
  const router = useRouter();
  const taxesOpen = useSyncExternalStore(subscribeToHash, isTaxView, serverTaxView);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [taxesOpen]);
  const latestSync = initialData.items
    .map((item) => parseStoredTimestamp(item.updatedAt).getTime())
    .sort((a, b) => b - a)[0];

  return (
    <main className="classic-dashboard">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Landmark size={19} /></div><strong>Mantini</strong></div>
        <div className="topbar-actions"><a className="classic-nav-link" href={taxesOpen ? "#overview" : "#taxes"}>{taxesOpen ? "Dashboard" : "Taxes"}</a><ConnectionControls environment={environment} />{process.env.NODE_ENV !== "development" ? <UserButton /> : null}</div>
      </header>
      <div className="dashboard-shell">
        <section className="welcome-row">
          <div><h1>{taxesOpen ? "Taxes & reserve" : "Welcome back"}</h1>{latestSync ? <span>Updated {new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(latestSync))}</span> : null}</div>
        </section>

        {taxesOpen ? <TaxesView data={initialData} onRefresh={() => router.refresh()} /> : !initialData.accounts.length ? (
          <section className="panel empty-state"><Landmark size={28} /><h2>Connect an account</h2></section>
        ) : (
          <>
            <section className="hero-grid"><BalancePanel data={initialData} /><AccountPanel data={initialData} /></section>
            <section className="summary-grid">
              <SummaryCard label="Income" value={initialData.monthIncome} note="this month" tone="positive" />
              <SummaryCard label="Spent" value={initialData.monthSpend} note={`${formatMoney(initialData.monthPendingSpend)} pending`} tone="negative" />
              <SummaryCard label="Saved" value={initialData.monthSaved} note="internal reserves" tone="oak" />
              <SummaryCard label="Net worth after tax reserve" value={initialData.netWorthAfterTaxReserve} note={initialData.netWorthReliable ? "tax reserve excluded" : "some balances need a refresh"} tone="muted" />
            </section>
            {(initialData.portfolio.holdings.length || initialData.portfolio.coinbase.configured || initialData.accounts.some((account) => account.type === "investment")) ? <PortfolioPanel data={initialData} /> : null}
            <SpendGuidePanel data={initialData} />
            <section className="insight-grid"><CategoryPanel data={initialData} /><AdvisorPanel /></section>
            <TransactionExplorer data={initialData} />
          </>
        )}
      </div>
    </main>
  );
}
