import { createAnthropic } from "@ai-sdk/anthropic";
import { InferAgentUIMessage, ToolLoopAgent, isStepCount } from "ai";
import type { getDashboardData } from "@/lib/dashboard";
import { execute, queryRows } from "@/lib/db";
import { getDashboardData as loadDashboardData } from "@/lib/dashboard";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

const anthropic = createAnthropic({ apiKey: process.env.CLAUDE_API_KEY });

function financialContext(data: DashboardData) {
  return JSON.stringify({
    asOf: new Date().toISOString(),
    month: {
      income: data.monthIncome,
      postedSpending: data.monthSpend,
      pendingSpending: data.monthPendingSpend,
      invested: data.monthInvested,
      movedToSavings: data.monthSaved,
      taxesPaid: data.monthTaxes,
      cardPayments: data.monthCreditPayments,
      refunds: data.monthRefunds,
      spendRatePercent: data.spendRate,
      unallocatedIncome: data.monthUnallocated,
    },
    cash: {
      total: data.totalCash,
      recentTrend: data.cashTrendData.slice(-60),
    },
    spendingGuardrail: data.spendingGuide,
    connectedSources: data.items.map((item) => ({
      institution: item.institutionName,
      status: item.status,
      lastUpdated: item.updatedAt,
    })),
    accounts: data.accounts.map((account) => ({
      institution: account.institutionName,
      name: account.name,
      type: account.type,
      subtype: account.subtype,
      lastFour: account.mask,
      postedBalance: account.currentBalance,
      availableBalance: account.availableBalance,
      pendingOutflow: account.pendingOutflow,
      estimatedBalance: account.estimatedBalance,
      creditLimit: account.creditLimit,
      minimumPayment: account.minimumPayment,
      nextPaymentDueDate: account.nextPaymentDueDate,
    })),
    investments: {
      totalValue: data.portfolio.totalValue,
      totalCostBasis: data.portfolio.totalCostBasis,
      totalGain: data.portfolio.totalGain,
      byInstitution: data.portfolio.byInstitution,
      holdings: data.portfolio.holdings.map((holding) => ({
        institution: holding.institutionName,
        account: holding.accountName,
        name: holding.name,
        ticker: holding.ticker,
        type: holding.type,
        subtype: holding.subtype,
        quantity: holding.quantity,
        price: holding.price,
        value: holding.value,
        costBasis: holding.costBasis,
      })),
    },
    monthlyHistory: data.monthlyData,
    currentAllocation: data.allocationData,
    spendingCategories: data.categoryData,
    recentTransactions: data.transactions.slice(0, 150).map((transaction) => ({
      date: transaction.date,
      merchant: transaction.name,
      originalDescription: transaction.rawName,
      amount: transaction.amount,
      pending: transaction.pending,
      flow: transaction.flowLabel,
      flowType: transaction.flowType,
      category: transaction.category,
      categorySource: transaction.categorySource,
      institution: transaction.institutionName,
      account: transaction.accountName,
      accountType: transaction.accountType,
    })),
  });
}

export function createFinanceAgent(data: DashboardData) {
  return new ToolLoopAgent({
    model: anthropic("claude-opus-4-6"),
    stopWhen: isStepCount(4),
    instructions: `You are the private finance copilot inside Mantini Money for the person using this dashboard.

Be concise, candid, numerate, and nonjudgmental. Help them enjoy their money while staying in control. Always distinguish true consumption spending from investing, saving, taxes, card payments, refunds, and internal transfers. Transaction amounts follow Plaid's convention: positive is money out and negative is money in; use the supplied flow type when interpreting them. Use the supplied numbers instead of guessing. Call out unusual changes, concentration, pending-card exposure, cash allocation, and opportunities to create guardrails. Do not moralize. Do not recommend a specific security or make promises about tax, legal, or investment outcomes. When those topics arise, state the uncertainty plainly. Never claim to move money or alter an account.

Default to a compact answer: one direct conclusion followed by up to three useful bullets. Avoid generic filler, repeated disclaimers, or explaining what the app is.

Current private financial context:
${financialContext(data)}`,
  });
}

export type FinanceAgentUIMessage = InferAgentUIMessage<
  ReturnType<typeof createFinanceAgent>
>;

function chicagoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function generateDailyBrief(force = false) {
  const date = chicagoDate();
  if (!force) {
    const [cached] = await queryRows<{ content: string; updated_at: string }>(
      "SELECT content, updated_at FROM advisor_insights WHERE insight_date = ?",
      [date],
    );
    if (cached) return { content: cached.content, updatedAt: cached.updated_at, cached: true };
  }

  const agent = createFinanceAgent(await loadDashboardData());
  const result = await agent.generate({
    prompt:
      "Create today's proactive money briefing. Identify the single most useful observation, explain why it matters using exact numbers, and give one practical next action. Keep it under 90 words.",
    timeout: { totalMs: 55_000 },
  });
  await execute(
    `INSERT INTO advisor_insights (insight_date, content)
     VALUES (?, ?)
     ON CONFLICT(insight_date) DO UPDATE SET
       content = excluded.content,
       updated_at = CURRENT_TIMESTAMP`,
    [date, result.text],
  );
  return { content: result.text, updatedAt: new Date().toISOString(), cached: false };
}
