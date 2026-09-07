export type PlaidEnvironment = "sandbox" | "production";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getPlaidEnvironment(): PlaidEnvironment {
  const value = process.env.PLAID_ENV?.trim().toLowerCase();
  if (value === "production") return "production";
  return "sandbox";
}

export function getPlaidConfig() {
  const environment = getPlaidEnvironment();
  return {
    environment,
    clientId: required("PLAID_CLIENT_ID"),
    secret: required(
      environment === "production"
        ? "PLAID_PRODUCTION_SECRET"
        : "PLAID_SANDBOX_SECRET",
    ),
    clientName: process.env.PLAID_CLIENT_NAME?.trim() || "Mantini Money",
    redirectUri: process.env.PLAID_REDIRECT_URI?.trim() || undefined,
  };
}
