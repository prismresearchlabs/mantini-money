"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="recovery-page">
      <section className="panel recovery-panel">
        <span className="recovery-icon">
          <CircleAlert size={28} />
        </span>
        <h1>Let’s try that again.</h1>
        <p>
          Your financial workspace couldn’t load. Your saved data and
          connections are still in place.
        </p>
        <button className="btn btn-primary" onClick={retry}>
          <RefreshCw size={15} /> Try again
        </button>
      </section>
    </main>
  );
}
