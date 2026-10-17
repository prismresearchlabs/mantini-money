import { syncAllItems, syncItem } from "@/lib/plaid";
import { getStoredItems } from "@/lib/db";
import { plaidErrorMessage } from "@/lib/plaid-errors";
import { requireFinanceApi } from "@/lib/auth";

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    if (body.itemId !== undefined) {
      if (typeof body.itemId !== "string" || !body.itemId) return Response.json({ error: "Invalid connection" }, { status: 400 });
      const item = (await getStoredItems()).find((value) => value.item_id === body.itemId);
      if (!item) return Response.json({ error: "Connection not found" }, { status: 404 });
      await syncItem({ itemId: item.item_id, encryptedAccessToken: item.access_token, cursor: item.cursor });
      return Response.json({ ok: true, synced: 1, failures: [] });
    }
    const result = await syncAllItems();
    return Response.json({ ok: result.failures.length === 0, ...result });
  } catch (error) {
    const message = plaidErrorMessage(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
