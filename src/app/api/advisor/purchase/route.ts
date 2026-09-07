import { z } from "zod";
import { createFinanceAgent } from "@/lib/ai/finance-agent";
import { requireFinanceApi } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export const maxDuration = 60;

const schema = z.object({
  amount: z.number().nonnegative().max(1_000_000),
  description: z.string().trim().min(1).max(120),
});

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  if (!process.env.CLAUDE_API_KEY) {
    return Response.json({ error: "Claude is not configured" }, { status: 503 });
  }

  try {
    const purchase = schema.parse(await request.json());
    const agent = createFinanceAgent(await getDashboardData());
    const result = await agent.generate({
      prompt: `The user is considering spending $${purchase.amount.toFixed(2)} on ${purchase.description}. Evaluate it against the supplied spending guardrail and current finances. Give a direct verdict and the most relevant tradeoff in no more than 55 words. Do not moralize, use jargon, or pretend the guardrail is tax advice.`,
      timeout: { totalMs: 55_000 },
    });
    return Response.json({ assessment: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to evaluate purchase";
    return Response.json({ error: message }, { status: 400 });
  }
}
