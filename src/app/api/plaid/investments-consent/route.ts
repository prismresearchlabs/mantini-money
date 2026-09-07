import { z } from "zod";
import { requireFinanceApi } from "@/lib/auth";
import { getStoredItems } from "@/lib/db";
import { createInvestmentsConsentLinkToken } from "@/lib/plaid";

const schema = z.object({ itemId: z.string().min(1) });

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;

  try {
    const { itemId } = schema.parse(await request.json());
    const item = (await getStoredItems()).find((value) => value.item_id === itemId);
    if (!item) return Response.json({ error: "Connected account not found" }, { status: 404 });
    return Response.json({
      linkToken: await createInvestmentsConsentLinkToken(item.access_token),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request investment access";
    return Response.json({ error: message }, { status: 400 });
  }
}
