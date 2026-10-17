"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUpRight, Bot, Check, ChevronRight, CircleAlert, CircleGauge, LoaderCircle, RefreshCw, Send, ShieldCheck, ShoppingBag, Sparkles, Square, Wallet } from "lucide-react";
import type { FinanceAgentUIMessage } from "@/lib/ai/finance-agent";
import { AdvisorMarkdown } from "./advisor-markdown";
import "./finance-tools.css";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;
type Brief = { content: string; updatedAt: string; cached: boolean };

function money(value: number, cents = false) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0 }).format(value);
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PurchaseCheck({ data }: { data: DashboardData }) {
  const [amountText, setAmountText] = useState("");
  const [description, setDescription] = useState("");
  const [assessment, setAssessment] = useState<string | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const amount = Number(amountText);
  const validAmount = amountText.trim() !== "" && Number.isFinite(amount) && amount > 0 && amount <= 1_000_000;
  const afterPurchase = data.spendingGuide.remaining - amount;
  const within = data.spendingGuide.available && afterPurchase >= 0;


  function invalidateAssessment() {
    requestController.current?.abort();
    requestVersion.current += 1;
    setAssessment(null);
    setAssessmentError(null);
    setAssessing(false);
  }

  useEffect(() => () => { requestController.current?.abort(); }, []);

  async function assessPurchase() {
    if (!validAmount || !description.trim() || assessing) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const version = ++requestVersion.current;
    setAssessing(true);
    setAssessment(null);
    setAssessmentError(null);
    try {
      const response = await fetch("/api/advisor/purchase", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, description: description.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.assessment !== "string") throw new Error(result?.error || "The advisor could not evaluate this purchase. Please try again.");
      if (!controller.signal.aborted && requestVersion.current === version) setAssessment(result.assessment);
    } catch (error) {
      if (!controller.signal.aborted && requestVersion.current === version) setAssessmentError(failureMessage(error, "Could not connect to the advisor. Please try again."));
    } finally {
      if (!controller.signal.aborted && requestVersion.current === version) setAssessing(false);
    }
  }

  return (
    <article className="panel advisor-purchase">
      <div className="panel-header"><div className="advisor-heading-icon"><ShoppingBag size={17} /><h2>Can I buy this?</h2></div></div>
      <p className="advisor-panel-intro">See how a purchase fits your current spending room.</p>
      <form onSubmit={(event) => { event.preventDefault(); void assessPurchase(); }}>
        <label className="advisor-field-label" htmlFor="purchase-description">What are you thinking about?</label>
        <input className="field" id="purchase-description" value={description} maxLength={120} placeholder="A weekend away, new headphones…" onChange={(event) => { setDescription(event.target.value); invalidateAssessment(); }} />
        <label className="advisor-field-label" htmlFor="purchase-amount">Purchase amount</label>
        <div className="advisor-amount-input"><span>$</span><input id="purchase-amount" type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" placeholder="0.00" value={amountText} onChange={(event) => { setAmountText(event.target.value); invalidateAssessment(); }} /></div>
        {validAmount && data.spendingGuide.available ? <div className={`advisor-purchase-result ${within ? "advisor-within" : "advisor-over"}`}>
          {within ? <Check size={17} /> : <CircleAlert size={17} />}
          <div><strong>{within ? "Within your spending room" : "Above your spending room"}</strong><p>{within ? `${money(afterPurchase, true)} would remain.` : `${money(Math.abs(afterPurchase), true)} above your spending room.`}</p></div>
        </div> : null}
        <button className="btn btn-primary advisor-purchase-button" type="submit" disabled={!data.spendingGuide.available || !validAmount || !description.trim() || assessing}>
          {assessing ? <LoaderCircle size={15} className="tools-spin" /> : <Sparkles size={15} />}
          {assessing ? "Checking your finances…" : "Get the advisor’s take"}
        </button>
      </form>
      {assessment ? <div className="advisor-assessment" role="status"><Bot size={17} /><AdvisorMarkdown>{assessment}</AdvisorMarkdown></div> : null}
      {assessmentError ? <p className="tools-inline-error" role="alert">{assessmentError}</p> : null}
      <p className="advisor-fine-print">Card balances and pending outflows are already deducted. Upcoming bills still need to fit within this money.</p>
    </article>
  );
}

export function BudgetEditor({ amount }: { amount: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/spending-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudget: Number(draft) }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Unable to save budget.");
      setEditing(false);
      router.refresh();
    } catch (failure) { setError(failureMessage(failure, "Unable to save budget.")); }
    finally { setSaving(false); }
  }
  if (!editing) return <button className="btn btn-quiet" onClick={() => { setDraft(String(amount)); setError(null); setEditing(true); }}>Edit monthly budget</button>;
  return <form onSubmit={(event) => void save(event)}>
    <label className="advisor-field-label" htmlFor="monthly-spending-budget">Monthly budget ($)</label>
    <input className="field" id="monthly-spending-budget" type="number" min="0" max="1000000" step="0.01" required value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
    <button className="btn btn-primary" disabled={saving || draft.trim() === ""} type="submit">{saving ? "Saving…" : "Save budget"}</button>
    <button className="btn btn-quiet" disabled={saving} type="button" onClick={() => setEditing(false)}>Cancel</button>
    {error ? <p className="tools-inline-error" role="alert">{error}</p> : null}
  </form>;
}

