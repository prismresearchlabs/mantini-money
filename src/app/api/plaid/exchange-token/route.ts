import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import { saveItem, queryRows } from "@/lib/db";
import { getPlaidClient, syncItem } from "@/lib/plaid";
import { requireFinanceApi } from "@/lib/auth";

const requestSchema = z.object({
  publicToken: z.string().min(1),
  institution: z
    .object({ id: z.string().nullable().optional(), name: z.string().trim().min(1) }),
});

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Plaid did not identify the bank. Please try connecting again." }, { status: 400 });
    const body = parsed.data;
    // Check before exchanging: requesting an access token creates a duplicate Item.
    const existing = await queryRows<{ item_id: string }>(
      `SELECT item_id FROM plaid_items WHERE institution_id = ?
       OR lower(trim(institution_name)) = lower(trim(?))`,
      [body.institution?.id ?? null, body.institution?.name ?? ""],
    );
    if (existing.length) {
      return Response.json({ error: `${body.institution?.name || "This bank"} is already connected. Open Manage connections under Accounts to reconnect or add accounts without duplicating them.` }, { status: 409 });
    }
    const response = await getPlaidClient().itemPublicTokenExchange({
      public_token: body.publicToken,
    });
    const encryptedAccessToken = encrypt(response.data.access_token);
    await saveItem({
      itemId: response.data.item_id,
      accessToken: encryptedAccessToken,
      institutionId: body.institution?.id ?? undefined,
      institutionName: body.institution?.name || "Connected institution",
    });
    await syncItem({
      itemId: response.data.item_id,
      encryptedAccessToken,
      cursor: null,
    });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect account";
    return Response.json({ error: message }, { status: 500 });
  }
}
