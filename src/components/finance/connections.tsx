"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata, type PlaidLinkOnSuccess, type PlaidLinkOnExit } from "react-plaid-link";
import { Check, CircleAlert, Link2, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import "./finance-tools.css";

type Notice = { message: string; tone: "success" | "error" | "info" };
type LinkSessionProps = { token: string; onSuccess: PlaidLinkOnSuccess; onExit: PlaidLinkOnExit; onLoadError: () => void };

function ReadyPlaidSession({ token, onSuccess, onExit, onLoadError }: LinkSessionProps) {
  const openedToken = useRef<string | null>(null);
  const { open, ready, error } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (ready && openedToken.current !== token) {
      openedToken.current = token;
      open();
    }
  }, [token, open, ready]);
  useEffect(() => { if (error) onLoadError(); }, [error, onLoadError]);
  return null;
}

function PlaidSession(props: LinkSessionProps) {
  const [scriptReady, setScriptReady] = useState(false);
  // Next owns this script once across connection controls. Mount the Plaid hook only
  // after loading, so its Strict Mode cleanup cannot remove/reinsert a loading SDK.
  return <>
    <Script id="mantini-plaid-link" src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={props.onLoadError} />
    {scriptReady ? <ReadyPlaidSession {...props} /> : null}
  </>;
}

async function readResponse(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || (response.status === 401 ? "Please sign in again to continue." : "The request could not be completed. Please try again."));
  }
  if (!result) throw new Error("The server returned an unexpected response. Please try again.");
  return result;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to connect. Check your connection and try again.";
}

export function ConnectionControls({ environment }: { environment: "sandbox" | "production" }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [operation, setOperation] = useState<"connect" | "sync" | null>(null);

  const onSuccess = useCallback(async (publicToken: string | null, metadata: PlaidLinkOnSuccessMetadata) => {
    if (!publicToken) {
      setNotice({ message: "Plaid did not return a connection token. Please try again.", tone: "error" });
      setOperation(null);
      setLinkToken(null);
      return;
    }
    setOperation("connect");
    setNotice({ message: "Importing your accounts and transactions…", tone: "info" });
    try {
      await readResponse(await fetch("/api/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicToken,
          institution: metadata.institution ? { id: metadata.institution.institution_id, name: metadata.institution.name } : undefined,
        }),
      }));
      setNotice({ message: `${metadata.institution?.name || "Your account"} connected. Account data refreshed.`, tone: "success" });
    } catch (error) {
      setNotice({ message: errorMessage(error), tone: "error" });
    } finally {
      router.refresh();
      setOperation(null);
      setLinkToken(null);
    }
  }, [router]);

  async function connect() {
    setOperation("connect");
    setNotice({ message: "Opening secure account connection…", tone: "info" });
    try {
      const result = await readResponse(await fetch("/api/plaid/link-token", { method: "POST" }));
      if (typeof result.linkToken !== "string") throw new Error("Could not open Plaid. Please try again.");
      setLinkToken(result.linkToken);
    } catch (error) {
      setNotice({ message: errorMessage(error), tone: "error" });
      setOperation(null);
    }
  }

  async function sync() {
    setOperation("sync");
    setNotice({ message: "Refreshing your bank connections…", tone: "info" });
    try {
      const result = await readResponse(await fetch("/api/plaid/sync", { method: "POST" }));
      setNotice({
        message: typeof result.synced === "number"
          ? result.synced === 0 ? "No bank connections to sync. Add an account to get started." : `Refreshed ${result.synced} bank connection${result.synced === 1 ? "" : "s"}.`
          : "Bank sync completed. Review connection status for details.",
        tone: "success",
      });
    } catch (error) {
      setNotice({ message: `Sync incomplete: ${errorMessage(error)}`, tone: "error" });
    } finally {
      // Even a partially completed sync may have fresh balances or a stored item error.
      router.refresh();
      setOperation(null);
    }
  }

  const busy = Boolean(operation);

  return (
    <div className="tools-connections">
      {linkToken ? <PlaidSession token={linkToken} onSuccess={onSuccess} onExit={(error) => {
        setNotice(error ? { message: error.display_message || error.error_message || "Unable to connect this institution.", tone: "error" } : { message: "Connection window closed.", tone: "info" });
        setLinkToken(null);
        setOperation(null);
      }} onLoadError={() => {
        setNotice({ message: "Plaid could not load. Check your connection and reload this page to try again.", tone: "error" });
        setLinkToken(null);
        setOperation(null);
      }} /> : null}
      {environment === "sandbox" ? <span className="tools-sandbox badge">Sandbox</span> : null}
      <button className="btn btn-quiet tools-sync" onClick={sync} disabled={busy} title="Refresh bank connections" aria-label={operation === "sync" ? "Syncing bank connections" : "Sync bank connections"}>
        <RefreshCw size={15} className={operation === "sync" ? "tools-spin" : ""} />
        <span>{operation === "sync" ? "Syncing…" : "Sync accounts"}</span>
      </button>
      <button className="btn btn-primary" onClick={connect} disabled={busy}>
        {operation === "connect" ? <LoaderCircle size={15} className="tools-spin" /> : <Plus size={16} />}
        {operation === "connect" ? "Connecting…" : "Add account"}
      </button>
      {notice ? (
        <div className={`tools-notice tools-notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "success" ? <Check size={16} /> : notice.tone === "error" ? <CircleAlert size={16} /> : <LoaderCircle size={16} className={busy ? "tools-spin" : ""} />}
          <span>{notice.message}</span>
          {!busy ? <button className="tools-dismiss" aria-label="Dismiss connection status" onClick={() => setNotice(null)}><X size={14} /></button> : null}
        </div>
      ) : null}
    </div>
  );
}

export function InvestmentConsentButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const onSuccess = useCallback(async () => {
    setBusy(true);
    setNotice({ message: "Access updated. Refreshing investment accounts…", tone: "info" });
    try {
      await readResponse(await fetch("/api/plaid/sync", { method: "POST" }));
      setNotice({ message: "Access updated. Account refresh complete; available holdings will appear in your portfolio.", tone: "success" });
    } catch (error) {
      setNotice({ message: `Access updated, but the refresh was incomplete: ${errorMessage(error)}`, tone: "error" });
    } finally {
      router.refresh();
      setLinkToken(null);
      setBusy(false);
    }
  }, [router]);

  async function requestConsent() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await readResponse(await fetch("/api/plaid/investments-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      }));
      if (typeof result.linkToken !== "string") throw new Error("Could not open the investment connection. Please try again.");
      setLinkToken(result.linkToken);
    } catch (error) {
      setNotice({ message: errorMessage(error), tone: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="tools-consent">
      {linkToken ? <PlaidSession token={linkToken} onSuccess={onSuccess} onExit={(error) => {
        setLinkToken(null);
        setBusy(false);
        setNotice(error ? { message: error.display_message || error.error_message, tone: "error" } : null);
      }} onLoadError={() => {
        setNotice({ message: "Plaid could not load. Check your connection and reload this page to try again.", tone: "error" });
        setLinkToken(null);
        setBusy(false);
      }} /> : null}
      <button className="btn btn-quiet tools-consent-button" onClick={requestConsent} disabled={busy}>
        {busy ? <LoaderCircle size={14} className="tools-spin" /> : <Link2 size={14} />}
        {busy ? "Connecting holdings…" : "Connect investment holdings"}
      </button>
      {notice ? <p className={notice.tone === "error" ? "tools-inline-error" : "tools-inline-status"} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p> : null}
    </div>
  );
}
