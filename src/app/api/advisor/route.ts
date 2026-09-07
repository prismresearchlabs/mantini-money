import { createAgentUIStreamResponse } from "ai";
import { createFinanceAgent } from "@/lib/ai/finance-agent";
import { getDashboardData } from "@/lib/dashboard";
import { requireFinanceApi } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  if (!process.env.CLAUDE_API_KEY) {
    return Response.json({ error: "Claude is not configured" }, { status: 503 });
  }
  const { messages } = await request.json();
  const agent = createFinanceAgent(await getDashboardData());
  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    timeout: { totalMs: 55_000 },
  });
}
