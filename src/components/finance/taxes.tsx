"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Calculator, Check, ChevronDown, CircleHelp, ExternalLink, Landmark, LoaderCircle, PiggyBank, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import { estimateFederalTax, TAX_YEAR, taxEstimateInputSchema, type TaxEstimateInput } from "@/lib/tax-estimate";
import { type DashboardData, money, PanelHeader } from "./ui";
import "./taxes.css";

type TaxDraft = {
  filingStatus: TaxEstimateInput["filingStatus"] | "";
  incomeType: TaxEstimateInput["incomeType"] | "";
  annualIncome: string;
  federalWithholding: string;
  estimatedPayments: string;
};

function makeDraft(scenario: TaxEstimateInput | null): TaxDraft {
  return {
    filingStatus: scenario?.filingStatus || "",
    incomeType: scenario?.incomeType || "",
    annualIncome: scenario ? String(scenario.annualIncome) : "",
    federalWithholding: scenario ? String(scenario.federalWithholding) : "",
    estimatedPayments: scenario ? String(scenario.estimatedPayments) : "",
  };
}

function localDay(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function MoneyField({ id, label, value, onChange, note, placeholder = "0", required = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  note?: string; placeholder?: string; required?: boolean;
}) {
  return <div className="tax-form-field"><label htmlFor={id}>{label}{required && <span className="tax-required">Required</span>}</label><div className="tax-money-input"><span aria-hidden="true">$</span><input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} placeholder={placeholder} required={required} aria-describedby={note ? `${id}-note` : undefined} onChange={(event) => onChange(event.target.value)} /></div>{note && <small id={`${id}-note`}>{note}</small>}</div>;
}

