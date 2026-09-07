"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePlaidLink } from "react-plaid-link";
import { UserButton } from "@clerk/nextjs";
import type { PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { TRANSACTION_CATEGORIES } from "@/lib/categories";
import type { FinanceAgentUIMessage } from "@/lib/ai/finance-agent";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;
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

function ConnectionControls({ environment }: { environment: "sandbox" | "production" }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openedToken = useRef<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!publicToken) return setStatus("Plaid did not return a token");
      setBusy(true);
      setStatus("Importing…");
      const response = await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken, institution: metadata.institution }),
      });
      const result = await response.json();
      setStatus(response.ok ? "Connected" : result.error || "Connection failed");
      if (response.ok) router.refresh();
      setBusy(false);
      setLinkToken(null);
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (error) => {
      if (error) setStatus(error.display_message || error.error_message || "Link closed");
      setLinkToken(null);
    },
  });

  useEffect(() => {
    if (ready && linkToken && openedToken.current !== linkToken) {
      openedToken.current = linkToken;
      open();
    }
  }, [linkToken, open, ready]);

  async function connect() {
    setBusy(true);
    const response = await fetch("/api/plaid/link-token", { method: "POST" });
    const result = await response.json();
    if (!response.ok) setStatus(result.error || "Unable to start Plaid");
    else setLinkToken(result.linkToken);
    setBusy(false);
  }

  async function sync() {
    setBusy(true);
    setStatus("Syncing…");
    const response = await fetch("/api/plaid/sync", { method: "POST" });
    const result = await response.json();
    setStatus(response.ok ? "Up to date" : result.error || "Sync failed");
    if (response.ok) router.refresh();
    setBusy(false);
  }

  return (
    <div className="connection-controls">
      <span className={`environment ${environment}`}>{environment}</span>
      <button className="icon-button" onClick={sync} disabled={busy} aria-label="Sync accounts">
        <RefreshCw size={16} className={busy ? "spin" : ""} />
      </button>
      <button className="button primary" onClick={connect} disabled={busy}>
        <Link2 size={15} /> Add account
      </button>
      {status ? <span className="status-message">{status}</span> : null}
    </div>
  );
}

function AccountPanel({ data }: { data: DashboardData }) {
  const bankingAccounts = data.accounts.filter(
    (account) => account.type === "depository" || account.type === "credit",
  );

  return (
    <article className="panel accounts-hero">
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
                ) : <span>Available cash</span>}
              </div>
            </div>
          );
        })}
      </div>
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
        <div><span>Cash balance</span><strong>{formatMoney(data.totalCash, true)}</strong></div>
        <div className="range-switch" aria-label="Cash history range">
          {(["30", "90", "all"] as const).map((value) => (
            <button key={value} className={range === value ? "active" : ""} onClick={() => setRange(value)}>
              {value === "all" ? "All" : `${value}D`}
            </button>
          ))}
        </div>
      </div>
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
            <ReferenceLine
              y={data.spendingGuide.protectedCash}
              stroke="#6f9f87"
              strokeDasharray="5 6"
              ifOverflow="extendDomain"
              label={{ value: "Protected floor", position: "insideBottomLeft", fill: "#8fb9a5", fontSize: 9 }}
            />
            <Tooltip
              formatter={(value) => [formatMoney(Number(value), true), "Cash balance"]}
              labelStyle={{ color: "#9697a9" }}
              cursor={{ stroke: "#555a85", strokeDasharray: "3 4" }}
              contentStyle={{ background: "#242432", border: "1px solid #3a3a4c", borderRadius: 10, boxShadow: "0 14px 32px rgba(0,0,0,.28)" }}
            />
            <Area
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

function InvestmentConsentButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Show Fidelity holdings");
  const openedToken = useRef<string | null>(null);

  const onSuccess = useCallback(async () => {
    setBusy(true);
    setLabel("Importing holdings…");
    const response = await fetch("/api/plaid/sync", { method: "POST" });
    setLabel(response.ok ? "Holdings connected" : "Try Fidelity again");
    if (response.ok) router.refresh();
    setLinkToken(null);
    setBusy(false);
  }, [router]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setLinkToken(null);
      setBusy(false);
      setLabel("Show Fidelity holdings");
    },
  });

  useEffect(() => {
    if (ready && linkToken && openedToken.current !== linkToken) {
      openedToken.current = linkToken;
      open();
    }
  }, [linkToken, open, ready]);

  async function requestConsent() {
    setBusy(true);
    setLabel("Opening Fidelity…");
    const response = await fetch("/api/plaid/investments-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const result = await response.json();
    if (response.ok) setLinkToken(result.linkToken);
    else {
      setLabel(result.error || "Try Fidelity again");
      setBusy(false);
    }
  }

  return (
    <button className="portfolio-consent" onClick={requestConsent} disabled={busy}>
      {busy ? <LoaderCircle size={12} className="spin" /> : <Link2 size={12} />}
      {label}
    </button>
  );
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
            <TrendingUp size={14} /> {portfolio.totalGain >= 0 ? "+" : "−"}{formatMoney(Math.abs(portfolio.totalGain), true)} all time
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
  const [purchase, setPurchase] = useState("40");
  const [description, setDescription] = useState("");
  const [assessment, setAssessment] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const amount = Math.max(0, Number(purchase) || 0);
  const afterPurchase = data.spendingGuide.remaining - amount;
  const share = data.spendingGuide.monthlyAllowance
    ? (amount / data.spendingGuide.monthlyAllowance) * 100
    : 0;
  const within = afterPurchase >= 0;

  async function askOpus() {
    if (!amount || !description.trim()) return;
    setAssessing(true);
    setAssessment(null);
    const response = await fetch("/api/advisor/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, description }),
    });
    const result = await response.json();
    setAssessment(response.ok ? result.assessment.replace(/\*\*/g, "") : "Opus could not evaluate this purchase right now.");
    setAssessing(false);
  }

  return (
    <article className="panel spend-guide">
      <div className="guide-main">
        <div className="guide-heading">
          <div className="guide-icon"><CircleGauge size={19} /></div>
          <div><span>Spending guardrail</span><h2>Flexible allowance</h2></div>
          <span className="posted-only">Posted income only</span>
        </div>
        <div className="guide-balance">
          <strong>{formatMoney(data.spendingGuide.remaining, true)}</strong>
          <span>remaining this month</span>
        </div>
        <div className="guide-progress"><span style={{ width: `${data.spendingGuide.usedPercent}%` }} /></div>
        <div className="guide-stats">
          <div><span>Starting range</span><strong>{formatMoney(data.spendingGuide.monthlyAllowance)}</strong></div>
          <div><span>Already spent</span><strong>{formatMoney(data.monthSpend)}</strong></div>
          <div><span>Cash left untouched</span><strong>{formatMoney(data.spendingGuide.protectedCash)}</strong></div>
        </div>
        <details className="guide-explainer">
          <summary>How this number is calculated</summary>
          <ol>
            <li><span>After-savings income</span><strong>{formatMoney(data.monthIncome)} income − {formatMoney(data.monthSaved)} moved to savings = {formatMoney(data.spendingGuide.postReserveIncome)}</strong></li>
            <li><span>Income rule</span><strong>{data.spendingGuide.incomeRate}% × {formatMoney(data.spendingGuide.postReserveIncome)} = {formatMoney(data.spendingGuide.incomeAllowance)}</strong></li>
            <li><span>Protected floor</span><strong>{formatMoney(data.spendingGuide.reservedCash)} savings + 3 × {formatMoney(data.spendingGuide.recentMonthlySpend)} = {formatMoney(data.spendingGuide.protectedCash)}</strong></li>
            <li><span>Safe starting range</span><strong>Lower of {formatMoney(data.spendingGuide.incomeAllowance)} or {formatMoney(data.spendingGuide.cashCapacity)} cash capacity</strong></li>
            <li><span>Available now</span><strong>{formatMoney(data.spendingGuide.monthlyAllowance)} − {formatMoney(data.monthSpend)} spent = {formatMoney(data.spendingGuide.remaining)}</strong></li>
          </ol>
          <p>Your savings balance is treated as untouchable. Savings moves, investments, card payments, and transfers are not lifestyle spending. Future payouts wait until they post.</p>
        </details>
      </div>
      <div className="purchase-check">
        <div className="purchase-heading"><div><span>Purchase check</span><h3>Can I buy this?</h3></div><button onClick={askOpus} disabled={assessing || !amount || !description.trim()}>{assessing ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />} Ask Opus</button></div>
        <div className="purchase-fields">
          <label><span>$</span><input type="number" min="0" step="1" value={purchase} onChange={(event) => setPurchase(event.target.value)} aria-label="Purchase amount" /></label>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is it?" aria-label="Purchase description" />
        </div>
        <div className={`purchase-result ${within ? "within" : "over"}`}>
          <strong>{within ? "Within your current guardrail" : "Over your current guardrail"}</strong>
          <p>
            {description || "This purchase"} uses {share.toFixed(1)}% of the monthly range and leaves {formatMoney(Math.max(0, afterPurchase), true)}.
          </p>
        </div>
        {assessment ? <div className="purchase-assessment"><Bot size={14} /><p>{assessment}</p></div> : null}
        <p className="guide-method">
          Starts at {data.spendingGuide.incomeRate}% of posted income after savings transfers, then keeps the full savings balance plus three recent months of spending untouched.
        </p>
      </div>
    </article>
  );
}

