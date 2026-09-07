import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import { saveItem } from "@/lib/db";
import { getPlaidClient, syncItem } from "@/lib/plaid";
import { requireFinanceApi } from "@/lib/auth";

const requestSchema = z.object({
  publicToken: z.string().min(1),
  institution: z
    .object({ id: z.string().nullable().optional(), name: z.string().nullable().optional() })
    .optional(),
});

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    const body = requestSchema.parse(await request.json());
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
