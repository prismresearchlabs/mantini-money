import { z } from "zod";

/** A deliberately limited annual planning model, not a tax return or payment schedule. */
export const TAX_YEAR = 2026 as const;

export const TAX_ESTIMATE_SOURCES = {
  brackets: {
    title: "IRS: 2026 federal income-tax brackets",
    url: "https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill",
  },
  standardDeduction: {
    title: "IRS: 2026 standard deductions",
    url: "https://www.irs.gov/irb/2025-45_IRB",
  },
  selfEmployment: {
    title: "IRS: self-employment earnings, rates, and deduction",
    url: "https://www.irs.gov/taxtopics/tc554",
  },
  selfEmploymentThreshold: {
    title: "IRS: Schedule SE instructions and $400 earnings threshold",
    url: "https://www.irs.gov/instructions/i1040sse",
  },
  socialSecurityCap: {
    title: "SSA: 2026 Social Security taxable maximum",
    url: "https://www.ssa.gov/oact/COLA/cbb.html",
  },
  additionalMedicare: {
    title: "IRS: Additional Medicare Tax rates and thresholds",
    url: "https://www.irs.gov/taxtopics/tc560",
  },
  texas: {
    title: "Texas Constitution, Article VIII, Section 24-a: no individual income tax",
    url: "https://tcss.legis.texas.gov/resources/CN/htm/CN.8.htm",
  },
} as const;

const moneyInput = z.number().finite().min(0).max(100_000_000);

export const taxEstimateInputSchema = z.object({
  /** Entire calendar-year net business profit or gross wages, not bank deposits. */
  annualIncome: moneyInput,
  filingStatus: z.enum(["single", "married-jointly"]),
  incomeType: z.enum(["self-employed", "wages"]),
  /** Federal income-tax withholding; do not include Social Security/Medicare withholding. */
  federalWithholding: moneyInput,
  /** Federal estimated-tax payments already made for this same tax year. */
  estimatedPayments: moneyInput,
}).strict();

export type TaxEstimateInput = z.infer<typeof taxEstimateInputSchema>;
export type TaxScenario = TaxEstimateInput;
export const taxEstimateSettingsSchema = taxEstimateInputSchema.nullable();
export type TaxEstimateSettings = z.infer<typeof taxEstimateSettingsSchema>;
/** No tax profile is inferred from bank activity or the account owner's name. */
export const TAX_ESTIMATE_DEFAULTS: TaxEstimateSettings = null;

type FilingStatus = TaxEstimateInput["filingStatus"];
type Bracket = { lowerBound: number; upperBound: number | null; rate: number };
export type TaxBracketEstimate = Bracket & { taxableAmount: number; tax: number; sourceUrl: string };

/** IRS tax-year 2026 rate schedules; upperBound=null is the uncapped 37% band. */
export const INCOME_TAX_BRACKETS_2026: Record<FilingStatus, readonly Bracket[]> = {
  single: [
    { lowerBound: 0, upperBound: 12_400, rate: 0.10 },
    { lowerBound: 12_400, upperBound: 50_400, rate: 0.12 },
    { lowerBound: 50_400, upperBound: 105_700, rate: 0.22 },
    { lowerBound: 105_700, upperBound: 201_775, rate: 0.24 },
    { lowerBound: 201_775, upperBound: 256_225, rate: 0.32 },
    { lowerBound: 256_225, upperBound: 640_600, rate: 0.35 },
    { lowerBound: 640_600, upperBound: null, rate: 0.37 },
  ],
  "married-jointly": [
    { lowerBound: 0, upperBound: 24_800, rate: 0.10 },
    { lowerBound: 24_800, upperBound: 100_800, rate: 0.12 },
    { lowerBound: 100_800, upperBound: 211_400, rate: 0.22 },
    { lowerBound: 211_400, upperBound: 403_550, rate: 0.24 },
    { lowerBound: 403_550, upperBound: 512_450, rate: 0.32 },
    { lowerBound: 512_450, upperBound: 768_700, rate: 0.35 },
    { lowerBound: 768_700, upperBound: null, rate: 0.37 },
  ],
};

export const TAX_RULES_2026 = {
  standardDeduction: { single: 16_100, "married-jointly": 32_200 },
  selfEmploymentEarningsFactor: 0.9235,
  minimumSelfEmploymentEarnings: 400,
  socialSecurityRate: 0.124,
  socialSecurityWageBase: 184_500,
  medicareRate: 0.029,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: { single: 200_000, "married-jointly": 250_000 },
  texasIndividualIncomeTaxRate: 0,
} as const;

export type TaxEstimate = {
  year: typeof TAX_YEAR;
  state: "Texas";
  stateIncomeTax: 0;
  filingStatus: FilingStatus;
  incomeType: TaxEstimateInput["incomeType"];
  grossIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  federalIncomeTax: number;
  selfEmploymentEarnings: number;
  socialSecurityTax: number;
  medicareTax: number;
  /** Base Social Security + Medicare SE tax only; excludes Additional Medicare Tax. */
  selfEmploymentTax: number;
  selfEmploymentDeduction: number;
  additionalMedicareTax: number;
  /** Income tax plus modeled SE taxes, before any payments. */
  modeledLiability: number;
  federalWithholding: number;
  estimatedPayments: number;
  payments: number;
  outstanding: number;
  /** Payments exceeding this limited model, not a promised IRS refund. */
  overpaid: number;
  /** Decimal rates using the entered annual income as the denominator. */
  effectiveIncomeTaxRate: number;
  effectiveTotalTaxRate: number;
  /** Highest rate applied to a positive portion of taxable income; zero if none. */
  marginalIncomeTaxRate: number;
  brackets: TaxBracketEstimate[];
  limitations: string[];
  sources: { title: string; url: string }[];
};

