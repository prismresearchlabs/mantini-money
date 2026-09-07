import { generateDailyBrief } from "@/lib/ai/finance-agent";
import { requireFinanceApi } from "@/lib/auth";

export const maxDuration = 60;

export async function GET() {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  if (!process.env.CLAUDE_API_KEY) {
    return Response.json({ error: "Claude is not configured" }, { status: 503 });
  }
  try {
    return Response.json(await generateDailyBrief());
  } catch {
    return Response.json({ error: "The advisor is temporarily unavailable" }, { status: 500 });
  }
}
