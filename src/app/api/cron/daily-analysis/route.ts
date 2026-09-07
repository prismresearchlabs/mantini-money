import { generateDailyBrief } from "@/lib/ai/finance-agent";
import { syncAllItems } from "@/lib/plaid";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const synced = await syncAllItems();
  const brief = await generateDailyBrief(true);
  return Response.json({ ok: true, synced, briefUpdatedAt: brief.updatedAt });
}
