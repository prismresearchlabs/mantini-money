export const TRANSACTION_CATEGORIES = [
  "Groceries",
  "Dining",
  "Shopping",
  "Transportation",
  "Travel",
  "Entertainment",
  "Health & Fitness",
  "Personal Care",
  "Subscriptions",
  "Education",
  "Business",
  "Housing",
  "Fees",
  "Gifts & Donations",
  "Taxes",
  "Investment",
  "Savings",
  "Income",
  "Card Payment",
  "Transfer",
  "Refund",
  "Other",
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export function merchantKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function automaticSpendingCategory(input: {
  name: string;
  primary: string | null;
  detailed: string | null;
}): TransactionCategory {
  const value = `${input.name} ${input.primary ?? ""} ${input.detailed ?? ""}`.toUpperCase();

  if (/WHOLE FOODS|TRADER JOE|ALDI|KROGER|SAFEWAY|H-E-B|\bHEB\b|COSTCO|GROCERY|SUPERMARKET/.test(value)) return "Groceries";
  if (/WILD PITA|RESTAURANT|COFFEE|FAST FOOD|FOOD AND DRINK|STARBUCKS|DOORDASH|UBER EATS/.test(value)) return "Dining";
  if (/PHARMAC|CVS|WALGREENS|MEDICAL|DENTAL|HEALTHCARE/.test(value)) return "Health & Fitness";
  if (/NIKE|GENERAL MERCHANDISE|CLOTHING|ELECTRONICS|ONLINE MARKETPLACE|DEPARTMENT STORE/.test(value)) return "Shopping";
  if (/GYM|FITNESS|SPORTING/.test(value)) return "Health & Fitness";
  if (/HAIR|SPA|PERSONAL CARE|BEAUTY/.test(value)) return "Personal Care";
  if (/GAS|PARKING|TAXI|RIDESHARE|PUBLIC TRANSIT|TRANSPORTATION|AUTOMOTIVE/.test(value)) return "Transportation";
  if (/AIRLINE|LODGING|HOTEL|TRAVEL/.test(value)) return "Travel";
  if (/STREAMING|MUSIC|ENTERTAINMENT|CASINO|GAMBLING|RECREATION/.test(value)) return "Entertainment";
  if (/YOUTUBE PREMIUM|GOOGLE ONE|PDF\s?FILLER|SUBSCRIPTION|SOFTWARE|INTERNET|PHONE/.test(value)) return "Subscriptions";
  if (/RENT|MORTGAGE|UTILIT|HOME IMPROVEMENT/.test(value)) return "Housing";
  if (/SCHOOL|COLLEGE|UNIVERSITY|EDUCATION/.test(value)) return "Education";
  if (/ADVERTISING|SHIPPING|POSTAGE|OFFICE|BUSINESS/.test(value)) return "Business";
  if (/BANK FEE|INTEREST CHARGE|OVERDRAFT|FEE/.test(value)) return "Fees";
  if (/CHARITY|DONATION|GIFT/.test(value)) return "Gifts & Donations";
  if (/TAX|IRS|GOVERNMENT/.test(value)) return "Taxes";
  return "Other";
}
