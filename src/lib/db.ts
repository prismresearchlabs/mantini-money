import { createClient, type Client, type InArgs } from "@libsql/client";
import path from "path";
import { mkdirSync } from "node:fs";
import { getPlaidEnvironment } from "@/lib/config";

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

function databaseUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  return `file:${path.join(process.cwd(), "data", `mantini-money-${getPlaidEnvironment()}.db`)}`;
}

export function getDb() {
  if (!client) {
    client = createClient({
      url: databaseUrl(),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const database = getDb();
      await database.batch(
        [
          `CREATE TABLE IF NOT EXISTS plaid_items (
            item_id TEXT PRIMARY KEY,
            access_token TEXT NOT NULL,
            institution_id TEXT,
            institution_name TEXT NOT NULL,
            cursor TEXT,
            status TEXT NOT NULL DEFAULT 'healthy',
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS accounts (
            account_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            official_name TEXT,
            mask TEXT,
            type TEXT NOT NULL,
            subtype TEXT,
            currency TEXT NOT NULL DEFAULT 'USD',
            current_balance REAL,
            available_balance REAL,
            credit_limit REAL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS transactions (
            transaction_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES plaid_items(item_id) ON DELETE CASCADE,
            account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
            transaction_date TEXT NOT NULL,
            authorized_date TEXT,
            name TEXT NOT NULL,
            merchant_name TEXT,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD',
            pending INTEGER NOT NULL DEFAULT 0,
            category_primary TEXT,
            category_detailed TEXT,
            payment_channel TEXT,
            logo_url TEXT,
            pending_transaction_id TEXT,
            user_category TEXT,
            category_source TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`,
          `CREATE TABLE IF NOT EXISTS credit_liabilities (
            account_id TEXT PRIMARY KEY REFERENCES accounts(account_id) ON DELETE CASCADE,
            last_statement_balance REAL,
            minimum_payment REAL,
            next_payment_due_date TEXT,
            last_payment_amount REAL,
            last_payment_date TEXT,
            apr_percentage REAL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS investment_securities (
            security_id TEXT PRIMARY KEY,
            name TEXT,
            ticker_symbol TEXT,
            type TEXT,
            subtype TEXT,
            close_price REAL,
            close_price_as_of TEXT,
            update_datetime TEXT,
            currency TEXT,
            unofficial_currency_code TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS investment_holdings (
            account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
            security_id TEXT NOT NULL REFERENCES investment_securities(security_id) ON DELETE CASCADE,
            quantity REAL NOT NULL DEFAULT 0,
            institution_price REAL,
            institution_value REAL NOT NULL DEFAULT 0,
            cost_basis REAL,
            currency TEXT,
            unofficial_currency_code TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (account_id, security_id)
          )`,
          `CREATE INDEX IF NOT EXISTS idx_investment_holdings_account ON investment_holdings(account_id)`,
          `CREATE TABLE IF NOT EXISTS merchant_category_rules (
            merchant_key TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS advisor_insights (
            insight_date TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            context_key TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS net_worth_snapshots (
            snapshot_date TEXT PRIMARY KEY,
            assets REAL NOT NULL,
            liabilities REAL NOT NULL,
            net_worth REAL NOT NULL,
            recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS tax_reserve_net_worth_snapshots (
            scope_key TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            assets REAL NOT NULL,
            liabilities REAL NOT NULL,
            net_worth REAL NOT NULL,
            tax_reserve REAL NOT NULL,
            recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (scope_key, snapshot_date)
          )`,
        ],
        "write",
      );
      const columns = await database.execute("PRAGMA table_info(transactions)");
      const names = new Set(columns.rows.map((row) => String(row.name)));
      const migrations = [
        ["pending_transaction_id", "TEXT"],
        ["user_category", "TEXT"],
        ["category_source", "TEXT"],
      ].filter(([name]) => !names.has(name));
      for (const [name, type] of migrations) {
        await database.execute(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
      }
      const insightColumns = await database.execute("PRAGMA table_info(advisor_insights)");
      if (!insightColumns.rows.some((row) => row.name === "context_key")) {
        await database.execute("ALTER TABLE advisor_insights ADD COLUMN context_key TEXT");
      }
    })();
  }
  await schemaReady;
}

export async function queryRows<T>(sql: string, args: InArgs = []) {
  await ensureSchema();
  const result = await getDb().execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function execute(sql: string, args: InArgs = []) {
  await ensureSchema();
  return getDb().execute({ sql, args });
}

export type StoredItem = {
  item_id: string;
  access_token: string;
  institution_name: string;
  cursor: string | null;
};

export async function getStoredItems() {
  return queryRows<StoredItem>(
    "SELECT item_id, access_token, institution_name, cursor FROM plaid_items ORDER BY created_at",
  );
}

export async function saveItem(input: {
  itemId: string;
  accessToken: string;
  institutionId?: string;
  institutionName: string;
}) {
  await execute(
    `INSERT INTO plaid_items (item_id, access_token, institution_id, institution_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       access_token = excluded.access_token,
       institution_id = excluded.institution_id,
       institution_name = excluded.institution_name,
       status = 'healthy',
       error_message = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [input.itemId, input.accessToken, input.institutionId ?? null, input.institutionName],
  );
}

export async function updateItemCursor(itemId: string, cursor: string | null) {
  await execute(
    "UPDATE plaid_items SET cursor = ?, status = 'healthy', error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
    [cursor, itemId],
  );
}

export async function markItemError(itemId: string, message: string) {
  await execute(
    "UPDATE plaid_items SET status = 'error', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?",
    [message.slice(0, 500), itemId],
  );
}
