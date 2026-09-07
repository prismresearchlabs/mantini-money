import { z } from "zod";
import { TRANSACTION_CATEGORIES, merchantKey } from "@/lib/categories";
import { getDb, queryRows } from "@/lib/db";
import { requireFinanceApi } from "@/lib/auth";

const schema = z.object({
  transactionId: z.string().min(1),
  category: z.enum(TRANSACTION_CATEGORIES),
});

export async function POST(request: Request) {
  const denied = await requireFinanceApi();
  if (denied) return denied;
  try {
    const { transactionId, category } = schema.parse(await request.json());
    const [transaction] = await queryRows<{ name: string; merchant_name: string | null }>(
      "SELECT name, merchant_name FROM transactions WHERE transaction_id = ?",
      [transactionId],
    );
    if (!transaction) return Response.json({ error: "Transaction not found" }, { status: 404 });

    const key = merchantKey(transaction.merchant_name || transaction.name);
    await getDb().batch(
      [
        {
          sql: `UPDATE transactions
                SET user_category = ?, category_source = 'manual', updated_at = CURRENT_TIMESTAMP
                WHERE transaction_id = ?`,
          args: [category, transactionId],
        },
        {
          sql: `INSERT INTO merchant_category_rules (merchant_key, category)
                VALUES (?, ?)
                ON CONFLICT(merchant_key) DO UPDATE SET
                  category = excluded.category,
                  updated_at = CURRENT_TIMESTAMP`,
          args: [key, category],
        },
      ],
      "write",
    );

    return Response.json({ ok: true, category });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update category";
    return Response.json({ error: message }, { status: 400 });
  }
}
