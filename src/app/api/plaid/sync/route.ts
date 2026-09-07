import { syncAllItems } from "@/lib/plaid";
import { requireFinanceApi } from "@/lib/auth";

export async function POST() {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    return Response.json({ ok: true, synced: await syncAllItems() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
