"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUpRight, Bot, Check, ChevronRight, CircleAlert, CircleGauge, LoaderCircle, RefreshCw, Send, ShieldCheck, ShoppingBag, Sparkles, Square, Wallet } from "lucide-react";
import type { FinanceAgentUIMessage } from "@/lib/ai/finance-agent";
import "./finance-tools.css";

type DashboardData = Awaited<ReturnType<typeof import("@/lib/dashboard").getDashboardData>>;
type Brief = { content: string; updatedAt: string; cached: boolean };

function money(value: number, cents = false) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents ? 2 : 0 }).format(value);
}

function plainText(value: string) {
  return value.replace(/\*\*/g, "");
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function PurchaseCheck({ data }: { data: DashboardData }) {
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
  const within = afterPurchase >= 0;
  const share = data.spendingGuide.monthlyAllowance > 0 ? amount / data.spendingGuide.monthlyAllowance * 100 : null;

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
      if (!controller.signal.aborted && requestVersion.current === version) setAssessment(plainText(result.assessment));
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
        {validAmount ? <div className={`advisor-purchase-result ${within ? "advisor-within" : "advisor-over"}`}>
          {within ? <Check size={17} /> : <CircleAlert size={17} />}
          <div><strong>{within ? "Within your current guardrail" : "Above your current guardrail"}</strong><p>{within ? `${money(afterPurchase, true)} would remain.` : `${money(Math.abs(afterPurchase), true)} over your remaining allowance.`}{share !== null ? ` Uses ${share.toFixed(1)}% of this month’s starting allowance.` : " No flexible allowance is available this month."}</p></div>
        </div> : null}
        <button className="btn btn-primary advisor-purchase-button" type="submit" disabled={!validAmount || !description.trim() || assessing}>
          {assessing ? <LoaderCircle size={15} className="tools-spin" /> : <Sparkles size={15} />}
          {assessing ? "Checking your finances…" : "Get the advisor’s take"}
        </button>
      </form>
      {assessment ? <div className="advisor-assessment" role="status"><Bot size={17} /><p>{assessment}</p></div> : null}
      {assessmentError ? <p className="tools-inline-error" role="alert">{assessmentError}</p> : null}
      <p className="advisor-fine-print">A planning check based on posted activity. Pending spending of {money(data.monthPendingSpend, true)} is separate.</p>
    </article>
  );
}

function SpendingContext({ data }: { data: DashboardData }) {
  const guide = data.spendingGuide;
  const usedPercent = Math.max(0, Math.min(100, guide.usedPercent));
  return (
    <article className="panel advisor-guardrail">
      <div className="panel-header"><div className="advisor-heading-icon"><CircleGauge size={17} /><h2>Your spending room</h2></div><span className="badge">This month</span></div>
      <div className="advisor-allowance"><strong>{money(guide.remaining, true)}</strong><span>remaining in your flexible allowance</span></div>
      <div className="advisor-progress" role="progressbar" aria-label="Flexible allowance used" aria-valuenow={usedPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${usedPercent}%` }} /></div>
      <div className="advisor-progress-labels"><span>{money(data.monthSpend)} spent</span><span>{money(guide.monthlyAllowance)} allowance</span></div>
      <div className="advisor-protected"><ShieldCheck size={20} /><div><strong>{money(guide.protectedCash)} protected</strong><span>Savings + three months of recent spending, outside the tax reserve</span></div></div>
      <details className="advisor-method">
        <summary>How your allowance works <ChevronRight size={14} /></summary>
        <dl>
          <div><dt>Posted income</dt><dd>{money(data.monthIncome, true)}</dd></div>
          <div><dt>Moved to savings / tax reserve</dt><dd>−{money(data.monthSaved, true)}</dd></div>
          <div><dt>After-savings income</dt><dd>{money(guide.postReserveIncome, true)}</dd></div>
          <div><dt>{guide.incomeRate}% income allowance</dt><dd>{money(guide.incomeAllowance, true)}</dd></div>
          <div><dt>Cash above the protected floor</dt><dd>{money(guide.cashCapacity, true)}</dd></div>
          <div><dt>Starting allowance · lower of the two</dt><dd>{money(guide.monthlyAllowance, true)}</dd></div>
        </dl>
        <p>Your tax reserve of {money(data.taxReserve.balance)} is already excluded from cash available to this guide. The remaining savings balance of {money(guide.reservedCash)} plus three times recent monthly spending of {money(guide.recentMonthlySpend)} stays protected. Investments, savings transfers, card payments, and internal transfers do not count as lifestyle spending. Future income waits until it posts.</p>
      </details>
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
          {briefLoading ? <p className="advisor-loading" role="status"><LoaderCircle size={15} className="tools-spin" /> Reading today’s financial picture…</p> : brief ? <p>{plainText(brief.content)}</p> : <p className="advisor-brief-error" role="alert">{briefError}</p>}
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
              return <div className={`advisor-message advisor-message-${message.role}`} key={message.id}><span className="advisor-message-author">{message.role === "user" ? "You" : "Money copilot"}</span><div>{plainText(text)}</div></div>;
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
