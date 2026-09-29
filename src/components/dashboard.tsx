"use client";

import {
  Activity as PreservedView,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { UserButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChartPie,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Landmark,
  LayoutDashboard,
  Menu,
  Search,
  ShieldCheck,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  analyzeTransactions,
  detectRecurring,
  getDateRange,
  getPeriodAnchor,
  isExpense,
  transactionNeedsReview,
  type DatePreset,
} from "@/lib/analytics";
import { TransactionsView } from "./finance/transactions";
import {
  ConnectionControls,
  InvestmentConsentButton,
} from "./finance/connections";
import { AdvisorView } from "./finance/advisor";
import { TaxesView } from "./finance/taxes";
import {
  BalanceChart,
  Breakdown,
  Donut,
  FlowDiagram,
  MonthlyChart,
} from "./finance/charts";
import {
  Change,
  type DashboardData,
  Empty,
  Metric,
  money,
  palette,
  PanelHeader,
  Segments,
  shortDate,
  timestamp,
  ViewLink,
} from "./finance/ui";

const navigation = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "The big picture. All in one place.",
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: ArrowLeftRight,
    description: "Every little detail, beautifully organized.",
  },
  {
    id: "cash-flow",
    label: "Cash flow",
    icon: Activity,
    description: "See where your money comes from. And where it goes.",
  },
  {
    id: "spending",
    label: "Spending",
    icon: ChartPie,
    description: "A little more clarity on your everyday spending.",
  },
  {
    id: "net-worth",
    label: "Net worth",
    icon: ChartNoAxesCombined,
    description: "Your whole financial picture, coming together.",
  },
  {
    id: "investments",
    label: "Investments",
    icon: TrendingUp,
    description: "Stocks, funds, and crypto. One connected portfolio.",
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: Landmark,
    description: "Your financial life, connected.",
  },
  {
    id: "taxes",
    label: "Taxes",
    icon: ReceiptText,
    description: "Money set aside. A clearer picture of what’s yours to use.",
  },
  {
    id: "advisor",
    label: "Money advisor",
    icon: Sparkles,
    description: "Think through your next move with your actual numbers.",
  },
] as const;
type View = (typeof navigation)[number]["id"];
function subscribeView(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function readView(): View {
  const hash = window.location.hash.slice(1).split("?")[0];
  return navigation.find((x) => x.id === hash)?.id || "overview";
}
function subscribeSmallScreen(callback: () => void) {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function readSmallScreen() {
  return window.matchMedia("(max-width: 760px)").matches;
}
const presets: { value: DatePreset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "3-months", label: "Last 3 months" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
];

export function Dashboard({
  initialData: data,
  environment,
}: {
  initialData: DashboardData;
  environment: "sandbox" | "production";
}) {
  const router = useRouter();
  const view = useSyncExternalStore(
    subscribeView,
    readView,
    () => "overview" as View,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const nodes = focusables();
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [mobileOpen]);
  const [preset, setPreset] = useState<DatePreset>("month");
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState<string>();
  const now = useMemo(() => new Date(data.generatedAt), [data.generatedAt]);
  const anchor = useMemo(
    () => getPeriodAnchor(preset, offset, now),
    [preset, offset, now],
  );
  const range = useMemo(
    () => getDateRange(preset, data.transactions, anchor),
    [preset, data.transactions, anchor],
  );
  const analytics = useMemo(
    () => analyzeTransactions(data.transactions, range),
    [data.transactions, range],
  );
  const worth = data.netWorth;
  const active = navigation.find((x) => x.id === view)!;
  const problems =
    data.items.filter((x) => x.status !== "healthy").length +
    [data.portfolio.coinbase, data.portfolio.kraken].filter(
      (x) => x.status === "error",
    ).length;
  const review = data.transactions.filter(transactionNeedsReview).length;
  const connectionCount =
    data.items.length +
    [data.portfolio.coinbase, data.portfolio.kraken].filter((x) => x.configured)
      .length;
  const latestSync = data.items
    .map((x) => timestamp(x.updatedAt))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const periodRelevant = !["accounts", "investments", "advisor", "taxes"].includes(view);
  function drill(name: string) {
    setCategory(name);
    window.location.hash = "transactions";
  }
  return (
    <div
      className="app-shell"
      onClickCapture={(event) => {
        if ((event.target as Element).closest('a[href="#transactions"]'))
          setCategory(undefined);
      }}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
          mainRef.current?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined}
        aria-label="Workspace navigation"
      >
        <a
          href="#overview"
          className="brand"
          onClick={() => setMobileOpen(false)}
        >
          <span className="brand-mark">
            <ChartNoAxesCombined size={24} strokeWidth={1.8} />
          </span>
          <span>
            Mantini<span className="brand-money"> money</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">NM</span>
          <div>
            <strong>Personal finances</strong>
            <span>Your private workspace</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">YOUR MONEY</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              href={`#${item.id}`}
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""} ${item.id === "advisor" ? "advisor-nav" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setMobileOpen(false);
                if (item.id === "transactions") setCategory(undefined);
              }}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "transactions" && review > 0 && <b>{review}</b>}
              {item.id === "accounts" && problems > 0 && (
                <b className="warning-count">{problems}</b>
              )}
              {item.id === "advisor" && <span className="new-label">AI</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Yours. And only yours.</strong>
              <span>A private view of your money.</span>
            </div>
          </div>
          <div className="profile-row">
            <span className="profile-avatar">N</span>
            <div>
              <strong>Nicholas Mantini</strong>
              <span>Personal account</span>
            </div>
            {process.env.NODE_ENV !== "development" && <UserButton />}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-home">Personal workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{active.label}</strong>
          </div>
          <div className="topbar-right">
            <a
              href="#transactions"
              className="icon-btn search-shortcut"
              aria-label="Search transactions"
              onClick={() => setCategory(undefined)}
            >
              <Search size={17} />
            </a>
            <span className={`sync-indicator ${problems ? "attention" : ""}`}>
              <i />
              {problems
                ? `${problems} need attention`
                : connectionCount
                  ? "Connected"
                  : "Not connected"}
            </span>
            <ConnectionControls environment={environment} />
          </div>
        </header>
        <main
          ref={mainRef}
          tabIndex={-1}
          id="main-content"
          className="main-content"
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "A LITTLE CLARITY, EVERY DAY"
                  : "YOUR FINANCIAL PICTURE"}
              </div>
              <h1>
                {view === "overview"
                  ? "Your money, at a glance."
                  : active.label}
              </h1>
              <p>{active.description}</p>
            </div>
            {periodRelevant && (
              <div className="date-controls">
                <div className="date-step">
                  <button
                    className="icon-btn"
                    disabled={preset === "all"}
                    aria-label="Previous period"
                    onClick={() =>
                      setOffset(
                        (x) =>
                          x -
                          (preset === "3-months"
                            ? 3
                            : preset === "ytd"
                              ? 12
                              : 1),
                      )
                    }
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>{range.label}</span>
                  <button
                    className="icon-btn"
                    aria-label="Next period"
                    disabled={offset >= 0 || preset === "all"}
                    onClick={() =>
                      setOffset((x) =>
                        Math.min(
                          0,
                          x +
                            (preset === "3-months"
                              ? 3
                              : preset === "ytd"
                                ? 12
                                : 1),
                        ),
                      )
                    }
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <label className="date-select">
                  <CalendarDays size={15} />
                  <select
                    aria-label="Date range"
                    value={preset}
                    onChange={(e) => {
                      setPreset(e.target.value as DatePreset);
                      setOffset(0);
                    }}
                  >
                    {presets.map((x) => (
                      <option key={x.value} value={x.value}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
          {environment === "sandbox" && (
            <div className="notice sandbox-notice">
              <CircleHelp size={16} />
              <span>
                Sandbox workspace · These are test connections. Production
                accounts remain separate.
              </span>
            </div>
          )}
          {problems > 0 && (
            <a href="#accounts" className="notice attention-notice">
              <CircleHelp size={16} />
              <span>
                {problems} connection{problems === 1 ? " needs" : "s need"}{" "}
                attention. Some balances may be outdated.
              </span>
              <ArrowRight size={16} />
            </a>
          )}
          {(view === "net-worth" || (view === "overview" && problems === 0)) &&
            !data.netWorthReliable &&
            connectionCount > 0 && (
              <div className="notice attention-notice">
                <CircleHelp size={16} />
                <span>
                  Some balances are unavailable, unsupported, or more than 48
                  hours old. Net worth may be incomplete; a new snapshot will be
                  saved after all connections are current.
                </span>
              </div>
            )}
          {view === "overview" && (
            <Overview
              data={data}
              analytics={analytics}
              range={range}
              drill={drill}
            />
          )}
          {view === "transactions" && (
            <TransactionsView
              key={`${range.start}:${range.end}:${category || "all"}`}
              data={data}
              start={range.start}
              end={range.end}
              initialCategory={category}
            />
          )}
          {view === "cash-flow" && (
            <CashFlow data={data} analytics={analytics} range={range} />
          )}
          {view === "spending" && (
            <Spending
              data={data}
              analytics={analytics}
              range={range}
              drill={drill}
              now={now}
            />
          )}
          {view === "net-worth" && (
            <NetWorth data={data} worth={worth} range={range} />
          )}
          {view === "investments" && <Investments data={data} />}
          {view === "accounts" && <Accounts data={data} />}
          {view === "taxes" && <TaxesView data={data} onRefresh={() => router.refresh()} />}
          <PreservedView mode={view === "advisor" ? "visible" : "hidden"}>
            <AdvisorView data={data} />
          </PreservedView>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} /> Private by design
            </span>
            <span>
              {latestSync
                ? `Last bank sync ${latestSync.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${latestSync.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : "Connect an account to get started"}
            </span>
            <span>Mantini Money</span>
          </footer>
        </main>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {navigation.slice(0, 4).map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={view === item.id ? "active" : ""}
            >
              <item.icon size={20} />
              <span>
                {item.id === "transactions" ? "Activity" : item.label}
              </span>
            </a>
          ))}
          <button onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
            <span>More</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
type Analytics = ReturnType<typeof analyzeTransactions>;
type Worth = DashboardData["netWorth"];
type Range = ReturnType<typeof getDateRange>;
function Overview({
  data,
  analytics: a,
  range,
  drill,
}: {
  data: DashboardData;
  analytics: Analytics;
  range: Range;
  drill: (name: string) => void;
}) {
  const cashHistory = data.cashTrendData.filter(
    (x) => x.day >= range.start && x.day <= range.end,
  );
  const recent = a.transactions.slice(0, 5);
  const top = a.breakdown[0];
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Net worth after tax reserve"
          value={money(data.netWorthAfterTaxReserve)}
          note={
            data.netWorthReliable
              ? `${money(data.taxReserve.balance)} reserved for taxes`
              : "Available balances · may be incomplete"
          }
          icon={<ChartNoAxesCombined size={17} />}
        />
        <Metric
          label="Income before tax set-asides"
          value={money(a.totals.income)}
          note={
            <Change value={a.incomeChange} suffix={range.comparisonLabel} />
          }
          icon={<ArrowDownLeft size={17} />}
        />
        <Metric
          label="Spending"
          value={money(a.totals.spending)}
          note={
            <Change
              value={a.spendingChange}
              suffix={range.comparisonLabel}
              invert
            />
          }
          icon={<ArrowUpRight size={17} />}
        />
        <Metric
          label="Net cash flow"
          value={money(a.totals.net)}
          note="Before savings, investments & tax set-asides"
          tone={a.totals.net >= 0 ? "positive" : "negative"}
          icon={<Activity size={17} />}
        />
      </div>
      <div className="overview-main">
        <section className="panel cash-hero">
          <PanelHeader
            title="A clearer view of your cash"
            subtitle="Checking and savings, excluding your tax reserve"
          >
            <span className="badge soft-green">Outside tax reserve</span>
          </PanelHeader>
          <div className="hero-number">
            {money(data.totalCash, true)}
            <span>cash outside tax reserve</span>
          </div>
          <div className="cash-reconciliation">
            <span>All cash <b>{money(data.grossCash, true)}</b></span>
            <span>Tax reserve <b>−{money(data.taxReserve.balance, true)}</b></span>
            <ViewLink href="#taxes">Manage reserve</ViewLink>
          </div>
          <BalanceChart data={cashHistory} />
          <div className="chart-footnote">
            <i />
            Outside-reserve balances reconstructed from imported bank activity.
          </div>
        </section>
        <section className="panel spending-overview">
          <PanelHeader title="Where it went" subtitle="Spending this period">
            <ViewLink href="#spending">Explore</ViewLink>
          </PanelHeader>
          <Donut data={a.breakdown} total={a.totals.spending} />
          <div className="mini-legend">
            {a.breakdown.slice(0, 4).map((x, i) => (
              <button key={x.name} onClick={() => drill(x.name)}>
                <span>
                  <i style={{ background: x.color || palette[i] }} />
                  {x.name}
                </span>
                <strong>{money(x.value)}</strong>
              </button>
            ))}
          </div>
          {!a.breakdown.length && (
            <p className="muted">
              Choose a wider date range to see more activity.
            </p>
          )}
        </section>
      </div>
      <div className="insight-strip">
        <div className="insight-symbol">
          <Sparkles size={20} />
        </div>
        <div>
          <strong>
            {top
              ? `${top.name} is your largest spending category.`
              : "A connected picture makes the next decision easier."}
          </strong>
          <p>
            {top
              ? `${money(top.value)} across ${top.count} transactions · ${top.percent.toFixed(0)}% of your spending this period.`
              : "Connect your accounts to start discovering your spending patterns."}
          </p>
        </div>
        <a className="text-link" href="#advisor">
          Let’s take a closer look <ArrowRight size={15} />
        </a>
      </div>
      <div className="overview-lower">
        <section className="panel">
          <PanelHeader
            title="Recent activity"
            subtitle="The latest across your accounts"
          >
            <ViewLink href="#transactions" />
          </PanelHeader>
          <div className="recent-list">
            {recent.length ? (
              recent.map((t) => (
                <a href="#transactions" className="recent-row" key={t.id}>
                  <span
                    className={`merchant-avatar tone-${Math.abs(t.name.charCodeAt(0)) % 5}`}
                  >
                    {t.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{t.name}</strong>
                    <span>
                      {t.category} · {shortDate(t.date)}
                      {t.pending ? " · Pending" : ""}
                    </span>
                  </div>
                  <b className={t.amount < 0 ? "positive" : ""}>
                    {t.amount < 0 ? "+" : "−"}
                    {money(Math.abs(t.amount), true)}
                  </b>
                </a>
              ))
            ) : (
              <Empty title="No transactions this period" />
            )}
          </div>
        </section>
        <section className="panel">
          <PanelHeader
            title="Your accounts"
            subtitle={`${data.accounts.length} bank and investment accounts`}
          >
            <ViewLink href="#accounts" />
          </PanelHeader>
          <AccountRows data={data} limit={4} />
          <div className="panel-bottom">
            <span className="muted">Investments & crypto</span>
            <strong>{money(data.portfolio.totalValue)}</strong>
            <a
              href="#investments"
              className="icon-btn"
              aria-label="View investments"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
function CashFlow({
  data,
  analytics: a,
  range,
}: {
  data: DashboardData;
  analytics: Analytics;
  range: Range;
}) {
  const [preferredMode, setMode] = useState<"flow" | "table" | null>(null);
  const smallScreen = useSyncExternalStore(
    subscribeSmallScreen,
    readSmallScreen,
    () => false,
  );
  const mode = preferredMode || (smallScreen ? "table" : "flow");
  const categoryAnalysis = useMemo(
    () =>
      analyzeTransactions(
        data.transactions.filter(
          (transaction) => transaction.flowType !== "taxes",
        ),
        range,
        "category",
      ),
    [data.transactions, range],
  );
  const spendingBeforeTax = a.totals.spending - a.totals.taxes;
  const out = a.totals.spending + a.totals.invested + a.totals.saved;
  const remaining = a.totals.income + a.totals.refunds - out;
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Income before tax set-asides"
          value={money(a.totals.income)}
          note={
            <Change value={a.incomeChange} suffix={range.comparisonLabel} />
          }
        />
        <Metric
          label="Spending & taxes"
          value={money(a.totals.spending)}
          note={`${money(a.totals.refunds)} in refunds`}
        />
        <Metric
          label="Net cash flow"
          value={money(a.totals.net)}
          note="Before savings, investments & tax set-asides"
          tone={a.totals.net >= 0 ? "positive" : "negative"}
        />
        <Metric
          label="Cash-flow margin"
          value={
            a.totals.savingsRate !== null
              ? `${a.totals.savingsRate.toFixed(1)}%`
              : "—"
          }
          note="Net cash flow as a share of income"
        />
      </div>
      <section className="panel">
        <PanelHeader
          title="Follow your money"
          subtitle="From money in to the things that matter"
        >
          <Segments
            value={mode}
            onChange={setMode}
            label="Cash flow view"
            options={[
              { value: "flow", label: "Flow diagram" },
              { value: "table", label: "Income & outflows" },
            ]}
          />
        </PanelHeader>
        {mode === "flow" ? (
          <FlowDiagram
            income={a.totals.income}
            refunds={a.totals.refunds}
            spending={spendingBeforeTax}
            taxes={a.totals.taxes}
            invested={a.totals.invested}
            saved={a.totals.saved}
            categories={categoryAnalysis.breakdown}
          />
        ) : (
          <div className="cash-flow-table">
            {[
              { name: "Income", value: a.totals.income },
              { name: "Refunds", value: a.totals.refunds },
              { name: "Spending before taxes", value: -spendingBeforeTax },
              { name: "Taxes", value: -a.totals.taxes },
              { name: "Invested", value: -a.totals.invested },
              { name: "Moved to savings / tax reserve", value: -a.totals.saved },
              { name: "Remaining after allocations", value: remaining },
            ].map((x) => (
              <div key={x.name}>
                <span>{x.name}</span>
                <span>
                  {a.totals.income
                    ? `${((Math.abs(x.value) / a.totals.income) * 100).toFixed(1)}% of income`
                    : "—"}
                </span>
                <strong className={x.value >= 0 ? "positive" : ""}>
                  {money(x.value, true)}
                </strong>
              </div>
            ))}
          </div>
        )}
        <p className="panel-note">
          Posted transactions only. Transfers and card payments are excluded to
          avoid counting the same money twice. Moving money into the tax reserve
          does not reduce income or count as a tax payment. Balance funding shows outflows
          above income and refunds.
        </p>
      </section>
      <div className="two-columns">
        <section className="panel">
          <PanelHeader title="Money in" subtitle="Your income sources" />
          <Breakdown data={a.incomeBreakdown} />
        </section>
        <section className="panel">
          <PanelHeader title="Money out" subtitle="Spending, including taxes" />
          <Breakdown data={a.breakdown} />
        </section>
      </div>
      <section className="panel">
        <PanelHeader
          title="Income meets spending"
          subtitle="A month-by-month perspective"
        />
        <div className="chart-legend">
          <span>
            <i style={{ background: "#367e6d" }} />
            Income
          </span>
          <span>
            <i style={{ background: "#b9c8c3" }} />
            Spending
          </span>
        </div>
        <MonthlyChart data={a.monthlyTrend} />
      </section>
    </div>
  );
}
function Spending({
  data,
  analytics: a,
  range,
  drill,
  now,
}: {
  data: DashboardData;
  analytics: Analytics;
  range: Range;
  drill: (name: string) => void;
  now: Date;
}) {
  const [group, setGroup] = useState<"group" | "category" | "merchant">(
    "category",
  );
  const grouped = useMemo(
    () => analyzeTransactions(data.transactions, range, group),
    [data.transactions, range, group],
  );
  const recurring = useMemo(
    () => detectRecurring(data.transactions, now),
    [data.transactions, now],
  );
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Total spending"
          value={money(a.totals.spending)}
          note={
            <Change
              value={a.spendingChange}
              suffix={range.comparisonLabel}
              invert
            />
          }
        />
        <Metric
          label="Monthly average"
          value={money(a.averageMonthlySpending)}
          note="Across months in this period"
        />
        <Metric
          label="Largest category"
          value={a.breakdown[0]?.name || "—"}
          note={
            a.breakdown[0]
              ? `${a.breakdown[0].percent.toFixed(1)}% of spending`
              : "No posted spending"
          }
        />
        <Metric
          label="Spending transactions"
          value={a.posted.filter(isExpense).length}
          note={`${money(a.totals.pendingSpending)} pending`}
        />
      </div>
      <section className="panel">
        <PanelHeader
          title="Your spending, unpacked"
          subtitle="Understand the patterns behind the purchases"
        >
          <Segments
            value={group}
            onChange={setGroup}
            label="Group spending by"
            options={[
              { value: "group", label: "Groups" },
              { value: "category", label: "Categories" },
              { value: "merchant", label: "Merchants" },
            ]}
          />
        </PanelHeader>
        <div className="spending-breakdown">
          <div>
            <Donut data={grouped.breakdown} total={a.totals.spending} />
            <p className="center-note">
              {range.label}
              <br />
              Posted spending, including taxes · refunds shown in cash flow
            </p>
          </div>
          <Breakdown
            data={grouped.breakdown}
            onSelect={group === "category" ? drill : undefined}
          />
        </div>
        {group === "category" && (
          <p className="panel-note">
            Select a category to explore its transactions.
          </p>
        )}
      </section>
      <section className="panel">
        <PanelHeader
          title="Spending over time"
          subtitle="Spot the months that look a little different"
        />
        <MonthlyChart data={a.monthlyTrend} spendingOnly />
      </section>
      <section className="panel">
        <PanelHeader
          title="The repeat appearances"
          subtitle="Estimated recurring charges, detected from your imported history"
        >
          <span className="badge">{recurring.length} patterns</span>
        </PanelHeader>
        {recurring.length ? (
          <div className="recurring-grid">
            {recurring.slice(0, 12).map((x, i) => (
              <div className="recurring-item" key={`${x.accountId}-${x.name}`}>
                <span className={`merchant-avatar tone-${i % 5}`}>
                  {x.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{x.name}</strong>
                  <span>
                    {x.cadence} · next around {shortDate(x.nextDate)}
                  </span>
                </div>
                <b>{money(x.amount, true)}</b>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No recurring patterns yet">
            Recurring estimates appear after several similar posted charges.
            They are predictions, not scheduled bills.
          </Empty>
        )}
        <p className="panel-note">
          Estimates, not confirmed subscriptions. Actual charge dates and
          amounts may vary.
        </p>
      </section>
    </div>
  );
}
function NetWorth({
  data,
  worth: w,
  range,
}: {
  data: DashboardData;
  worth: Worth;
  range: Range;
}) {
  const [chart, setChart] = useState<"netWorth" | "assets" | "liabilities">(
    "netWorth",
  );
  const history = data.netWorthAfterTaxReserveHistory.filter(
    (x) => x.date >= range.start && x.date <= range.end,
  );
  const assetsAfterReserve = Math.max(0, w.assets - data.taxReserve.balance);
  const allocation = w.allocation.map((entry) => entry.name === "Cash"
    ? { ...entry, name: "Cash outside tax reserve", value: Math.max(0, entry.value - data.taxReserve.balance) }
    : entry).filter((entry) => entry.value > 0);
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Net worth after tax reserve"
          value={money(data.netWorthAfterTaxReserve)}
          note={
            data.netWorthReliable
              ? "Assets − liabilities − tax reserve"
              : "Available balances · may be incomplete"
          }
        />
        <Metric
          label="Assets outside tax reserve"
          value={money(assetsAfterReserve)}
          note="Cash, investments, crypto & other assets"
          tone="positive"
        />
        <Metric
          label="Total liabilities"
          value={money(w.liabilities)}
          note="Card balances, loans & overdrafts"
        />
        <Metric
          label="Tax reserve"
          value={money(data.taxReserve.balance)}
          note={<a className="text-link" href="#taxes">Manage reserve <ArrowRight size={13} /></a>}
        />
      </div>
      <section className="panel">
        <PanelHeader
          title="The bigger picture"
          subtitle="Recorded balances after setting aside your tax reserve"
        >
          <Segments
            value={chart}
            onChange={setChart}
            label="Net worth chart metric"
            options={[
              { value: "netWorth", label: "After reserve" },
              { value: "assets", label: "Assets after reserve" },
              { value: "liabilities", label: "Liabilities" },
            ]}
          />
        </PanelHeader>
        {history.length > 1 ? (
          <BalanceChart
            data={history.map((x) => ({ ...x, date: shortDate(x.date) }))}
            dataKey={chart}
            label={chart === "netWorth" ? "Net worth after tax reserve" : chart === "assets" ? "Assets after tax reserve" : "Liabilities"}
          />
        ) : (
          <div className="history-start">
            <div className="history-icon">
              <ChartNoAxesCombined size={28} />
            </div>
            <h3>A new chapter starts here.</h3>
            <p>
              Your current net worth after tax reserve is {money(data.netWorthAfterTaxReserve)}. Daily balance
              snapshots will build your history from here, without guessing at
              past market values.
            </p>
            <span className="badge soft-green">
              {history.length
                ? `First snapshot · ${shortDate(history[0].date)}`
                : "No snapshots in this period"}
            </span>
          </div>
        )}
        <p className="panel-note">
          Connected assets only. Account balances can update at different times.
          No property or other unconnected assets are included. Historical
          snapshots use the reserve balance recorded on each date. History starts
          fresh when you change which accounts are reserved for taxes.
        </p>
        <div className="cash-reconciliation net-worth-reconciliation">
          <span>Full connected net worth <b>{money(w.netWorth, true)}</b></span>
          <span>Less tax reserve <b>{money(data.taxReserve.balance, true)}</b></span>
          <span>After reserve <b>{money(data.netWorthAfterTaxReserve, true)}</b></span>
        </div>
      </section>
      <div className="two-columns">
        <section className="panel">
          <PanelHeader
            title="Assets outside your tax reserve"
            subtitle="Your reserve is tracked separately in Taxes"
          />
          <div className="asset-donut">
            <Donut data={allocation} total={assetsAfterReserve} label="After tax reserve" />
          </div>
          <Breakdown data={allocation} />
        </section>
        <section className="panel">
          <PanelHeader
            title="What you owe"
            subtitle="Card balances, loans, and overdrafts"
          />
          {data.accounts.some(
            (x) =>
              (["credit", "loan"].includes(x.type) &&
                (x.currentBalance ?? 0) > 0) ||
              (!["credit", "loan"].includes(x.type) &&
                (x.currentBalance ?? 0) < 0),
          ) ? (
            <AccountRows
              data={{
                ...data,
                accounts: data.accounts.filter(
                  (x) =>
                    (["credit", "loan"].includes(x.type) &&
                      (x.currentBalance ?? 0) > 0) ||
                    (!["credit", "loan"].includes(x.type) &&
                      (x.currentBalance ?? 0) < 0),
                ),
              }}
            />
          ) : (
            <Empty title="No connected liabilities" />
          )}
          <div className="panel-bottom">
            <span>Total liabilities</span>
            <strong>{money(w.liabilities, true)}</strong>
          </div>
        </section>
      </div>
    </div>
  );
}
function Investments({ data }: { data: DashboardData }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const portfolio = data.portfolio;
  const holdings = portfolio.holdings.filter(
    (h) =>
      (filter === "all" || h.institutionName === filter) &&
      `${h.name} ${h.ticker || ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const fidelity = data.items.find((x) => /fidelity/i.test(x.institutionName));
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Portfolio value"
          value={money(portfolio.totalValue, true)}
          note="Current holdings & investment balances"
        />
        <Metric
          label="Unrealized gain / loss"
          value={money(portfolio.totalGain, true)}
          note={
            portfolio.totalGain === null
              ? "Complete cost basis is not available"
              : "Across holdings with reported cost basis"
          }
          tone={
            portfolio.totalGain !== null && portfolio.totalGain >= 0
              ? "positive"
              : "muted"
          }
        />
        <Metric
          label="Holdings"
          value={portfolio.holdings.length}
          note="Stocks, funds, crypto & account totals"
        />
        <Metric
          label="Institutions"
          value={portfolio.byInstitution.length}
          note="Connected to your portfolio"
        />
      </div>
      <div className="investment-top">
        <section className="panel">
          <PanelHeader
            title="A portfolio that’s all together"
            subtitle="Allocation by institution"
          />
          <div className="portfolio-allocation">
            <Donut
              data={portfolio.byInstitution}
              total={portfolio.totalValue}
              label="Portfolio value"
            />
            <Breakdown data={portfolio.byInstitution} />
          </div>
        </section>
        <section className="panel connection-summary">
          <PanelHeader
            title="Portfolio connections"
            subtitle="A pulse on your investment data"
          />
          {[
            ...data.items
              .filter((x) =>
                data.accounts.some(
                  (a) =>
                    a.type === "investment" &&
                    a.institutionName === x.institutionName,
                ),
              )
              .map((x) => ({
                name: x.institutionName,
                status: x.status === "healthy" ? "connected" : x.status,
              })),
            { name: "Coinbase", status: portfolio.coinbase.status },
            { name: "Kraken", status: portfolio.kraken.status },
          ].map((x) => (
            <div className="provider-status" key={x.name}>
              <span className="institution-icon">
                <Landmark size={18} />
              </span>
              <strong>{x.name}</strong>
              <span
                className={`badge ${x.status === "connected" ? "soft-green" : ""}`}
              >
                {x.status === "connected"
                  ? "Connected"
                  : x.status === "error"
                    ? "Needs attention"
                    : "Not connected"}
              </span>
            </div>
          ))}
          {fidelity &&
            portfolio.holdings.some(
              (x) =>
                /fidelity/i.test(x.institutionName) && x.type === "account",
            ) && <InvestmentConsentButton itemId={fidelity.id} />}
          <p className="panel-note">
            Values reflect each provider’s latest available update, not
            real-time market quotes.
          </p>
        </section>
      </div>
      <section className="panel">
        <PanelHeader
          title="Your holdings"
          subtitle={`${holdings.length} positions in this view`}
        >
          <div className="inline-filters">
            <label className="search-field">
              <Search size={15} />
              <input
                aria-label="Search holdings"
                placeholder="Find a holding…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              className="field"
              aria-label="Filter investment institution"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All institutions</option>
              {portfolio.byInstitution.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
          </div>
        </PanelHeader>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Institution</th>
                <th className="align-right">Quantity</th>
                <th className="align-right">Price</th>
                <th className="align-right">Value</th>
                <th className="align-right">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr key={`${h.accountId}-${h.securityId}`}>
                  <td>
                    <div className="asset-cell">
                      <span className={`merchant-avatar tone-${i % 5}`}>
                        {(h.ticker || h.name).slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{h.name}</strong>
                        <span>
                          {h.ticker || h.subtype || h.type}
                          {h.type === "account" ? " · balance only" : ""}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>{h.institutionName}</td>
                  <td className="align-right">
                    {h.type === "account"
                      ? "—"
                      : new Intl.NumberFormat("en-US", {
                          maximumFractionDigits: 6,
                        }).format(h.quantity)}
                  </td>
                  <td className="align-right">{money(h.price, true)}</td>
                  <td className="align-right">
                    <strong>{money(h.value, true)}</strong>
                  </td>
                  <td className="align-right">
                    {portfolio.totalValue
                      ? ((h.value / portfolio.totalValue) * 100).toFixed(1)
                      : 0}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!holdings.length && <Empty title="No holdings match this view" />}
        <p className="panel-note">
          Balances shown in USD. Small positions below $1 and previously
          excluded holdings remain hidden from this holdings view; connected net
          worth uses full account balances.
        </p>
      </section>
    </div>
  );
}
function AccountRows({
  data,
  limit,
  types,
}: {
  data: DashboardData;
  limit?: number;
  types?: string[];
}) {
  const accounts = data.accounts
    .filter((a) => !types || types.includes(a.type))
    .slice(0, limit);
  return (
    <div className="account-list">
      {accounts.length ? (
        accounts.map((a) => (
          <div className="account-row" key={a.id}>
            <span
              className={`institution-icon ${a.type === "credit" ? "credit" : ""}`}
            >
              {a.type === "credit" ? (
                <CreditCard size={19} />
              ) : a.type === "investment" ? (
                <TrendingUp size={19} />
              ) : (
                <Landmark size={19} />
              )}
            </span>
            <div className="account-detail">
              <strong>{a.name}{a.isTaxReserve && <span className="badge tax-reserve-badge">Tax reserve</span>}</strong>
              <span>
                {a.institutionName}
                {a.mask ? ` ··${a.mask}` : ""}
              </span>
            </div>
            <div className="account-balance">
              <strong>{money(a.currentBalance, true)}</strong>
              <span>
                {a.type === "credit"
                  ? "Current balance"
                  : a.subtype?.replaceAll("_", " ") || a.type}
              </span>
            </div>
          </div>
        ))
      ) : (
        <Empty title="No connected accounts yet" />
      )}
    </div>
  );
}
function Accounts({ data }: { data: DashboardData }) {
  const [kind, setKind] = useState("all");
  const filtered = {
    ...data,
    accounts: data.accounts.filter((x) => kind === "all" || x.type === kind),
  };
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        <Metric
          label="Cash outside tax reserve"
          value={money(data.totalCash)}
          note={`${money(data.taxReserve.balance)} separately reserved for taxes`}
        />
        <Metric
          label="Credit card balances"
          value={money(
            data.accounts
              .filter((x) => x.type === "credit")
              .reduce((s, x) => s + (x.currentBalance || 0), 0),
          )}
          note="Posted balances; pending shown below"
        />
        <Metric
          label="Investment accounts"
          value={data.accounts.filter((x) => x.type === "investment").length}
          note="Bank-connected investment accounts"
        />
        <Metric
          label="Connections"
          value={
            data.items.length +
            [data.portfolio.coinbase, data.portfolio.kraken].filter(
              (x) => x.configured,
            ).length
          }
          note="Banks, brokerages & crypto"
        />
      </div>
      <section className="panel">
        <PanelHeader
          title="Everything, connected"
          subtitle="Current balances from your financial institutions"
        >
          <select
            className="field"
            aria-label="Filter account type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">All account types</option>
            <option value="depository">Cash & savings</option>
            <option value="credit">Credit cards</option>
            <option value="investment">Investments</option>
            <option value="loan">Loans</option>
          </select>
        </PanelHeader>
        <AccountRows data={filtered} />
      </section>
      <section className="panel">
        <PanelHeader
          title="Connection health"
          subtitle="Know when your data was last updated"
        />
        <div className="connection-health">
          {data.items.map((item) => (
            <div className="health-row" key={item.id}>
              <span className="institution-icon">
                <Landmark size={20} />
              </span>
              <div>
                <strong>{item.institutionName}</strong>
                <span>
                  {item.errorMessage ||
                    `Last synced ${timestamp(item.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                </span>
              </div>
              <span
                className={`badge ${item.status === "healthy" ? "soft-green" : "soft-red"}`}
              >
                {item.status === "healthy" ? (
                  <>
                    <Check size={12} />
                    Connected
                  </>
                ) : (
                  "Needs attention"
                )}
              </span>
            </div>
          ))}
          {[
            { name: "Coinbase", ...data.portfolio.coinbase },
            { name: "Kraken", ...data.portfolio.kraken },
          ].map((item) => (
            <div className="health-row" key={item.name}>
              <span className="institution-icon">
                <Wallet size={20} />
              </span>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.error ||
                    (item.updatedAt
                      ? `Updated ${timestamp(item.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                      : item.configured
                        ? "Waiting for data"
                        : "View-only API credentials not configured")}
                </span>
              </div>
              <span
                className={`badge ${item.status === "connected" ? "soft-green" : item.status === "error" ? "soft-red" : ""}`}
              >
                {item.status === "connected"
                  ? "Connected"
                  : item.status === "error"
                    ? "Needs attention"
                    : "Not connected"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelHeader
          title="Credit card details"
          subtitle="Pending activity and upcoming payments"
        />
        {data.accounts.some((x) => x.type === "credit") ? (
          <div className="credit-grid">
            {data.accounts
              .filter((x) => x.type === "credit")
              .map((a) => (
                <div className="credit-detail" key={a.id}>
                  <div>
                    <CreditCard size={20} />
                    <strong>{a.name}</strong>
                    <span>··{a.mask || "—"}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Posted balance</dt>
                      <dd>{money(a.currentBalance, true)}</dd>
                    </div>
                    <div>
                      <dt>Pending activity</dt>
                      <dd>{money(a.pendingOutflow, true)}</dd>
                    </div>
                    <div>
                      <dt>Credit limit</dt>
                      <dd>{money(a.creditLimit)}</dd>
                    </div>
                    <div>
                      <dt>Minimum payment</dt>
                      <dd>{money(a.minimumPayment, true)}</dd>
                    </div>
                    <div>
                      <dt>Next payment due</dt>
                      <dd>
                        {a.nextPaymentDueDate
                          ? shortDate(a.nextPaymentDueDate)
                          : "Not provided"}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
          </div>
        ) : (
          <Empty title="No credit cards connected" />
        )}
      </section>
    </div>
  );
}
