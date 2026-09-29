import { z } from "zod";
import { requireFinanceApi } from "@/lib/auth";
import { getDb, queryRows } from "@/lib/db";
import { taxEstimateInputSchema } from "@/lib/tax-estimate";

const settingsSchema = z.object({
  accountIds: z.array(z.string().min(1).max(256)).max(100).optional(),
  scenario: taxEstimateInputSchema.nullable().optional(),
}).strict().refine((value) => value.accountIds !== undefined || value.scenario !== undefined,
  "Provide reserve accounts or a tax estimate.");

export async function PATCH(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  const origin = request.headers.get("origin");
  if (origin) {
    // Next may use an internal hostname in request.url. Host is the actual
    // destination sent by the browser; do not trust arbitrary forwarded hosts.
    const host = request.headers.get("host") || new URL(request.url).host;
    try {
      const source = new URL(origin);
      if (!["http:", "https:"].includes(source.protocol) || source.host !== host || source.origin !== origin) throw new Error("Origin mismatch");
    } catch {
      return Response.json({ error: "This request must come from your finance app." }, { status: 403 });
    }
  }
  let raw: unknown;
  try { raw = await request.json(); } catch {
    return Response.json({ error: "Invalid settings." }, { status: 400 });
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Check the account selection and tax estimate. Amounts must be valid, nonnegative numbers." }, { status: 400 });
  }
  try {
    const settings: { key: string; value: string }[] = [];
    if (parsed.data.accountIds !== undefined) {
      const accountIds = [...new Set(parsed.data.accountIds)].sort();
      const eligible = await queryRows<{ account_id: string }>(
        "SELECT account_id FROM accounts WHERE type = 'depository' AND currency = 'USD'",
      );
      const known = new Set(eligible.map((account) => account.account_id));
      if (accountIds.some((id) => !known.has(id))) {
        return Response.json({ error: "Choose only connected cash accounts in USD." }, { status: 400 });
      }
      settings.push({ key: "tax_account_ids", value: JSON.stringify(accountIds) });
    }
    if (parsed.data.scenario !== undefined) {
      settings.push({ key: "tax_scenario_2026", value: JSON.stringify(parsed.data.scenario) });
    }
    // queryRows initializes the schema even when only the scenario changes.
    await queryRows("SELECT key FROM app_settings LIMIT 1");
    await getDb().batch(settings.map(({ key, value }) => ({
      sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      args: [key, value],
    })), "write");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Unable to save tax settings. Please try again." }, { status: 500 });
  }
}
