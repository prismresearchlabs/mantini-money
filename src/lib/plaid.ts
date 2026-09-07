import {
  Configuration,
  CountryCode,
  type LinkTokenCreateRequest,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";
import { getPlaidConfig } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import {
  ensureSchema,
  getDb,
  getStoredItems,
  markItemError,
  updateItemCursor,
} from "@/lib/db";

export function getPlaidClient() {
  const { clientId, secret, environment } = getPlaidConfig();
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[environment],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    }),
  );
}

export async function createLinkToken() {
  const config = getPlaidConfig();
  const request: LinkTokenCreateRequest = {
    user: { client_user_id: "mantini-money-owner" },
    client_name: config.clientName,
    products: [Products.Transactions],
    required_if_supported_products: [Products.Investments],
    additional_consented_products: [Products.Liabilities],
    country_codes: [CountryCode.Us],
    language: "en",
    link_customization_name: "default",
    transactions: { days_requested: 730 },
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
  };
  const response = await getPlaidClient().linkTokenCreate(request);
  return response.data.link_token;
}

export async function createInvestmentsConsentLinkToken(encryptedAccessToken: string) {
  const config = getPlaidConfig();
  const request: LinkTokenCreateRequest = {
    user: { client_user_id: "mantini-money-owner" },
    client_name: config.clientName,
    access_token: decrypt(encryptedAccessToken),
    additional_consented_products: [Products.Investments],
    country_codes: [CountryCode.Us],
    language: "en",
    link_customization_name: "default",
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
  };
  const response = await getPlaidClient().linkTokenCreate(request);
  return response.data.link_token;
}

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current?: number | null;
    available?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  };
};

async function saveAccounts(itemId: string, accounts: PlaidAccount[]) {
  if (!accounts.length) return;
  await ensureSchema();
  await getDb().batch(
    accounts.map((account) => ({
      sql: `INSERT INTO accounts (
        account_id, item_id, name, official_name, mask, type, subtype, currency,
        current_balance, available_balance, credit_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        name = excluded.name,
        official_name = excluded.official_name,
        mask = excluded.mask,
        type = excluded.type,
        subtype = excluded.subtype,
        currency = excluded.currency,
        current_balance = excluded.current_balance,
        available_balance = excluded.available_balance,
        credit_limit = excluded.credit_limit,
        updated_at = CURRENT_TIMESTAMP`,
      args: [
        account.account_id,
        itemId,
        account.name,
        account.official_name ?? null,
        account.mask ?? null,
        account.type,
        account.subtype ?? null,
        account.balances.iso_currency_code ?? "USD",
        account.balances.current ?? null,
        account.balances.available ?? null,
        account.balances.limit ?? null,
      ],
    })),
    "write",
  );
}

type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  amount: number;
  iso_currency_code?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
  payment_channel?: string | null;
  logo_url?: string | null;
};

