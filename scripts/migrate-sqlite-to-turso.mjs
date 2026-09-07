import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import { loadEnvFile } from "node:process";
import path from "node:path";

loadEnvFile(path.join(process.cwd(), ".env.development.local"));

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error("Turso development environment variables are missing");
}

const source = new Database(path.join(process.cwd(), "data", "mantini-money-production.db"), {
  readonly: true,
});
const target = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await target.batch(
  [
    `CREATE TABLE IF NOT EXISTS plaid_items (
      item_id TEXT PRIMARY KEY, access_token TEXT NOT NULL, institution_id TEXT,
      institution_name TEXT NOT NULL, cursor TEXT, status TEXT NOT NULL DEFAULT 'healthy',
      error_message TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
      name TEXT NOT NULL, official_name TEXT, mask TEXT, type TEXT NOT NULL, subtype TEXT,
      currency TEXT NOT NULL DEFAULT 'USD', current_balance REAL, available_balance REAL,
      credit_limit REAL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      transaction_id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      transaction_date TEXT NOT NULL, authorized_date TEXT, name TEXT NOT NULL, merchant_name TEXT,
      amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', pending INTEGER NOT NULL DEFAULT 0,
      category_primary TEXT, category_detailed TEXT, payment_channel TEXT, logo_url TEXT,
      pending_transaction_id TEXT, user_category TEXT, category_source TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`,
    `CREATE TABLE IF NOT EXISTS credit_liabilities (
      account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
      last_statement_balance REAL, minimum_payment REAL, next_payment_due_date TEXT,
      last_payment_amount REAL, last_payment_date TEXT, apr_percentage REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS merchant_category_rules (
      merchant_key TEXT PRIMARY KEY, category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS advisor_insights (
      insight_date TEXT PRIMARY KEY, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ],
  "write",
);

for (const table of ["plaid_items", "accounts", "transactions", "credit_liabilities"]) {
  const rows = source.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) continue;
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  for (let start = 0; start < rows.length; start += 100) {
    await target.batch(
      rows.slice(start, start + 100).map((row) => ({
        sql,
        args: columns.map((column) => row[column]),
      })),
      "write",
    );
  }
  console.log(`${table}: ${rows.length} rows migrated`);
}

source.close();
target.close();
