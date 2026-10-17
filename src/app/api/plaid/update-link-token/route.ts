import { z } from "zod";
import { requireFinanceApi } from "@/lib/auth";
import { getStoredItems } from "@/lib/db";
import { createUpdateLinkToken } from "@/lib/plaid";
import { plaidErrorMessage } from "@/lib/plaid-errors";

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  const parsed = z.object({ itemId: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose an existing connection" }, { status: 400 });
  try {
    const item = (await getStoredItems()).find((value) => value.item_id === parsed.data.itemId);
    if (!item) return Response.json({ error: "Connection not found" }, { status: 404 });
    return Response.json({ linkToken: await createUpdateLinkToken(item.access_token) });
  } catch (error) {
    return Response.json({ error: plaidErrorMessage(error) }, { status: 502 });
  }
}
