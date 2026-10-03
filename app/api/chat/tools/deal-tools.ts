import { tool } from "ai";
import { z } from "zod";
import { UNIT_PRICE } from "@/lib/pricing";

export type DiscountAuthorityStatus =
  | "AUTO_APPROVED"
  | "SALES_MANAGER_APPROVAL_REQUIRED"
  | "FINANCE_APPROVAL_REQUIRED"
  | "BLOCKED"
  | "INVALID_INPUT";

export interface DiscountAuthorityResult {
  success: boolean;
  requestedDiscountPercent?: number;
  status: DiscountAuthorityStatus;
  authorityLevel: string;
  reason: string;
  withinDelegatedAuthority: boolean;
  error?: string;
}

export interface DealCalculationResult {
  success: boolean;
  quantity?: number;
  unitPrice?: number;
  requestedDiscountPercent?: number;
  listValue?: number;
  discountAmount?: number;
  dealValue?: number;
  formatted?: {
    unitPrice: string;
    listValue: string;
    discountAmount: string;
    dealValue: string;
  };
  error?: string;
}

/**
 * Deterministically formats a numeric value as INR currency.
 */
export function formatINR(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(val);
}

/**
 * Deterministic discount authority evaluation logic.
 * Enforces corporate decision rights:
 * - <= 10%: AUTO_APPROVED (AI Delegated Authority)
 * - > 10% and <= 20%: SALES_MANAGER_APPROVAL_REQUIRED (Sales Manager)
 * - > 20% and <= 30%: FINANCE_APPROVAL_REQUIRED (Finance)
 * - > 30%: BLOCKED (Exceeds Policy Limits)
 */
export function evaluateDiscountAuthority(
  requestedDiscountPercent: number
): DiscountAuthorityResult {
  if (
    typeof requestedDiscountPercent !== "number" ||
    Number.isNaN(requestedDiscountPercent) ||
    !Number.isFinite(requestedDiscountPercent) ||
    requestedDiscountPercent < 0 ||
    requestedDiscountPercent > 100
  ) {
    return {
      success: false,
      status: "INVALID_INPUT",
      authorityLevel: "None",
      reason: "Discount percentage must be a valid number between 0% and 100%.",
      withinDelegatedAuthority: false,
      error: "Invalid discount percentage: must be between 0% and 100%.",
    };
  }

  if (requestedDiscountPercent <= 10) {
    return {
      success: true,
      requestedDiscountPercent,
      status: "AUTO_APPROVED",
      authorityLevel: "AI Delegated Authority",
      reason:
        "Discounts up to 10% fall within AI delegated authority under the current discount policy.",
      withinDelegatedAuthority: true,
    };
  }

  if (requestedDiscountPercent <= 20) {
    return {
      success: true,
      requestedDiscountPercent,
      status: "SALES_MANAGER_APPROVAL_REQUIRED",
      authorityLevel: "Sales Manager",
      reason:
        "Discounts between 10% and 20% exceed AI authority and require Sales Manager approval.",
      withinDelegatedAuthority: false,
    };
  }

  if (requestedDiscountPercent <= 30) {
    return {
      success: true,
      requestedDiscountPercent,
      status: "FINANCE_APPROVAL_REQUIRED",
      authorityLevel: "Finance",
      reason:
        "Discounts between 20% and 30% exceed Sales Manager authority and require Finance approval.",
      withinDelegatedAuthority: false,
    };
  }

  return {
    success: true,
    requestedDiscountPercent,
    status: "BLOCKED",
    authorityLevel: "None (Policy Exceeded)",
    reason:
      "Discounts greater than 30% are blocked and cannot be approved through normal workflows.",
    withinDelegatedAuthority: false,
  };
}

/**
 * Deterministic deal calculation logic.
 * Calculates list value, discount amount, and net deal value.
 */
export function calculateDealTerms(
  quantity: number,
  requestedDiscountPercent: number
): DealCalculationResult {
  if (
    typeof quantity !== "number" ||
    Number.isNaN(quantity) ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return {
      success: false,
      error: "Quantity must be a valid positive number greater than 0.",
    };
  }

  if (
    typeof requestedDiscountPercent !== "number" ||
    Number.isNaN(requestedDiscountPercent) ||
    !Number.isFinite(requestedDiscountPercent) ||
    requestedDiscountPercent < 0 ||
    requestedDiscountPercent > 100
  ) {
    return {
      success: false,
      error:
        "Requested discount percentage must be a valid number between 0% and 100%.",
    };
  }

  const listValue = quantity * UNIT_PRICE;
  const discountAmount = listValue * (requestedDiscountPercent / 100);
  const dealValue = listValue - discountAmount;

  return {
    success: true,
    quantity,
    unitPrice: UNIT_PRICE,
    requestedDiscountPercent,
    listValue,
    discountAmount,
    dealValue,
    formatted: {
      unitPrice: formatINR(UNIT_PRICE),
      listValue: formatINR(listValue),
      discountAmount: formatINR(discountAmount),
      dealValue: formatINR(dealValue),
    },
  };
}

/**
 * AI SDK Tool: calculateDeal
 * Deterministically calculates list value, discount amount, and final deal value.
 */
export const calculateDeal = tool({
  description:
    `Deterministically calculate the list value, discount amount, and final deal value using the fixed ₹${UNIT_PRICE.toLocaleString("en-IN")} unit price. Always call this tool for monetary deal calculations — never perform mental math.`,
  inputSchema: z.object({
    quantity: z.number().positive().describe("Quantity of items or licenses (must be greater than 0)."),
    requestedDiscountPercent: z
      .number()
      .min(0)
      .max(100)
      .describe("Requested discount percentage between 0 and 100 (e.g., 25 for 25%)."),
  }),
  execute: async ({ quantity, requestedDiscountPercent }) => {
    return calculateDealTerms(quantity, requestedDiscountPercent);
  },
});

/**
 * AI SDK Tool: checkDiscountAuthority
 * Evaluates the requested discount percentage against the corporate decision-rights policy.
 */
export const checkDiscountAuthority = tool({
  description:
    "Deterministically evaluate which authority level is required for a given discount percentage. Always call this tool to determine approval rights — never invent or deduce authority independently.",
  inputSchema: z.object({
    requestedDiscountPercent: z
      .number()
      .min(0)
      .max(100)
      .describe("Requested discount percentage between 0 and 100 (e.g., 25 for 25%)."),
  }),
  execute: async ({ requestedDiscountPercent }) => {
    return evaluateDiscountAuthority(requestedDiscountPercent);
  },
});
