import { z } from "zod";
import { requireFinanceApi } from "@/lib/auth";
import { execute } from "@/lib/db";

const schema = z.object({ monthlyBudget: z.number().min(0).max(1_000_000).multipleOf(0.01) }).strict();

export async function PATCH(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host") || new URL(request.url).host;
    try {
      const source = new URL(origin);
      if (!["http:", "https:"].includes(source.protocol) || source.host !== host || source.origin !== origin) throw new Error("Origin mismatch");
    } catch {
      return Response.json({ error: "This request must come from your finance app." }, { status: 403 });
    }
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a budget between $0 and $1,000,000, with at most two decimal places." }, { status: 400 });
  try {
    await execute(`INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ["monthly_spending_budget", String(parsed.data.monthlyBudget)]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Unable to save your budget. Please try again." }, { status: 500 });
  }
}
