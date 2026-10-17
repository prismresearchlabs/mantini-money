export function plaidErrorMessage(error: unknown) {
  const data = (error as { response?: { data?: { error_code?: string; display_message?: string } } })?.response?.data;
  switch (data?.error_code) {
    case "NO_ACCOUNTS":
      return "This connection no longer has access to any accounts. Use Manage connection to restore account access.";
    case "ITEM_LOGIN_REQUIRED":
    case "ITEM_LOCKED":
    case "PENDING_EXPIRATION":
      return "Your bank needs you to sign in again. Use Manage connection to repair this connection.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
    case "INSTITUTION_NOT_AVAILABLE":
      return "Your bank is temporarily unavailable. Try syncing again later; you do not need to add it again.";
    case "PRODUCT_NOT_READY":
      return "Your bank is still preparing account data. Try syncing again shortly.";
    default:
      return data?.display_message || (data?.error_code
        ? `Bank sync failed (${data.error_code}). Try syncing again or manage this connection.`
        : "Unable to refresh this connection. Try syncing again; if it persists, manage this connection.");
  }
}
