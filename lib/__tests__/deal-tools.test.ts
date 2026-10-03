import { describe, it, expect } from "vitest";
import {
  evaluateDiscountAuthority,
  formatINR,
  calculateDealTerms,
  calculateDeal,
  checkDiscountAuthority,
  type DiscountAuthorityResult,
  type DealCalculationResult,
} from "@/app/api/chat/tools/deal-tools";
import { UNIT_PRICE } from "@/lib/pricing";
import {
  getAuthorityBand,
  isApprovalRequired,
  isProposalReleasable,
  getProposalOutcome,
  ProposalState,
} from "@/lib/governance";

describe("Deterministic Discount Authority Decision Rights", () => {
  describe("Exact Boundary Conditions", () => {
    it("evaluates 0% discount as AUTO_APPROVED (AI Delegated Authority)", () => {
      const result = evaluateDiscountAuthority(0);
      expect(result.success).toBe(true);
      expect(result.status).toBe("AUTO_APPROVED");
      expect(result.authorityLevel).toBe("AI Delegated Authority");
      expect(result.withinDelegatedAuthority).toBe(true);
    });

    it("evaluates 10% discount as AUTO_APPROVED (boundary)", () => {
      const result = evaluateDiscountAuthority(10);
      expect(result.success).toBe(true);
      expect(result.status).toBe("AUTO_APPROVED");
      expect(result.authorityLevel).toBe("AI Delegated Authority");
      expect(result.withinDelegatedAuthority).toBe(true);
    });

    it("evaluates 10.01% discount as SALES_MANAGER_APPROVAL_REQUIRED (boundary transition)", () => {
      const result = evaluateDiscountAuthority(10.01);
      expect(result.success).toBe(true);
      expect(result.status).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
      expect(result.authorityLevel).toBe("Sales Manager");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("evaluates 20% discount as SALES_MANAGER_APPROVAL_REQUIRED (boundary)", () => {
      const result = evaluateDiscountAuthority(20);
      expect(result.success).toBe(true);
      expect(result.status).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
      expect(result.authorityLevel).toBe("Sales Manager");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("evaluates 20.01% discount as FINANCE_APPROVAL_REQUIRED (boundary transition)", () => {
      const result = evaluateDiscountAuthority(20.01);
      expect(result.success).toBe(true);
      expect(result.status).toBe("FINANCE_APPROVAL_REQUIRED");
      expect(result.authorityLevel).toBe("Finance");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("evaluates 30% discount as FINANCE_APPROVAL_REQUIRED (boundary)", () => {
      const result = evaluateDiscountAuthority(30);
      expect(result.success).toBe(true);
      expect(result.status).toBe("FINANCE_APPROVAL_REQUIRED");
      expect(result.authorityLevel).toBe("Finance");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("evaluates 30.01% discount as BLOCKED (boundary transition)", () => {
      const result = evaluateDiscountAuthority(30.01);
      expect(result.success).toBe(true);
      expect(result.status).toBe("BLOCKED");
      expect(result.authorityLevel).toBe("None (Policy Exceeded)");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("evaluates 100% discount as BLOCKED", () => {
      const result = evaluateDiscountAuthority(100);
      expect(result.success).toBe(true);
      expect(result.status).toBe("BLOCKED");
      expect(result.authorityLevel).toBe("None (Policy Exceeded)");
      expect(result.withinDelegatedAuthority).toBe(false);
    });
  });

  describe("Invalid Discount Inputs (Fail Safely)", () => {
    it("fails safely for negative discount (-1%)", () => {
      const result = evaluateDiscountAuthority(-1);
      expect(result.success).toBe(false);
      expect(result.status).toBe("INVALID_INPUT");
      expect(result.withinDelegatedAuthority).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("fails safely for negative discount (-0.01%)", () => {
      const result = evaluateDiscountAuthority(-0.01);
      expect(result.success).toBe(false);
      expect(result.status).toBe("INVALID_INPUT");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("fails safely for discount above 100% (100.01%)", () => {
      const result = evaluateDiscountAuthority(100.01);
      expect(result.success).toBe(false);
      expect(result.status).toBe("INVALID_INPUT");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("fails safely for extreme discount above 100% (150%)", () => {
      const result = evaluateDiscountAuthority(150);
      expect(result.success).toBe(false);
      expect(result.status).toBe("INVALID_INPUT");
      expect(result.withinDelegatedAuthority).toBe(false);
    });

    it("fails safely for NaN, Infinity, and non-numeric values", () => {
      expect(evaluateDiscountAuthority(Number.NaN).success).toBe(false);
      expect(evaluateDiscountAuthority(Number.POSITIVE_INFINITY).success).toBe(false);
      expect(evaluateDiscountAuthority(Number.NEGATIVE_INFINITY).success).toBe(false);
      // @ts-expect-error Testing runtime JS input
      expect(evaluateDiscountAuthority("twenty").success).toBe(false);
    });
  });
});

describe("Deterministic Deal Calculations", () => {
  it("calculates all commercial values using the fixed ₹2,500 unit price", () => {
    const result = calculateDealTerms(500, 25);
    expect(result.success).toBe(true);
    expect(result.quantity).toBe(500);
    expect(result.unitPrice).toBe(UNIT_PRICE);
    expect(result.requestedDiscountPercent).toBe(25);
    expect(result.listValue).toBe(1250000);
    expect(result.discountAmount).toBe(312500);
    expect(result.dealValue).toBe(937500);
    expect(result.formatted?.unitPrice).toContain("2,500");
    expect(result.formatted?.listValue).toContain("12,50,000");
    expect(result.formatted?.discountAmount).toContain("3,12,500");
    expect(result.formatted?.dealValue).toContain("9,37,500");
  });

  it("matches the JSW recommendation example using the fixed price", () => {
    const result = calculateDealTerms(500, 12);
    expect(result).toMatchObject({
      success: true,
      unitPrice: UNIT_PRICE,
      listValue: 1250000,
      discountAmount: 150000,
      dealValue: 1100000,
    });

    expect(result.formatted).toMatchObject({
      listValue: expect.stringContaining("12,50,000"),
      discountAmount: expect.stringContaining("1,50,000"),
      dealValue: expect.stringContaining("11,00,000"),
    });
  });

  it("formats whole unit prices without decimal noise using Indian grouping", () => {
    expect(formatINR(UNIT_PRICE)).toBe("₹2,500");
  });

  it("handles 0% discount correctly", () => {
    const result = calculateDealTerms(10, 0);
    expect(result.success).toBe(true);
    expect(result.listValue).toBe(25000);
    expect(result.discountAmount).toBe(0);
    expect(result.dealValue).toBe(25000);
  });

  it("handles 100% discount correctly", () => {
    const result = calculateDealTerms(10, 100);
    expect(result.success).toBe(true);
    expect(result.listValue).toBe(25000);
    expect(result.discountAmount).toBe(25000);
    expect(result.dealValue).toBe(0);
  });

  describe("Invalid Calculation Inputs (Fail Safely)", () => {
    it("fails safely for zero or negative quantity", () => {
      expect(calculateDealTerms(0, 10).success).toBe(false);
      expect(calculateDealTerms(-5, 10).success).toBe(false);
    });

    it("fails safely for invalid discount percentage", () => {
      expect(calculateDealTerms(10, -5).success).toBe(false);
      expect(calculateDealTerms(10, 105).success).toBe(false);
    });

    it("fails safely for NaN or non-finite inputs", () => {
      expect(calculateDealTerms(Number.NaN, 10).success).toBe(false);
      expect(calculateDealTerms(10, Number.POSITIVE_INFINITY).success).toBe(false);
    });
  });
});

describe("AI SDK Tool Execution", () => {
  it("executes checkDiscountAuthority tool correctly", async () => {
    if (!checkDiscountAuthority.execute) throw new Error("execute not defined");
    const result = (await checkDiscountAuthority.execute(
      { requestedDiscountPercent: 25 },
      { toolCallId: "call_1", messages: [] }
    )) as unknown as DiscountAuthorityResult;
    expect(result.status).toBe("FINANCE_APPROVAL_REQUIRED");
    expect(result.authorityLevel).toBe("Finance");
  });

  it("executes calculateDeal tool correctly", async () => {
    if (!calculateDeal.execute) throw new Error("execute not defined");
    const result = (await calculateDeal.execute(
      { quantity: 500, requestedDiscountPercent: 25 },
      { toolCallId: "call_2", messages: [] }
    )) as unknown as DealCalculationResult;
    expect(result.success).toBe(true);
    expect(result.unitPrice).toBe(UNIT_PRICE);
    expect(result.dealValue).toBe(937500);
  });
});

describe("Shared DealGuard governance helper", () => {
  it("maps each boundary to the correct authority band", () => {
    expect(getAuthorityBand(7).status).toBe("AUTO_APPROVED");
    expect(getAuthorityBand(10).status).toBe("AUTO_APPROVED");
    expect(getAuthorityBand(17).status).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
    expect(getAuthorityBand(20).status).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
    expect(getAuthorityBand(25).status).toBe("FINANCE_APPROVAL_REQUIRED");
    expect(getAuthorityBand(30).status).toBe("FINANCE_APPROVAL_REQUIRED");
    expect(getAuthorityBand(35).status).toBe("BLOCKED");
  });

  it("tracks approval and releasability transitions deterministically", () => {
    expect(isApprovalRequired("AUTO_APPROVED")).toBe(false);
    expect(isApprovalRequired("SALES_MANAGER_APPROVAL_REQUIRED")).toBe(true);
    expect(isApprovalRequired("FINANCE_APPROVAL_REQUIRED")).toBe(true);
    expect(isApprovalRequired("BLOCKED")).toBe(false);

    expect(isProposalReleasable("AUTO_APPROVED")).toBe(true);
    expect(isProposalReleasable("SALES_MANAGER_APPROVAL_REQUIRED")).toBe(false);
    expect(isProposalReleasable("FINANCE_APPROVAL_REQUIRED")).toBe(false);
    expect(isProposalReleasable("BLOCKED")).toBe(false);

    expect(getProposalOutcome("AUTO_APPROVED")).toBe(ProposalState.AUTHORIZED);
    expect(getProposalOutcome("SALES_MANAGER_APPROVAL_REQUIRED")).toBe(ProposalState.HELD);
    expect(getProposalOutcome("FINANCE_APPROVAL_REQUIRED")).toBe(ProposalState.HELD);
    expect(getProposalOutcome("BLOCKED")).toBe(ProposalState.BLOCKED);
  });
});
