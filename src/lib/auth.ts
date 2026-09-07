import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { execute, queryRows } from "@/lib/db";

export type FinanceAccess =
  | { allowed: true; userId: string }
  | { allowed: false; reason: "signed_out" | "not_owner" };

export async function getFinanceAccess(): Promise<FinanceAccess> {
  if (process.env.NODE_ENV === "development") {
    return { allowed: true, userId: "local-development" };
  }

  const { userId } = await auth();
  if (!userId) return { allowed: false, reason: "signed_out" };

  const [storedOwner] = await queryRows<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'owner_user_id'",
  );
  if (storedOwner) {
    return storedOwner.value === userId
      ? { allowed: true, userId }
      : { allowed: false, reason: "not_owner" };
  }

  const users = await (await clerkClient()).users.getUserList({
    limit: 1,
    orderBy: "+created_at",
  });
  const owner = users.data[0];
  if (owner && owner.id !== userId) return { allowed: false, reason: "not_owner" };
  await execute(
    "INSERT INTO app_settings (key, value) VALUES ('owner_user_id', ?) ON CONFLICT(key) DO NOTHING",
    [userId],
  );
  const [claimedOwner] = await queryRows<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'owner_user_id'",
  );
  return claimedOwner?.value === userId
    ? { allowed: true, userId }
    : { allowed: false, reason: "not_owner" };
}

export async function requireFinanceApi() {
  const access = await getFinanceAccess();
  if (access.allowed) return null;
  return Response.json(
    { error: access.reason === "signed_out" ? "Authentication required" : "Private account" },
    { status: access.reason === "signed_out" ? 401 : 403 },
  );
}
