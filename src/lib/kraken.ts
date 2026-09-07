import "server-only";

import { createHash, createHmac } from "node:crypto";

const KRAKEN_ORIGIN = "https://api.kraken.com";
const CACHE_WINDOW_MS = 30_000;

type KrakenEnvelope<T> = {
  error?: string[];
  result?: T;
};

type KrakenPair = {
  altname?: string;
  wsname?: string;
  base?: string;
  quote?: string;
};

type KrakenTicker = {
  c?: [string, string];
};

export type KrakenHolding = {
  accountId: string;
  accountName: string;
  institutionName: "Kraken";
  securityId: string;
  name: string;
  ticker: string;
  type: "cryptocurrency" | "cash";
  subtype: "spot";
  quantity: number;
  price: number;
  value: number;
  costBasis: null;
  unofficialCurrencyCode: string;
  updatedAt: string;
};

export type KrakenPortfolio = {
  configured: boolean;
  status: "not_configured" | "connected" | "error";
  error: string | null;
  updatedAt: string | null;
  holdings: KrakenHolding[];
};

const assetNames: Record<string, string> = {
  ADA: "Cardano",
  AVAX: "Avalanche",
  BTC: "Bitcoin",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  ETH: "Ethereum",
  EUR: "Euros",
  GBP: "British Pounds",
  LINK: "Chainlink",
  LTC: "Litecoin",
  SOL: "Solana",
  USD: "US Dollars",
  USDC: "USD Coin",
  USDT: "Tether",
  XBT: "Bitcoin",
  XRP: "XRP",
};