type PlaidSecurity = {
  security_id: string;
  name?: string | null;
  ticker_symbol?: string | null;
  type?: string | null;
  subtype?: string | null;
  close_price?: number | null;
  close_price_as_of?: string | null;
  update_datetime?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

type PlaidHolding = {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price?: number | null;
  institution_value: number;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
};

async function upsertTransactions(itemId: string, values: PlaidTransaction[]) {
  if (!values.length) return;
  await ensureSchema();
  await getDb().batch(
    values.map((value) => ({
      sql: `INSERT INTO transactions (
        transaction_id, item_id, account_id, transaction_date, authorized_date,
        name, merchant_name, amount, currency, pending, category_primary,
        category_detailed, payment_channel, logo_url, pending_transaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        account_id = excluded.account_id,
        transaction_date = excluded.transaction_date,
        authorized_date = excluded.authorized_date,
        name = excluded.name,
        merchant_name = excluded.merchant_name,
        amount = excluded.amount,
        currency = excluded.currency,
        pending = excluded.pending,
        category_primary = excluded.category_primary,
        category_detailed = excluded.category_detailed,
        payment_channel = excluded.payment_channel,
        logo_url = excluded.logo_url,
        pending_transaction_id = excluded.pending_transaction_id,
        updated_at = CURRENT_TIMESTAMP`,
      args: [
        value.transaction_id,
        itemId,
        value.account_id,
        value.date,
        value.authorized_date ?? null,
        value.name,
        value.merchant_name ?? null,
        value.amount,
        value.iso_currency_code ?? "USD",
        value.pending ? 1 : 0,
        value.personal_finance_category?.primary ?? null,
        value.personal_finance_category?.detailed ?? null,
        value.payment_channel ?? null,
        value.logo_url ?? null,
        value.pending_transaction_id ?? null,
      ],
    })),
    "write",
  );
}

async function syncLiabilities(accessToken: string) {
  try {
    const response = await getPlaidClient().liabilitiesGet({ access_token: accessToken });
    const liabilities = response.data.liabilities.credit ?? [];
    if (!liabilities.length) return;
    await getDb().batch(
      liabilities.map((liability) => {
        const purchaseApr = liability.aprs?.find((apr) => apr.apr_type === "purchase_apr");
        return {
          sql: `INSERT INTO credit_liabilities (
            account_id, last_statement_balance, minimum_payment,
            next_payment_due_date, last_payment_amount, last_payment_date,
            apr_percentage
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET
            last_statement_balance = excluded.last_statement_balance,
            minimum_payment = excluded.minimum_payment,
            next_payment_due_date = excluded.next_payment_due_date,
            last_payment_amount = excluded.last_payment_amount,
            last_payment_date = excluded.last_payment_date,
            apr_percentage = excluded.apr_percentage,
            updated_at = CURRENT_TIMESTAMP`,
          args: [
            liability.account_id,
            liability.last_statement_balance ?? null,
            liability.minimum_payment_amount ?? null,
            liability.next_payment_due_date ?? null,
            liability.last_payment_amount ?? null,
            liability.last_payment_date ?? null,
            purchaseApr?.apr_percentage ?? liability.aprs?.[0]?.apr_percentage ?? null,
          ],
        };
      }),
      "write",
    );
  } catch {
    // The Item may not contain a liability-compatible account.
  }
}

async function syncInvestments(itemId: string, accessToken: string) {
  try {
    const response = await getPlaidClient().investmentsHoldingsGet({ access_token: accessToken });
    await saveAccounts(itemId, response.data.accounts as PlaidAccount[]);

    const securities = response.data.securities as PlaidSecurity[];
    if (securities.length) {
      await getDb().batch(
        securities.map((security) => ({
          sql: `INSERT INTO investment_securities (
            security_id, name, ticker_symbol, type, subtype, close_price,
            close_price_as_of, update_datetime, currency, unofficial_currency_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(security_id) DO UPDATE SET
            name = excluded.name,
            ticker_symbol = excluded.ticker_symbol,
            type = excluded.type,
            subtype = excluded.subtype,
            close_price = excluded.close_price,
            close_price_as_of = excluded.close_price_as_of,
            update_datetime = excluded.update_datetime,
            currency = excluded.currency,
            unofficial_currency_code = excluded.unofficial_currency_code,
            updated_at = CURRENT_TIMESTAMP`,
          args: [
            security.security_id,
            security.name ?? null,
            security.ticker_symbol ?? null,
            security.type ?? null,
            security.subtype ?? null,
            security.close_price ?? null,
            security.close_price_as_of ?? null,
            security.update_datetime ?? null,
            security.iso_currency_code ?? null,
            security.unofficial_currency_code ?? null,
          ],
        })),
        "write",
      );
    }

    const holdings = response.data.holdings as PlaidHolding[];
    await getDb().batch(
      [
        {
          sql: `DELETE FROM investment_holdings
                WHERE account_id IN (SELECT account_id FROM accounts WHERE item_id = ?)`,
          args: [itemId],
        },
        ...holdings.map((holding) => ({
          sql: `INSERT INTO investment_holdings (
            account_id, security_id, quantity, institution_price,
            institution_value, cost_basis, currency, unofficial_currency_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            holding.account_id,
            holding.security_id,
            holding.quantity,
            holding.institution_price ?? null,
            holding.institution_value,
            holding.cost_basis ?? null,
            holding.iso_currency_code ?? null,
            holding.unofficial_currency_code ?? null,
          ],
        })),
      ],
      "write",
    );
  } catch (error) {
    const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
    console.warn(`Investment holdings unavailable for Plaid Item ${itemId}${code ? ` (${code})` : ""}`);
  }
}

export async function syncItem(input: {
  itemId: string;
  encryptedAccessToken: string;
  cursor: string | null;
}) {
  const accessToken = decrypt(input.encryptedAccessToken);
  try {
    await ensureSchema();
    const accountsResponse = await getPlaidClient().accountsGet({ access_token: accessToken });
    await saveAccounts(input.itemId, accountsResponse.data.accounts as PlaidAccount[]);

    let cursor = input.cursor;
    let hasMore = true;
    do {
      const response = await getPlaidClient().transactionsSync({
        access_token: accessToken,
        cursor: cursor ?? undefined,
        count: 500,
        options: { include_original_description: true },
      });
      await upsertTransactions(input.itemId, [
        ...(response.data.added as PlaidTransaction[]),
        ...(response.data.modified as PlaidTransaction[]),
      ]);
      if (response.data.removed.length) {
        await getDb().batch(
          response.data.removed.map((value) => ({
            sql: "DELETE FROM transactions WHERE transaction_id = ?",
            args: [value.transaction_id],
          })),
          "write",
        );
      }
      cursor = response.data.next_cursor;
      hasMore = response.data.has_more;
    } while (hasMore);

    await updateItemCursor(input.itemId, cursor);
    await syncLiabilities(accessToken);
    await syncInvestments(input.itemId, accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Plaid sync failed";
    await markItemError(input.itemId, message);
    throw error;
  }
}

export async function syncAllItems() {
  const items = await getStoredItems();
  for (const item of items) {
    await syncItem({
      itemId: item.item_id,
      encryptedAccessToken: item.access_token,
      cursor: item.cursor,
    });
  }
  return items.length;
}
