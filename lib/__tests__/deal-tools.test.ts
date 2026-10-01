import { describe, it, expect } from "vitest";
import {
  evaluateDiscountAuthority,
  calculateDealTerms,
  calculateDeal,
  checkDiscountAuthority,
  type DiscountAuthorityResult,
  type DealCalculationResult,
} from "@/app/api/chat/tools/deal-tools";

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
  it("correctly calculates deal terms for 500 licenses @ ₹1,000 with 25% discount", () => {
    const result = calculateDealTerms(500, 1000, 25);
    expect(result.success).toBe(true);
    expect(result.quantity).toBe(500);
    expect(result.unitPrice).toBe(1000);
    expect(result.requestedDiscountPercent).toBe(25);
    expect(result.listValue).toBe(500000);
    expect(result.discountAmount).toBe(125000);
    expect(result.dealValue).toBe(375000);
    expect(result.formatted?.listValue).toContain("5,00,000");
    expect(result.formatted?.discountAmount).toContain("1,25,000");
    expect(result.formatted?.dealValue).toContain("3,75,000");
  });

  it("handles 0% discount correctly", () => {
    const result = calculateDealTerms(10, 200, 0);
    expect(result.success).toBe(true);
    expect(result.listValue).toBe(2000);
    expect(result.discountAmount).toBe(0);
    expect(result.dealValue).toBe(2000);
  });

  it("handles 100% discount correctly", () => {
    const result = calculateDealTerms(10, 200, 100);
    expect(result.success).toBe(true);
    expect(result.listValue).toBe(2000);
    expect(result.discountAmount).toBe(2000);
    expect(result.dealValue).toBe(0);
  });

  describe("Invalid Calculation Inputs (Fail Safely)", () => {
    it("fails safely for zero or negative quantity", () => {
      expect(calculateDealTerms(0, 100, 10).success).toBe(false);
      expect(calculateDealTerms(-5, 100, 10).success).toBe(false);
    });

    it("fails safely for zero or negative unit price", () => {
      expect(calculateDealTerms(10, 0, 10).success).toBe(false);
      expect(calculateDealTerms(10, -50, 10).success).toBe(false);
    });

    it("fails safely for invalid discount percentage", () => {
      expect(calculateDealTerms(10, 100, -5).success).toBe(false);
      expect(calculateDealTerms(10, 100, 105).success).toBe(false);
    });

    it("fails safely for NaN or non-finite inputs", () => {
      expect(calculateDealTerms(Number.NaN, 100, 10).success).toBe(false);
      expect(calculateDealTerms(10, Number.POSITIVE_INFINITY, 10).success).toBe(false);
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
      { quantity: 500, unitPrice: 1000, requestedDiscountPercent: 25 },
      { toolCallId: "call_2", messages: [] }
    )) as unknown as DealCalculationResult;
    expect(result.success).toBe(true);
    expect(result.dealValue).toBe(375000);
  });
});
