import { SignUp } from "@clerk/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  if (process.env.NODE_ENV === "development") redirect("/");
  const users = await (await clerkClient()).users.getUserList({ limit: 1, orderBy: "+created_at" });
  if (users.totalCount > 0) redirect("/sign-in");

  return (
    <main className="auth-shell">
      <div className="auth-brand">Mantini</div>
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/" />
    </main>
  );
}
