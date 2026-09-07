import { createLinkToken } from "@/lib/plaid";
import { requireFinanceApi } from "@/lib/auth";

export async function POST() {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    return Response.json({ linkToken: await createLinkToken() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create Link token";
    return Response.json({ error: message }, { status: 500 });
  }
}