function SpendingContext({ data }: { data: DashboardData }) {
  const guide = data.spendingGuide;
  return (
    <article className="panel advisor-guardrail">
      <div className="panel-header"><div className="advisor-heading-icon"><CircleGauge size={17} /><h2>Your spending room</h2></div><span className="badge">This month</span></div>
      <div className="advisor-allowance"><strong>{guide.available ? money(guide.remaining, true) : "Unavailable"}</strong><span>remaining within your budget and funded cash</span></div>
      <p className="advisor-fine-print">{guide.available ? `${money(guide.monthlyBudget)} a month for bills and everyday spending. Savings top-ups fund the budget without increasing it.` : "Connect a checking account and resolve missing or unsupported balances to calculate spending room."}</p>
      <div className="advisor-progress" role="progressbar" aria-label="Monthly budget used" aria-valuenow={guide.usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${guide.usedPercent}%` }} /></div>
      <div className="advisor-progress-labels"><span>{money(guide.postedSpending + guide.pendingSpending)} spent + pending</span><span>{money(guide.monthlyBudget)} budget</span></div>
      {guide.available && guide.fundedCash < guide.budgetRemaining ? <p className="advisor-fine-print">Your budget has {money(guide.budgetRemaining, true)} left. Transfer {money(guide.budgetRemaining - guide.fundedCash, true)} into checking to fully fund it.</p> : null}
      {guide.shortfall > 0 ? <p className="tools-inline-error">Card balances and pending outflows exceed your funded cash by {money(guide.shortfall, true)}.</p> : null}
      <div className="advisor-protected"><ShieldCheck size={20} /><div><strong>{money(guide.protectedCash)} in savings</strong><span>Kept outside your spending room; tax reserve excluded separately</span></div></div>
      <details className="advisor-method">
        <summary>How your spending room works <ChevronRight size={14} /></summary>
        <dl>
          <div><dt>Monthly budget</dt><dd>{money(guide.monthlyBudget, true)}</dd></div>
          <div><dt>Posted spending this month</dt><dd>−{money(guide.postedSpending, true)}</dd></div>
          <div><dt>Pending spending this month</dt><dd>−{money(guide.pendingSpending, true)}</dd></div>
          <div><dt>Budget remaining</dt><dd>{money(guide.budgetRemaining, true)}</dd></div>
          <div><dt>{guide.spendingAccountNames.join(" + ") || "Checking accounts"} · posted balance</dt><dd>{money(guide.spendingCash, true)}</dd></div>
          <div><dt>Card balances to cover</dt><dd>−{money(guide.cardBalances, true)}</dd></div>
          <div><dt>Pending outflows to cover</dt><dd>−{money(guide.pendingOutflows, true)}</dd></div>
          <div><dt>Funded cash</dt><dd>{guide.available ? money(guide.fundedCash, true) : "Unavailable"}</dd></div>
          <div><dt>Spending room · lower of the two</dt><dd>{guide.available ? money(guide.remaining, true) : "Unavailable"}</dd></div>
        </dl>
        <p>Your tax reserve of {money(data.taxReserve.balance)} and savings of {money(guide.protectedCash)} stay outside this amount. Moving money between your own accounts does not reduce income. Spending reduces your monthly budget. Funded cash is calculated separately from account balances; posted purchases are not deducted from those balances again. Pending card payments settle balances already covered here.</p>
        <p>The budget resets each calendar month without rolling unused allowance forward. Upcoming bills still need to fit within the remaining amount. Income reports use bank posting dates, so an owner’s draw can appear in the month after the period it covers. That timing does not set your spending room.</p>
      </details>
      <BudgetEditor amount={guide.monthlyBudget} />
    </article>
  );
}

export function AdvisorView({ data }: { data: DashboardData }) {
  const [input, setInput] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefAttempt, setBriefAttempt] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/advisor" }), []);
  const { messages, sendMessage, status, error, clearError, stop, regenerate } = useChat<FinanceAgentUIMessage>({ transport });
  const thinking = status === "submitted" || status === "streaming";

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/advisor/brief", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok || typeof result?.content !== "string") throw new Error(result?.error || "Your daily brief is temporarily unavailable.");
        return result as Brief;
      })
      .then((result) => { if (!controller.signal.aborted) setBrief(result); })
      .catch((failure) => { if (!controller.signal.aborted) setBriefError(failureMessage(failure, "Could not load your daily brief.")); })
      .finally(() => { if (!controller.signal.aborted) setBriefLoading(false); });
    return () => controller.abort();
  }, [briefAttempt]);

  useEffect(() => {
    const element = scrollArea.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 220) {
      element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }
  }, [messages, status]);

  async function ask(text: string) {
    if (!text.trim() || thinking) return;
    setSendError(null);
    clearError();
    setInput("");
    try {
      await sendMessage({ text: text.trim() });
    } catch (failure) {
      setInput(text);
      setSendError(failureMessage(failure, "Your message could not be sent. Please try again."));
    }
  }

  const prompts = [
    { label: "Find spending patterns", text: "Where is my spending concentrated, and what has changed recently?" },
    { label: "Plan the week ahead", text: "What should I watch this week based on my accounts, pending spending, and upcoming payments?" },
    { label: "Review my portfolio", text: "Summarize my investment allocation and concentration using my connected holdings." },
  ];

  return (
    <div className="advisor-view">
      <article className="advisor-daily panel">
        <div className="advisor-daily-mark"><Sparkles size={21} /></div>
        <div className="advisor-daily-copy">
          <div className="advisor-daily-title"><span>Your daily perspective</span><span className="advisor-ai-label">AI briefing</span></div>
          {briefLoading ? <p className="advisor-loading" role="status"><LoaderCircle size={15} className="tools-spin" /> Reading today’s financial picture…</p> : brief ? <AdvisorMarkdown>{brief.content}</AdvisorMarkdown> : <p className="advisor-brief-error" role="alert">{briefError}</p>}
          {brief?.updatedAt ? <span className="advisor-brief-time">Prepared {new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(brief.updatedAt) ? `${brief.updatedAt.replace(" ", "T")}Z` : brief.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · May predate your latest account sync. Chat uses current account data.</span> : null}
        </div>
        {briefError && !briefLoading ? <button className="btn btn-quiet" onClick={() => { setBriefError(null); setBriefLoading(true); setBriefAttempt((value) => value + 1); }}><RefreshCw size={14} /> Retry</button> : null}
      </article>

      <div className="advisor-layout">
        <article className="panel advisor-chat">
          <div className="panel-header advisor-chat-header"><div className="advisor-heading-icon"><span className="advisor-chat-mark"><Sparkles size={18} /></span><div><h2>Money copilot</h2><p>Answers grounded in your connected finances</p></div></div><span className="advisor-model">Claude Opus 4.6</span></div>
          <div className="advisor-conversation" ref={scrollArea} aria-label="Conversation with money copilot" role="log" aria-live="polite" aria-busy={thinking}>
            {!messages.length ? <div className="advisor-welcome"><div className="advisor-welcome-mark"><Wallet size={27} /></div><h3>A little clarity goes a long way.</h3><p>Explore your spending, make a plan, or get a second opinion on your next move.</p><div className="advisor-suggestions">{prompts.map((prompt) => <button key={prompt.label} disabled={thinking} onClick={() => void ask(prompt.text)}><span>{prompt.label}</span><ArrowUpRight size={16} /></button>)}</div></div> : null}
            {messages.map((message) => {
              const text = message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
              if (!text) return null;
              return <div className={`advisor-message advisor-message-${message.role}`} key={message.id}><span className="advisor-message-author">{message.role === "user" ? "You" : "Money copilot"}</span>{message.role === "user" ? <div>{text}</div> : <AdvisorMarkdown>{text}</AdvisorMarkdown>}</div>;
            })}
            {status === "submitted" ? <div className="advisor-thinking" role="status"><LoaderCircle size={16} className="tools-spin" /> Looking at your numbers…</div> : null}
            {error || sendError ? <div className="advisor-chat-error" role="alert"><CircleAlert size={16} /><div><p>{sendError || "The advisor could not finish its reply. Your conversation is still here."}</p><button onClick={() => { setSendError(null); clearError(); void regenerate().catch((failure) => setSendError(failureMessage(failure, "Unable to retry. Please try again."))); }} disabled={thinking}>Try again</button></div></div> : null}
          </div>
          <form className="advisor-compose" onSubmit={(event) => { event.preventDefault(); void ask(input); }}>
            <label className="advisor-sr-only" htmlFor="advisor-message">Message your money copilot</label>
            <textarea id="advisor-message" value={input} rows={2} maxLength={6000} placeholder="Ask about your money…" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(input); } }} />
            {thinking ? <button className="advisor-send" type="button" onClick={() => void stop()} aria-label="Stop response"><Square size={14} fill="currentColor" /></button> : <button className="advisor-send" type="submit" disabled={!input.trim()} aria-label="Send message"><Send size={17} /></button>}
          </form>
          <p className="advisor-chat-note">Uses your connected accounts and current activity. Review important decisions against your statements.</p>
        </article>
        <aside className="advisor-sidebar"><SpendingContext data={data} /><PurchaseCheck data={data} /></aside>
      </div>
    </div>
  );
}