const fiatSymbols = new Set(["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "USD"]);

let lastNonce = 0n;
let cache: { expiresAt: number; data: KrakenPortfolio } | null = null;
let inFlight: Promise<KrakenPortfolio> | null = null;

function nextNonce() {
  const candidate = BigInt(Date.now()) * 1_000n;
  lastNonce = candidate > lastNonce ? candidate : lastNonce + 1n;
  return lastNonce.toString();
}

function credentials() {
  const apiKey = process.env.KRAKEN_API_KEY?.trim();
  const apiSecret = process.env.KRAKEN_API_SECRET?.trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

async function readJson<T>(response: Response, label: string) {
  if (!response.ok) throw new Error(`Kraken ${label} request failed (${response.status})`);
  const body = (await response.json()) as KrakenEnvelope<T>;
  if (body.error?.length) throw new Error(`Kraken rejected the read-only key: ${body.error.join(", ")}`);
  if (!body.result) throw new Error(`Kraken returned no ${label} data`);
  return body.result;
}

async function privatePost<T>(path: string, apiKey: string, apiSecret: string) {
  const nonce = nextNonce();
  const body = new URLSearchParams({ nonce }).toString();
  const digest = createHash("sha256").update(nonce + body).digest();
  const message = Buffer.concat([Buffer.from(path), digest]);
  let secret: Buffer;
  try {
    secret = Buffer.from(apiSecret, "base64");
  } catch {
    throw new Error("Kraken API secret is not valid base64");
  }
  const signature = createHmac("sha512", secret).update(message).digest("base64");
  const response = await fetch(`${KRAKEN_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return readJson<T>(response, "balance");
}

async function publicGet<T>(path: string, label: string) {
  const response = await fetch(`${KRAKEN_ORIGIN}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  return readJson<T>(response, label);
}

function stripBalanceExtension(symbol: string) {
  return symbol.replace(/\.[A-Z]+$/i, "");
}

function buildAssetAliases(pairs: Record<string, KrakenPair>) {
  const aliases = new Map<string, string>([
    ["XBT", "BTC"],
    ["XXBT", "BTC"],
    ["XETH", "ETH"],
    ["ZUSD", "USD"],
    ["ZEUR", "EUR"],
    ["ZGBP", "GBP"],
    ["ZJPY", "JPY"],
    ["ZCAD", "CAD"],
    ["ZAUD", "AUD"],
  ]);

  for (const pair of Object.values(pairs)) {
    const [baseName, quoteName] = pair.wsname?.split("/") ?? [];
    if (pair.base && baseName) aliases.set(pair.base, baseName === "XBT" ? "BTC" : baseName);
    if (pair.quote && quoteName) aliases.set(pair.quote, quoteName === "XBT" ? "BTC" : quoteName);
  }
  return aliases;
}

function canonicalSymbol(raw: string, aliases: Map<string, string>) {
  const stripped = stripBalanceExtension(raw);
  return aliases.get(stripped) ?? (stripped === "XBT" ? "BTC" : stripped);
}

type PriceEdge = { symbol: string; multiplier: number };

function buildPriceGraph(
  pairs: Record<string, KrakenPair>,
  tickers: Record<string, KrakenTicker>,
  aliases: Map<string, string>,
) {
  const graph = new Map<string, PriceEdge[]>();
  const connect = (from: string, to: string, multiplier: number) => {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    graph.set(from, [...(graph.get(from) ?? []), { symbol: to, multiplier }]);
  };

  for (const [pairKey, pair] of Object.entries(pairs)) {
    if (!pair.base || !pair.quote) continue;
    const price = Number(tickers[pairKey]?.c?.[0] ?? tickers[pair.altname ?? ""]?.c?.[0]);
    if (!Number.isFinite(price) || price <= 0) continue;
    const base = canonicalSymbol(pair.base, aliases);
    const quote = canonicalSymbol(pair.quote, aliases);
    connect(base, quote, price);
    connect(quote, base, 1 / price);
  }
  return graph;
}

function priceInUsd(symbol: string, graph: Map<string, PriceEdge[]>) {
  if (symbol === "USD" || symbol === "USDC" || symbol === "USDT") return 1;
  const queue: Array<{ symbol: string; price: number; depth: number }> = [
    { symbol, price: 1, depth: 0 },
  ];
  const visited = new Set([symbol]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= 3) continue;
    for (const edge of graph.get(current.symbol) ?? []) {
      const price = current.price * edge.multiplier;
      if (edge.symbol === "USD" || edge.symbol === "USDC" || edge.symbol === "USDT") return price;
      if (!visited.has(edge.symbol)) {
        visited.add(edge.symbol);
        queue.push({ symbol: edge.symbol, price, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

async function loadPortfolio(apiKey: string, apiSecret: string): Promise<KrakenPortfolio> {
  const [balances, pairs, tickers] = await Promise.all([
    privatePost<Record<string, string>>("/0/private/Balance", apiKey, apiSecret),
    publicGet<Record<string, KrakenPair>>("/0/public/AssetPairs", "asset pair"),
    publicGet<Record<string, KrakenTicker>>("/0/public/Ticker", "ticker"),
  ]);
  const aliases = buildAssetAliases(pairs);
  const graph = buildPriceGraph(pairs, tickers, aliases);
  const quantities = new Map<string, number>();
  for (const [rawSymbol, rawQuantity] of Object.entries(balances)) {
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const symbol = canonicalSymbol(rawSymbol, aliases);
    quantities.set(symbol, (quantities.get(symbol) ?? 0) + quantity);
  }

  const updatedAt = new Date().toISOString();
  const holdings = [...quantities.entries()]
    .map(([ticker, quantity]): KrakenHolding | null => {
      const price = priceInUsd(ticker, graph);
      if (price === null || quantity * price < 0.005) return null;
      return {
        accountId: "kraken",
        accountName: "Kraken",
        institutionName: "Kraken",
        securityId: `kraken:${ticker}`,
        name: assetNames[ticker] ?? ticker,
        ticker,
        type: fiatSymbols.has(ticker) ? "cash" : "cryptocurrency",
        subtype: "spot",
        quantity,
        price,
        value: quantity * price,
        costBasis: null,
        unofficialCurrencyCode: ticker,
        updatedAt,
      };
    })
    .filter((holding): holding is KrakenHolding => holding !== null)
    .sort((a, b) => b.value - a.value);

  return { configured: true, status: "connected", error: null, updatedAt, holdings };
}

export async function getKrakenPortfolio(): Promise<KrakenPortfolio> {
  const key = credentials();
  if (!key) {
    return { configured: false, status: "not_configured", error: null, updatedAt: null, holdings: [] };
  }
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  if (inFlight) return inFlight;

  inFlight = loadPortfolio(key.apiKey, key.apiSecret)
    .then((data) => {
      cache = { expiresAt: Date.now() + CACHE_WINDOW_MS, data };
      return data;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Kraken connection failed";
      console.warn(message);
      return {
        configured: true,
        status: "error" as const,
        error: message,
        updatedAt: null,
        holdings: [],
      };
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