function AdvisorPanel() {
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefError, setBriefError] = useState(false);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/advisor" }), []);
  const { messages, sendMessage, status, error } = useChat<FinanceAgentUIMessage>({ transport });

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
    if (!text.trim() || status !== "ready") return;
    sendMessage({ text });
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
        {brief ? <div className="advisor-brief"><Bot size={16} /><p>{brief.replace(/\*\*/g, "")}</p></div> : null}
        {briefError ? <div className="advisor-brief"><Bot size={16} /><p>Ask me anything about the connected accounts and spending.</p></div> : null}
        {messages.map((message) => (
          <div className={`advisor-message ${message.role}`} key={message.id}>
            {message.parts.map((part, index) => part.type === "text" ? <p key={index}>{part.text.replace(/\*\*/g, "")}</p> : null)}
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
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about your money" />
        <button type="submit" disabled={!input.trim() || status !== "ready"} aria-label="Send"><Send size={15} /></button>
      </form>
    </article>
  );
}

function CategorySelect({ transaction }: { transaction: DashboardData["transactions"][number] }) {
  const router = useRouter();
  const [category, setCategory] = useState(transaction.category);
  const [saving, setSaving] = useState(false);

  async function update(next: string) {
    const previous = category;
    setCategory(next);
    setSaving(true);
    const response = await fetch("/api/transactions/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: transaction.id, category: next }),
    });
    if (!response.ok) setCategory(previous);
    else router.refresh();
    setSaving(false);
  }

  return (
    <div className="category-control">
      <Sparkles size={11} />
      <select value={category} onChange={(event) => update(event.target.value)} disabled={saving} aria-label={`Category for ${transaction.name}`}>
        {TRANSACTION_CATEGORIES.map((option) => <option key={option}>{option}</option>)}
      </select>
      {saving ? <LoaderCircle size={11} className="spin" /> : null}
    </div>
  );
}

function TransactionExplorer({ data }: { data: DashboardData }) {
  const [accountKind, setAccountKind] = useState<AccountKind>("all");
  const [accountId, setAccountId] = useState("all");
  const [flowType, setFlowType] = useState<"all" | FlowType>("all");
  const [dateRange, setDateRange] = useState<DateRange>("month");
  const [query, setQuery] = useState("");

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
        <label className="search-control"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label>
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
        {filtered.slice(0, 100).map((transaction) => (
          <div className="transaction-row" key={transaction.id}>
            <span className="transaction-date">{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <div className="merchant-cell"><div className="merchant-mark">{transaction.name.slice(0, 1).toUpperCase()}</div><div><strong>{transaction.name}</strong>{transaction.pending ? <span className="pending-badge">Pending</span> : null}</div></div>
            <span className="account-cell">{transaction.accountName} ··{transaction.accountMask}</span>
            <CategorySelect transaction={transaction} />
            <span className={`flow-badge ${transaction.flowType}`}>{transaction.flowLabel}</span>
            <strong className={transaction.amount < 0 ? "income" : "expense"}>{transaction.amount < 0 ? "+" : "−"}{formatMoney(Math.abs(transaction.amount), true)}</strong>
          </div>
        ))}
        {!filtered.length ? <div className="no-results">No transactions match these filters.</div> : null}
      </div>
    </section>
  );
}

export function Dashboard({ initialData, environment }: { initialData: DashboardData; environment: "sandbox" | "production" }) {
  const latestSync = initialData.items
    .map((item) => parseStoredTimestamp(item.updatedAt).getTime())
    .sort((a, b) => b - a)[0];

  return (
    <main>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Landmark size={19} /></div><strong>Mantini</strong></div>
        <div className="topbar-actions"><ConnectionControls environment={environment} />{process.env.NODE_ENV !== "development" && <UserButton />}</div>
      </header>
      <div className="dashboard-shell">
        <section className="welcome-row">
          <div><h1>Welcome back</h1>{latestSync ? <span>Updated {new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(latestSync))}</span> : null}</div>
        </section>

        {!initialData.accounts.length ? (
          <section className="panel empty-state"><Landmark size={28} /><h2>Connect an account</h2></section>
        ) : (
          <>
            <section className="hero-grid"><BalancePanel data={initialData} /><AccountPanel data={initialData} /></section>
            <section className="summary-grid">
              <SummaryCard label="Income" value={initialData.monthIncome} note="this month" tone="positive" />
              <SummaryCard label="Spent" value={initialData.monthSpend} note={`${formatMoney(initialData.monthPendingSpend)} pending`} tone="negative" />
              <SummaryCard label="Saved" value={initialData.monthSaved} note="internal reserves" tone="oak" />
              <SummaryCard label="Unallocated" value={initialData.monthUnallocated} note="income not assigned" tone="muted" />
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
