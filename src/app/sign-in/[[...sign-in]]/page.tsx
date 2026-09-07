import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  if (process.env.NODE_ENV === "development") redirect("/");
  return (
    <main className="auth-shell">
      <div className="auth-brand">Mantini</div>
      <SignIn signUpUrl="/sign-up" forceRedirectUrl="/" />
    </main>
  );
}
