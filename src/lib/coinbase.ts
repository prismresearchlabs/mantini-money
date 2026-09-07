import "server-only";

import { createPrivateKey, randomBytes, sign } from "node:crypto";

const COINBASE_HOST = "api.coinbase.com";
const COINBASE_ORIGIN = `https://${COINBASE_HOST}`;

type CoinbaseAccount = {
  id: string;
  name: string;
  type: string;
  currency: {
    code: string;
    name?: string;
    type?: string;
  };
  balance: {
    amount: string;
    currency: string;
  };
  updated_at?: string;
};

type CoinbaseAccountsResponse = {
  data?: CoinbaseAccount[];
  pagination?: { next_uri?: string | null };
};

type CoinbaseRatesResponse = {
  data?: {
    currency?: string;
    rates?: Record<string, string>;
  };
};

export type CoinbaseHolding = {
  accountId: string;
  accountName: string;
  institutionName: "Coinbase";
  securityId: string;
  name: string;
  ticker: string;
  type: "cryptocurrency";
  subtype: string | null;
  quantity: number;
  price: number;
  value: number;
  costBasis: null;
  unofficialCurrencyCode: string;
  updatedAt: string | null;
};

export type CoinbasePortfolio = {
  configured: boolean;
  status: "not_configured" | "connected" | "error";
  error: string | null;
  updatedAt: string | null;
  holdings: CoinbaseHolding[];
};

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getCoinbaseCredentials() {
  const keyName = process.env.COINBASE_API_KEY_NAME?.trim();
  const privateKeyValue = process.env.COINBASE_API_PRIVATE_KEY?.trim();
  if (!keyName || !privateKeyValue) return null;
  const normalized = privateKeyValue.replace(/\\n/g, "\n").trim();
  const privateKey = normalized.includes("BEGIN ")
    ? normalized
    : `-----BEGIN EC PRIVATE KEY-----\n${normalized}\n-----END EC PRIVATE KEY-----`;
  return {
    keyName,
    privateKey,
  };
}

function createJwt(method: string, path: string, keyName: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: keyName,
    nonce: randomBytes(16).toString("hex"),
    typ: "JWT",
  };
  const payload = {
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    sub: keyName,
    uri: `${method} ${COINBASE_HOST}${path}`,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64Url(signature)}`;
}

async function listAccounts(keyName: string, privateKey: string) {
  const accounts: CoinbaseAccount[] = [];
  let nextUri: string | null = "/v2/accounts?limit=100";
  let page = 0;

  while (nextUri && page < 10) {
    const url = new URL(nextUri, COINBASE_ORIGIN);
    const token = createJwt("GET", url.pathname, keyName, privateKey);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Coinbase rejected the read-only key (${response.status})`);
    }
    const body = (await response.json()) as CoinbaseAccountsResponse;
    accounts.push(...(body.data ?? []));
    nextUri = body.pagination?.next_uri ?? null;
    page += 1;
  }

  return accounts;
}

async function getUsdRate(currency: string) {
  if (currency === "USD") return 1;
  const response = await fetch(
    `${COINBASE_ORIGIN}/v2/exchange-rates?currency=${encodeURIComponent(currency)}`,
    { cache: "no-store", signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as CoinbaseRatesResponse;
  const rate = Number(body.data?.rates?.USD);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function getCoinbasePortfolio(): Promise<CoinbasePortfolio> {
  const credentials = getCoinbaseCredentials();
  if (!credentials) {
    return {
      configured: false,
      status: "not_configured",
      error: null,
      updatedAt: null,
      holdings: [],
    };
  }

  try {
    const accounts = await listAccounts(credentials.keyName, credentials.privateKey);
    const nonzeroAccounts = accounts.filter((account) => {
      const quantity = Number(account.balance.amount);
      return account.currency.type === "crypto" && Number.isFinite(quantity) && quantity > 0;
    });
    const rates = new Map(
      await Promise.all(
        [...new Set(nonzeroAccounts.map((account) => account.currency.code))].map(
          async (currency) => [currency, await getUsdRate(currency)] as const,
        ),
      ),
    );
    const holdings = nonzeroAccounts
      .map((account): CoinbaseHolding | null => {
        const quantity = Number(account.balance.amount);
        const price = rates.get(account.currency.code);
        if (!price) return null;
        const value = quantity * price;
        if (value < 0.005) return null;
        return {
          accountId: `coinbase:${account.id}`,
          accountName: account.name,
          institutionName: "Coinbase",
          securityId: `coinbase:${account.currency.code}`,
          name: account.currency.name || account.name || account.currency.code,
          ticker: account.currency.code,
          type: "cryptocurrency",
          subtype: account.type || null,
          quantity,
          price,
          value,
          costBasis: null,
          unofficialCurrencyCode: account.currency.code,
          updatedAt: account.updated_at ?? null,
        };
      })
      .filter((holding): holding is CoinbaseHolding => holding !== null)
      .sort((a, b) => b.value - a.value);

    return {
      configured: true,
      status: "connected",
      error: null,
      updatedAt: new Date().toISOString(),
      holdings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Coinbase connection failed";
    console.warn(message);
    return {
      configured: true,
      status: "error",
      error: message,
      updatedAt: null,
      holdings: [],
    };
  }
}