export function TaxesView({ data, onRefresh }: { data: DashboardData; onRefresh: () => void }) {
  const eligibleAccounts = data.accounts.filter((account) => account.type === "depository" && (!account.currency || account.currency === "USD"));
  const [reserveIds, setReserveIds] = useState<string[]>(() => data.taxReserve.accountIds.filter((id) => eligibleAccounts.some((account) => account.id === id)));
  const [savedReserveIds, setSavedReserveIds] = useState(data.taxReserve.accountIds);
  const [savedReserveSource, setSavedReserveSource] = useState(data.taxReserve.source);
  const [draft, setDraft] = useState<TaxDraft>(() => makeDraft(data.taxScenario));
  const [savedScenario, setSavedScenario] = useState<TaxEstimateInput | null>(data.taxScenario);
  const [reserveBusy, setReserveBusy] = useState(false);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [reserveMessage, setReserveMessage] = useState("");
  const [reserveError, setReserveError] = useState("");
  const [estimateMessage, setEstimateMessage] = useState("");
  const [estimateError, setEstimateError] = useState("");

  const selectedAccounts = eligibleAccounts.filter((account) => reserveIds.includes(account.id));
  const reserveBalance = selectedAccounts.reduce((sum, account) => sum + Math.max(0, account.currentBalance || 0), 0);
  const missingBalances = selectedAccounts.filter((account) => account.currentBalance === null).length;
  const reserveDirty = [...reserveIds].sort().join("|") !== [...savedReserveIds].sort().join("|");
  const everydayCash = data.grossCash - reserveBalance;
  const cutoff = [localDay(data.generatedAt), `${TAX_YEAR}-12-31`].sort()[0];
  const importedIncome = data.transactions.filter((transaction) => transaction.date >= `${TAX_YEAR}-01-01` && transaction.date <= cutoff && !transaction.pending && transaction.flowType === "income" && transaction.amount < 0).reduce((sum, transaction) => sum - transaction.amount, 0);

  const parsed = useMemo(() => draft.annualIncome.trim() === "" ? null : taxEstimateInputSchema.safeParse({
    filingStatus: draft.filingStatus,
    incomeType: draft.incomeType,
    annualIncome: Number(draft.annualIncome),
    federalWithholding: draft.federalWithholding.trim() ? Number(draft.federalWithholding) : 0,
    estimatedPayments: draft.estimatedPayments.trim() ? Number(draft.estimatedPayments) : 0,
  }), [draft]);
  const scenario = parsed?.success ? parsed.data : null;
  const estimate = useMemo(() => scenario ? estimateFederalTax(scenario) : null, [scenario]);
  const estimateDirty = JSON.stringify(scenario) !== JSON.stringify(savedScenario);
  const hasAllInputs = Boolean(draft.filingStatus && draft.incomeType && draft.annualIncome.trim());
  const reserveGap = estimate ? Math.max(0, estimate.outstanding - reserveBalance) : null;
  const fundedReserve = estimate ? Math.min(reserveBalance, estimate.outstanding) : 0;
  const paidShare = estimate && estimate.modeledLiability > 0 ? Math.min(100, estimate.payments / estimate.modeledLiability * 100) : 0;
  const reserveShare = estimate && estimate.modeledLiability > 0 ? Math.min(100 - paidShare, fundedReserve / estimate.modeledLiability * 100) : 0;

  function updateDraft(key: keyof TaxDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setEstimateMessage("");
    setEstimateError("");
  }

  async function persist(body: { accountIds: string[] } | { scenario: TaxEstimateInput | null }) {
    const response = await fetch("/api/tax-settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save your tax settings. Please try again.");
  }

  async function saveReserve() {
    setReserveBusy(true); setReserveError(""); setReserveMessage("");
    try {
      await persist({ accountIds: reserveIds });
      setSavedReserveIds([...reserveIds]);
      setSavedReserveSource("configured");
      setReserveMessage("Tax reserve accounts saved.");
      onRefresh();
    } catch (cause) { setReserveError(cause instanceof Error ? cause.message : "Unable to save reserve accounts."); }
    finally { setReserveBusy(false); }
  }

  async function saveEstimate(clear = false) {
    if (!clear && !scenario) return;
    setEstimateBusy(true); setEstimateError(""); setEstimateMessage("");
    try {
      const next = clear ? null : scenario;
      await persist({ scenario: next });
      setSavedScenario(next);
      if (clear) setDraft(makeDraft(null));
      setEstimateMessage(clear ? "Saved estimate cleared. Your reserve accounts are unchanged." : "Your 2026 estimate assumptions are saved.");
      onRefresh();
    } catch (cause) { setEstimateError(cause instanceof Error ? cause.message : "Unable to save estimate."); }
    finally { setEstimateBusy(false); }
  }

  return <div className="tax-view">
    <div className="tax-year-note"><span className="badge"><CalendarLabel />{TAX_YEAR} tax year</span><span>Full-year planning · federal + Texas</span></div>
    <div className="tax-summary-grid">
      <article className="panel tax-reserve-hero"><div className="tax-summary-label"><span className="tax-glyph"><ShieldCheck size={18} /></span><span>Reserved for taxes</span>{reserveDirty && <span className="tax-draft-tag">Preview</span>}</div><strong>{money(reserveBalance, true)}</strong><p>Set aside in {selectedAccounts.length} {selectedAccounts.length === 1 ? "account" : "accounts"}. Still yours, just earmarked.</p></article>
      <article className="panel tax-summary-card"><div className="tax-summary-label"><Wallet size={17} /><span>Cash outside your tax reserve</span></div><strong>{money(everydayCash, true)}</strong><p>Connected USD cash less the reserve shown here.</p></article>
      <article className="panel tax-summary-card"><div className="tax-summary-label"><ArrowDownRight size={17} /><span>Imported income · {TAX_YEAR} YTD</span></div><strong>{money(importedIncome)}</strong><p>Bookkeeping context only. Never used to fill your tax estimate.</p></article>
    </div>
    <div className="tax-ownership-note"><CircleHelp size={16} /><p>Your reserve remains part of your full connected assets and net worth; the app’s headline amounts exclude it. Moving money into the reserve does not reduce taxable income or count as a tax payment.</p></div>
    {!data.taxReserve.reliable && <div className="tax-data-warning" role="status"><CircleHelp size={16} /><span>Some selected reserve accounts or balances are unavailable or out of date. The reserve and coverage shown here use reported balances and may be incomplete.</span></div>}
    <div className="tax-planning-layout">
      <section className="panel tax-estimate-form"><PanelHeader title="Build your rough estimate" subtitle="Start with what you expect for the full year." /><form onSubmit={(event) => { event.preventDefault(); void saveEstimate(); }}><fieldset disabled={estimateBusy} className="tax-input-fields">
        <div className="tax-form-row"><div className="tax-form-field"><label htmlFor="tax-filing">Filing status<span className="tax-required">Required</span></label><select id="tax-filing" className="field" value={draft.filingStatus} required onChange={(event) => updateDraft("filingStatus", event.target.value)}><option value="">Choose filing status</option><option value="single">Single</option><option value="married-jointly">Married filing jointly</option></select></div><div className="tax-form-field"><label htmlFor="tax-income-type">Income type<span className="tax-required">Required</span></label><select id="tax-income-type" className="field" value={draft.incomeType} required onChange={(event) => updateDraft("incomeType", event.target.value)}><option value="">Choose income type</option><option value="self-employed">Self-employed / sole proprietor</option><option value="wages">Wages / W-2 income</option></select></div></div>
        <MoneyField id="tax-annual-income" label={draft.incomeType === "self-employed" ? "Expected full-year net business profit" : draft.incomeType === "wages" ? "Expected full-year gross wages" : "Expected full-year income"} value={draft.annualIncome} onChange={(value) => updateDraft("annualIncome", value)} required placeholder="Enter your annual estimate" note={draft.incomeType === "self-employed" ? "After ordinary business expenses, before personal tax. For joint filers, this models one self-employed earner." : draft.incomeType === "wages" ? "Gross wages before tax. For a joint return, include combined household wages. Payroll taxes are not included in this estimate." : "Enter your own 2026 projection. Bank deposits and imported income are not a taxable-income calculation."} />
        <div className="tax-form-divider"><ReceiptText size={15} /><span>What has already been paid</span></div>
        <div className="tax-form-row"><MoneyField id="tax-withholding" label="Federal income tax withheld" value={draft.federalWithholding} onChange={(value) => updateDraft("federalWithholding", value)} note="Paid through payroll so far. Exclude Social Security and Medicare." /><MoneyField id="tax-payments" label="Federal estimated payments made" value={draft.estimatedPayments} onChange={(value) => updateDraft("estimatedPayments", value)} note="Actual payments to the IRS for 2026. Exclude transfers to your reserve." /></div>
        <div className="tax-state-note"><Landmark size={15} /><span>Texas scenario<span>No individual state income tax is modeled.</span></span></div></fieldset>
        {hasAllInputs && !scenario && <p className="tax-message tax-message-error" role="alert">Enter valid nonnegative amounts. {parsed && !parsed.success ? parsed.error.issues[0]?.message : ""}</p>}
        {estimateError && <p className="tax-message tax-message-error" role="alert">{estimateError}</p>}
        {estimateMessage && <p className="tax-message tax-message-success" role="status"><Check size={14} />{estimateMessage}</p>}
        <div className="tax-form-actions"><span>{estimateDirty && scenario ? "Unsaved draft" : savedScenario ? "Saved assumptions" : "Nothing assumed until you fill this in"}</span><button className="btn btn-primary" type="submit" disabled={!scenario || !estimateDirty || estimateBusy}>{estimateBusy ? <LoaderCircle size={15} className="tax-spin" /> : <Check size={15} />}{estimateBusy ? "Saving…" : "Save estimate"}</button></div>
        {savedScenario && <button className="tax-clear-estimate" type="button" disabled={estimateBusy} onClick={() => void saveEstimate(true)}>Clear saved estimate</button>}
      </form></section>
      <section className="panel tax-estimate-result" aria-label="Tax estimate result"><PanelHeader title="A clearer view of what’s ahead" subtitle={estimate ? "Your estimate updates as you adjust the inputs." : "Your personalized estimate will appear here."}>{estimate && <span className={`badge ${estimateDirty ? "" : "soft-green"}`}>{estimateDirty ? "Draft estimate" : "Saved estimate"}</span>}</PanelHeader>
        {estimate ? <>
          <div className="tax-result-total"><span>Estimated {TAX_YEAR} tax</span><strong>{money(estimate.modeledLiability)}</strong><p>{draft.incomeType === "self-employed" ? "Federal income tax + self-employment taxes" : "Federal income tax · payroll taxes excluded"}</p></div>
          <div className="tax-rate-grid"><div><strong>{(estimate.effectiveTotalTaxRate * 100).toFixed(1)}%</strong><span>Effective modeled rate</span></div><div><strong>{(estimate.marginalIncomeTaxRate * 100).toFixed(0)}%</strong><span>Marginal federal bracket</span></div></div>
          <dl className="tax-calculation"><div><dt>Federal income tax</dt><dd>{money(estimate.federalIncomeTax, true)}</dd></div>{draft.incomeType === "self-employed" && <><div><dt>Self-employment tax</dt><dd>{money(estimate.selfEmploymentTax, true)}</dd></div>{estimate.additionalMedicareTax > 0 && <div><dt>Additional Medicare tax</dt><dd>{money(estimate.additionalMedicareTax, true)}</dd></div>}</>}<div><dt>Texas individual income tax</dt><dd>{money(estimate.stateIncomeTax)}</dd></div><div className="tax-calculation-divider"><dt>Already withheld or paid</dt><dd className="positive">−{money(estimate.payments, true)}</dd></div><div className="tax-calculation-strong"><dt>Estimated amount still to pay</dt><dd>{money(estimate.outstanding, true)}</dd></div><div><dt>Held in your tax reserve</dt><dd>{money(reserveBalance, true)}</dd></div></dl>
          <div className={`tax-gap ${reserveGap === 0 ? "tax-gap-covered" : ""}`}><div><span>{reserveGap === 0 ? "Reserve covers the estimated remainder" : "Additional amount to set aside"}</span><strong>{money(reserveGap, true)}</strong></div><span className="tax-gap-icon">{reserveGap === 0 ? <ShieldCheck size={23} /> : <PiggyBank size={23} />}</span></div>
          {estimate.modeledLiability > 0 && <div className="tax-coverage"><div className="tax-coverage-track" role="img" aria-label={`${Math.round(paidShare)} percent paid or withheld, ${Math.round(reserveShare)} percent covered by reserve, ${Math.round(100 - paidShare - reserveShare)} percent unfunded`}><span className="tax-coverage-paid" style={{ width: `${paidShare}%` }} /><span className="tax-coverage-reserved" style={{ width: `${reserveShare}%` }} /></div><div className="tax-coverage-legend"><span><i className="tax-coverage-paid" />Paid / withheld</span><span><i className="tax-coverage-reserved" />Reserved</span><span><i />Still to reserve</span></div></div>}
          {estimate.overpaid > 0 && <p className="tax-result-note">Reported withholding and payments exceed the modeled tax by {money(estimate.overpaid, true)}. This is not a confirmed refund.</p>}
          <p className="tax-result-note">Reserve coverage is a planning comparison. Reserved cash has not been paid to the IRS. {missingBalances > 0 || !data.taxReserve.reliable ? "Some selected reserve balances are unavailable or may be outdated." : ""}</p>
        </> : <div className="tax-estimate-empty"><span><Calculator size={29} /></span><h3>Give your reserve a target.</h3><p>Choose your filing status and income type, then enter an annual income estimate. We’ll show how your payments and reserve compare.</p><div><Check size={14} />Your bank balance is never treated as income.</div></div>}
      </section>
    </div>
    <section className="panel tax-reserve-settings"><PanelHeader title="Your tax reserve accounts" subtitle="Choose where you keep money earmarked for taxes."><span className="badge">{savedReserveSource === "automatic" ? "Suggested from account names" : "Your selection"}</span></PanelHeader><div className="tax-reserve-content">
      <div className="tax-reserve-account-list">{eligibleAccounts.length ? eligibleAccounts.map((account) => <label className={`tax-reserve-account${reserveIds.includes(account.id) ? " tax-reserve-account-selected" : ""}`} key={account.id}><input type="checkbox" checked={reserveIds.includes(account.id)} disabled={reserveBusy} onChange={(event) => { setReserveIds((previous) => event.target.checked ? [...previous, account.id] : previous.filter((id) => id !== account.id)); setReserveMessage(""); setReserveError(""); }} /><span className="tax-account-icon"><Landmark size={17} /></span><span className="tax-account-copy"><strong>{account.name}</strong><small>{account.institutionName}{account.mask ? ` ··${account.mask}` : ""}</small></span><strong className="tax-account-balance">{money(account.currentBalance, true)}</strong></label>) : <div className="tax-no-accounts"><Wallet size={24} /><p>Connect a USD checking or savings account to track your tax reserve.</p><a className="text-link" href="#accounts">View accounts <ArrowUpRight size={14} /></a></div>}</div>
      <div className="tax-reserve-explainer"><span className="tax-reserve-explainer-icon"><PiggyBank size={23} /></span><h3>A place for future-you’s taxes.</h3><p>Selected accounts are separated from everyday cash, while remaining part of your total assets. Only reported positive USD balances count toward reserve coverage.</p>{(missingBalances > 0 || data.taxReserve.missingBalances > 0 || data.taxReserve.invalidSetting || data.taxReserve.unsupportedCurrencies > 0) && <p className="tax-reserve-warning">Some previously selected accounts or balances are unavailable. Choose from the eligible accounts shown here and save your selection.</p>}<div><span>Selected reserve balance</span><strong>{money(reserveBalance, true)}</strong></div></div>
    </div><div className="tax-reserve-save"><div>{reserveError ? <p className="tax-message tax-message-error" role="alert">{reserveError}</p> : reserveMessage ? <p className="tax-message tax-message-success" role="status"><Check size={14} />{reserveMessage}</p> : <span>{reserveDirty ? "Your selection has unsaved changes." : "Changing your selection does not move any money."}</span>}</div><button className="btn btn-primary" disabled={(!reserveDirty && savedReserveSource === "configured") || reserveBusy} onClick={() => void saveReserve()}>{reserveBusy ? <LoaderCircle size={15} className="tax-spin" /> : <Check size={15} />}{reserveBusy ? "Saving…" : "Save reserve accounts"}</button></div></section>
    {estimate && <section className="panel tax-method"><PanelHeader title="How the estimate is built" subtitle="Transparent math, with the assumptions in view." /><details><summary><span><Calculator size={16} />Income and deductions</span><ChevronDown size={16} /></summary><dl className="tax-calculation"><div><dt>{draft.incomeType === "self-employed" ? "Annual net business profit" : "Annual gross wages"}</dt><dd>{money(estimate.grossIncome, true)}</dd></div>{estimate.selfEmploymentDeduction > 0 && <div><dt>Deductible portion of self-employment tax</dt><dd>−{money(estimate.selfEmploymentDeduction, true)}</dd></div>}<div><dt>Modeled adjusted gross income</dt><dd>{money(estimate.adjustedGrossIncome, true)}</dd></div><div><dt>Standard deduction</dt><dd>−{money(estimate.standardDeduction, true)}</dd></div><div className="tax-calculation-strong"><dt>Modeled federal taxable income</dt><dd>{money(estimate.taxableIncome, true)}</dd></div></dl></details><details><summary><span><ReceiptText size={16} />Federal bracket breakdown</span><ChevronDown size={16} /></summary><p className="tax-bracket-note">Each rate applies only to income inside that bracket. Your marginal rate does not apply to all your income.</p><div className="tax-bracket-table"><table><thead><tr><th>Rate</th><th>Taxable income in bracket</th><th>Income tax</th></tr></thead><tbody>{estimate.brackets.map((bracket) => <tr key={bracket.rate} className={bracket.taxableAmount > 0 ? "" : "tax-bracket-unused"}><td><strong>{(bracket.rate * 100).toFixed(0)}%</strong><small>{money(bracket.lowerBound)} – {bracket.upperBound === null ? "and above" : money(bracket.upperBound)}</small></td><td>{money(bracket.taxableAmount, true)}</td><td>{money(bracket.tax, true)}</td></tr>)}</tbody></table></div></details><details open><summary><span><CircleHelp size={16} />Assumptions and limits</span><ChevronDown size={16} /></summary><ul className="tax-limitations">{estimate.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul><div className="tax-sources">{estimate.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12} /></a>)}</div></details></section>}
    <p className="tax-footer-note">This rough planning estimate is not a tax return or a quarterly payment schedule. Review your actual income, deductions, credits, and payment requirements before filing or paying.</p>
  </div>;
}

function CalendarLabel() { return <span className="tax-year-dot" aria-hidden="true" />; }
