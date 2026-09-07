import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";

export default function UnauthorizedPage() {
  if (process.env.NODE_ENV === "development") redirect("/");
  return (
    <main className="auth-shell">
      <div className="auth-brand">Mantini</div>
      <section className="auth-denied">
        <h1>Private account</h1>
        <p>This financial workspace belongs to another user.</p>
        <SignOutButton><button>Sign out</button></SignOutButton>
      </section>
    </main>
  );
}