function dollars(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Pure, deterministic estimate. All returned dollar values are rounded to cents.
 * Earnings thresholds are tested before rounding; tax components retain precision
 * until their totals are calculated. Independently rounded subcomponents can differ
 * from a displayed total by a cent. This uses rate schedules, not IRS tax tables.
 */
export function estimateFederalTax(value: TaxEstimateInput): TaxEstimate {
  const input = taxEstimateInputSchema.parse(value);
  const selfEmployed = input.incomeType === "self-employed";
  const selfEmploymentEarnings = selfEmployed ? input.annualIncome * TAX_RULES_2026.selfEmploymentEarningsFactor : 0;
  const owesSelfEmploymentTax = selfEmployed && selfEmploymentEarnings >= TAX_RULES_2026.minimumSelfEmploymentEarnings;
  const socialSecurityTax = owesSelfEmploymentTax
    ? Math.min(selfEmploymentEarnings, TAX_RULES_2026.socialSecurityWageBase) * TAX_RULES_2026.socialSecurityRate
    : 0;
  const medicareTax = owesSelfEmploymentTax ? selfEmploymentEarnings * TAX_RULES_2026.medicareRate : 0;
  const selfEmploymentTax = dollars(socialSecurityTax + medicareTax);
  const additionalMedicareTax = owesSelfEmploymentTax
    ? dollars(Math.max(0, selfEmploymentEarnings - TAX_RULES_2026.additionalMedicareThreshold[input.filingStatus]) * TAX_RULES_2026.additionalMedicareRate)
    : 0;
  // The deductible employer-equivalent half excludes Additional Medicare Tax.
  const selfEmploymentDeduction = dollars(selfEmploymentTax / 2);
  const adjustedGrossIncome = dollars(Math.max(0, input.annualIncome - selfEmploymentDeduction));
  const standardDeduction = TAX_RULES_2026.standardDeduction[input.filingStatus];
  const taxableIncome = dollars(Math.max(0, adjustedGrossIncome - standardDeduction));
  const brackets = INCOME_TAX_BRACKETS_2026[input.filingStatus].map((bracket): TaxBracketEstimate => {
    const taxableAmount = dollars(Math.max(0, Math.min(taxableIncome, bracket.upperBound ?? taxableIncome) - bracket.lowerBound));
    return { ...bracket, taxableAmount, tax: dollars(taxableAmount * bracket.rate), sourceUrl: TAX_ESTIMATE_SOURCES.brackets.url };
  });
  const federalIncomeTax = dollars(brackets.reduce((total, bracket) => total + bracket.tax, 0));
  const modeledLiability = dollars(federalIncomeTax + selfEmploymentTax + additionalMedicareTax);
  const payments = dollars(input.federalWithholding + input.estimatedPayments);
  const limitations = [
    "Rough 2026 annual estimate using ordinary-income rate schedules; not a filed return, quarterly installment calculation, or underpayment-penalty calculation.",
    "Assumes a full-year Texas resident, eligible for the basic standard deduction, under age 65, not blind, and not claimable as someone else's dependent.",
    "Excludes QBI, itemized deductions, credits, retirement and health-insurance deductions, special deductions, capital gains, investment income, NIIT, and AMT. Actual tax can differ materially.",
    "Texas individual income tax is zero. Business franchise taxes, sales taxes, property taxes, and taxes owed to other states are outside this model.",
    "Withholding and estimated payments reduce the modeled balance due, not the liability. Include payments for 2026 only; do not count money merely set aside in a tax-reserve account.",
    selfEmployed
      ? "Self-employed mode treats the entered amount as one sole proprietor's annual net profit after business expenses, with no W-2 wages or other income. It includes base self-employment tax and applicable Additional Medicare Tax."
      : "Wages mode estimates federal income tax only from the entered gross annual wages. It does not add employee Social Security, Medicare, or Additional Medicare Tax to the bill; use federal income-tax withholding only, not payroll/FICA deductions.",
  ];
  if (selfEmployed && input.filingStatus === "married-jointly") {
    limitations.push("Married-jointly self-employed mode assumes one earner and no spouse income. The Social Security cap is applied once; two earners or mixed wages and business income need separate calculations.");
  } else if (input.filingStatus === "married-jointly") {
    limitations.push("For a joint wages scenario, enter combined annual wages and federal income-tax withholding for both spouses. Other household income is not modeled.");
  }

  return {
    year: TAX_YEAR,
    state: "Texas",
    stateIncomeTax: 0,
    filingStatus: input.filingStatus,
    incomeType: input.incomeType,
    grossIncome: dollars(input.annualIncome),
    adjustedGrossIncome,
    standardDeduction,
    taxableIncome,
    federalIncomeTax,
    selfEmploymentEarnings: dollars(selfEmploymentEarnings),
    socialSecurityTax: dollars(socialSecurityTax),
    medicareTax: dollars(medicareTax),
    selfEmploymentTax,
    selfEmploymentDeduction,
    additionalMedicareTax,
    modeledLiability,
    federalWithholding: dollars(input.federalWithholding),
    estimatedPayments: dollars(input.estimatedPayments),
    payments,
    outstanding: dollars(Math.max(0, modeledLiability - payments)),
    overpaid: dollars(Math.max(0, payments - modeledLiability)),
    effectiveIncomeTaxRate: input.annualIncome > 0 ? federalIncomeTax / input.annualIncome : 0,
    effectiveTotalTaxRate: input.annualIncome > 0 ? modeledLiability / input.annualIncome : 0,
    marginalIncomeTaxRate: brackets.findLast((bracket) => bracket.taxableAmount > 0)?.rate ?? 0,
    brackets,
    limitations,
    sources: Object.values(TAX_ESTIMATE_SOURCES),
  };
}
