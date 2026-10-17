import { generateDailyBrief } from "@/lib/ai/finance-agent";
import { syncAllItems } from "@/lib/plaid";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await syncAllItems();
  if (result.failures.length) return Response.json({ ok: false, ...result }, { status: 502 });
  const brief = await generateDailyBrief(true);
  return Response.json({ ok: true, ...result, briefUpdatedAt: brief.updatedAt });
}
