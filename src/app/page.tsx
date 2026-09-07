import { getPlaidEnvironment } from "@/lib/config";
import { getDashboardData } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard";
import { getFinanceAccess } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const access = await getFinanceAccess();
  if (!access.allowed) redirect(access.reason === "signed_out" ? "/sign-in" : "/unauthorized");

  return (
    <Dashboard
      initialData={await getDashboardData()}
      environment={getPlaidEnvironment()}
    />
  );
}
