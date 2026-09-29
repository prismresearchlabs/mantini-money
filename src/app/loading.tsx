import { ChartNoAxesCombined } from "lucide-react";

export default function Loading() {
  return (
    <main
      className="recovery-page"
      aria-busy="true"
      aria-label="Loading your financial workspace"
    >
      <section className="loading-panel" role="status">
        <span className="recovery-icon">
          <ChartNoAxesCombined size={28} />
        </span>
        <h1>Your money, coming together.</h1>
        <p>Getting the latest view of your accounts.</p>
        <div className="loading-line" />
      </section>
    </main>
  );
}
