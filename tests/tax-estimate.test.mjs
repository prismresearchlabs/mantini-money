import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateFederalTax, taxEstimateInputSchema, taxEstimateSettingsSchema,
  TAX_ESTIMATE_DEFAULTS, INCOME_TAX_BRACKETS_2026, TAX_ESTIMATE_SOURCES,
} from "../src/lib/tax-estimate.ts";

function scenario(overrides = {}) {
  return { annualIncome: 100_000, filingStatus: "single", incomeType: "wages", federalWithholding: 0, estimatedPayments: 0, ...overrides };
}

function close(actual, expected, tolerance = 0.011) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be approximately ${expected}`);
}

test("setup stays unset and validation requires explicit complete, supported choices", () => {
  assert.equal(TAX_ESTIMATE_DEFAULTS, null);
  assert.equal(taxEstimateSettingsSchema.parse(null), null);
  assert.equal(taxEstimateInputSchema.safeParse(null).success, false);
  assert.equal(taxEstimateInputSchema.safeParse({}).success, false);
  assert.equal(taxEstimateInputSchema.safeParse(scenario()).success, true);
  for (const change of [
    { filingStatus: "head-of-household" }, { filingStatus: null }, { incomeType: "mixed" },
    { annualIncome: "100000" }, { annualIncome: -1 }, { annualIncome: Number.NaN },
    { annualIncome: Number.POSITIVE_INFINITY }, { annualIncome: 100_000_001 },
    { federalWithholding: -1 }, { estimatedPayments: -1 }, { state: "California" }, { year: 2025 },
  ]) {
    assert.equal(taxEstimateInputSchema.safeParse(scenario(change)).success, false, JSON.stringify(change));
    assert.throws(() => estimateFederalTax(scenario(change)));
  }
});

test("zero income and income below the standard deduction have finite zero income-tax rates", () => {
  for (const incomeType of ["wages", "self-employed"]) {
    const result = estimateFederalTax(scenario({ annualIncome: 0, incomeType }));
    assert.equal(result.modeledLiability, 0);
    assert.equal(result.taxableIncome, 0);
    assert.equal(result.effectiveIncomeTaxRate, 0);
    assert.equal(result.effectiveTotalTaxRate, 0);
    assert.equal(result.marginalIncomeTaxRate, 0);
    assert.equal(result.brackets.length, 7);
    assert.ok(result.brackets.every((row) => row.tax === 0 && row.taxableAmount === 0));
  }
  assert.equal(estimateFederalTax(scenario({ annualIncome: 16_100 })).federalIncomeTax, 0);
  assert.equal(estimateFederalTax(scenario({ annualIncome: 32_200, filingStatus: "married-jointly" })).federalIncomeTax, 0);
});

test("known wage examples use the 2026 single and joint progressive schedules", () => {
  const single = estimateFederalTax(scenario());
  assert.equal(single.standardDeduction, 16_100);
  assert.equal(single.taxableIncome, 83_900);
  assert.equal(single.federalIncomeTax, 13_170);
  assert.equal(single.modeledLiability, 13_170);
  assert.equal(single.marginalIncomeTaxRate, 0.22);
  assert.equal(single.effectiveIncomeTaxRate, 0.1317);
  const joint = estimateFederalTax(scenario({ filingStatus: "married-jointly" }));
  assert.equal(joint.standardDeduction, 32_200);
  assert.equal(joint.taxableIncome, 67_800);
  assert.equal(joint.federalIncomeTax, 7_640);
  assert.equal(joint.marginalIncomeTaxRate, 0.12);
});

test("each bracket boundary taxes only the next dollar at the next rate", () => {
  const knownTaxAtBoundary = {
    single: [1240, 5800, 17966, 41024, 58448, 192979.25],
    "married-jointly": [2480, 11600, 35932, 82048, 116896, 206583.50],
  };
  for (const filingStatus of ["single", "married-jointly"]) {
    const deduction = filingStatus === "single" ? 16_100 : 32_200;
    const schedule = INCOME_TAX_BRACKETS_2026[filingStatus];
    for (let index = 0; index < schedule.length - 1; index++) {
      const boundary = schedule[index].upperBound;
      const at = estimateFederalTax(scenario({ filingStatus, annualIncome: deduction + boundary }));
      const above = estimateFederalTax(scenario({ filingStatus, annualIncome: deduction + boundary + 1 }));
      assert.equal(at.federalIncomeTax, knownTaxAtBoundary[filingStatus][index]);
      assert.equal(at.marginalIncomeTaxRate, schedule[index].rate);
      assert.equal(above.marginalIncomeTaxRate, schedule[index + 1].rate);
      close(above.federalIncomeTax - at.federalIncomeTax, schedule[index + 1].rate);
    }
  }
});

test("SE tax uses 92.35% of net profit and tests the $400 threshold before rounding", () => {
  const below = estimateFederalTax(scenario({ annualIncome: 433.13, incomeType: "self-employed" }));
  const above = estimateFederalTax(scenario({ annualIncome: 433.14, incomeType: "self-employed" }));
  assert.equal(below.selfEmploymentTax, 0);
  assert.equal(below.selfEmploymentDeduction, 0);
  assert.equal(above.selfEmploymentTax, 61.20);
  assert.equal(above.selfEmploymentDeduction, 30.60);
  const small = estimateFederalTax(scenario({ annualIncome: 1_000, incomeType: "self-employed" }));
  assert.equal(small.selfEmploymentEarnings, 923.50);
  assert.equal(small.selfEmploymentTax, 141.30);
  assert.equal(small.federalIncomeTax, 0);
  assert.equal(small.modeledLiability, 141.30);
});

test("a $100K sole-proprietor example deducts half base SE tax before income tax", () => {
  const result = estimateFederalTax(scenario({ incomeType: "self-employed" }));
  assert.equal(result.selfEmploymentEarnings, 92_350);
  assert.equal(result.selfEmploymentTax, 14_129.55);
  assert.equal(result.selfEmploymentDeduction, 7_064.78);
  assert.equal(result.adjustedGrossIncome, 92_935.22);
  assert.equal(result.taxableIncome, 76_835.22);
  assert.equal(result.federalIncomeTax, 11_615.75);
  assert.equal(result.modeledLiability, 25_745.30);
  close(result.effectiveTotalTaxRate, 0.257453, 0.0000001);
});

test("the Social Security cap is applied to SE earnings once, including joint one-earner scenarios", () => {
  for (const filingStatus of ["single", "married-jointly"]) {
    const result = estimateFederalTax(scenario({ annualIncome: 300_000, filingStatus, incomeType: "self-employed" }));
    assert.equal(result.selfEmploymentEarnings, 277_050);
    assert.equal(result.socialSecurityTax, 22_878);
    assert.equal(result.medicareTax, 8_034.45);
    assert.equal(result.selfEmploymentTax, 30_912.45);
  }
  const low = estimateFederalTax(scenario({ annualIncome: 199_000, incomeType: "self-employed" }));
  const high = estimateFederalTax(scenario({ annualIncome: 200_000, incomeType: "self-employed" }));
  assert.ok(low.socialSecurityTax < 22_878);
  assert.equal(high.socialSecurityTax, 22_878);
});

test("Additional Medicare thresholds use SE earnings and are excluded from the half-SE deduction", () => {
  const single = estimateFederalTax(scenario({ annualIncome: 300_000, incomeType: "self-employed" }));
  const joint = estimateFederalTax(scenario({ annualIncome: 300_000, incomeType: "self-employed", filingStatus: "married-jointly" }));
  assert.equal(single.additionalMedicareTax, 693.45);
  assert.equal(joint.additionalMedicareTax, 243.45);
  assert.equal(single.selfEmploymentDeduction, joint.selfEmploymentDeduction);
  assert.equal(single.selfEmploymentDeduction, 15_456.23);
  const under = estimateFederalTax(scenario({ annualIncome: 216_500, incomeType: "self-employed" }));
  assert.equal(under.additionalMedicareTax, 0);
  assert.equal(single.modeledLiability, Math.round((single.federalIncomeTax + single.selfEmploymentTax + single.additionalMedicareTax) * 100) / 100);
});

test("wages do not invent an additional payroll-tax bill even at high income", () => {
  const result = estimateFederalTax(scenario({ annualIncome: 500_000, federalWithholding: 30_000 }));
  assert.equal(result.selfEmploymentTax, 0);
  assert.equal(result.additionalMedicareTax, 0);
  assert.equal(result.socialSecurityTax, 0);
  assert.equal(result.medicareTax, 0);
  assert.equal(result.selfEmploymentDeduction, 0);
  assert.equal(result.modeledLiability, result.federalIncomeTax);
  assert.ok(result.limitations.some((text) => text.includes("federal income tax only")));
});

test("withholding and paid estimates reduce outstanding liability exactly once", () => {
  const result = estimateFederalTax(scenario({ federalWithholding: 8_000, estimatedPayments: 2_000 }));
  assert.equal(result.modeledLiability, 13_170);
  assert.equal(result.payments, 10_000);
  assert.equal(result.outstanding, 3_170);
  assert.equal(result.overpaid, 0);
  const overpaid = estimateFederalTax(scenario({ federalWithholding: 20_000, estimatedPayments: 1_000 }));
  assert.equal(overpaid.outstanding, 0);
  assert.equal(overpaid.overpaid, 7_830);
  assert.equal(overpaid.effectiveTotalTaxRate, result.effectiveTotalTaxRate);
});

test("bracket totals reconcile and results remain serializable at large valid inputs", () => {
  const result = estimateFederalTax(scenario({ annualIncome: 100_000_000, incomeType: "self-employed" }));
  close(result.brackets.reduce((sum, row) => sum + row.tax, 0), result.federalIncomeTax);
  close(result.brackets.reduce((sum, row) => sum + row.taxableAmount, 0), result.taxableIncome);
  assert.equal(result.marginalIncomeTaxRate, 0.37);
  const copy = JSON.parse(JSON.stringify(result));
  assert.deepEqual(copy, result);
  assert.equal(result.brackets.at(-1).upperBound, null);
  assert.ok(Object.values(result).filter((value) => typeof value === "number").every(Number.isFinite));
});

test("Texas, source links, and the model's one-earner limitations are explicit", () => {
  const result = estimateFederalTax(scenario({ incomeType: "self-employed", filingStatus: "married-jointly" }));
  assert.equal(result.state, "Texas");
  assert.equal(result.stateIncomeTax, 0);
  assert.equal(result.year, 2026);
  assert.ok(result.limitations.some((text) => text.includes("one earner")));
  assert.ok(result.limitations.some((text) => text.includes("QBI")));
  assert.ok(result.limitations.some((text) => text.includes("tax-reserve account")));
  assert.equal(result.sources.length, Object.keys(TAX_ESTIMATE_SOURCES).length);
  assert.ok(result.sources.every((source) => /^https:\/\/(www\.irs\.gov|www\.ssa\.gov|tcss\.legis\.texas\.gov)\//.test(source.url)));
});
