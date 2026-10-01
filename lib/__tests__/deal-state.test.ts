import { describe, it, expect } from "vitest";
import { ProposalState } from "@/lib/governance";
import { extractQuickOptions } from "@/lib/quick-options";
import {
  createBlankDeal,
  createDemoDeals,
  parseCommercialRequest,
  detectDiscountRecommendationIntent,
  applyProposalToDeal,
  processCommercialMessage,
  recommendDiscount,
  setDealWorkflowPhase,
  setDealApproval,
  createDealSummary,
  type Deal,
} from "@/lib/deals";

describe("DealGuard multi-deal workflow", () => {
  it("keeps multiple deals independent", () => {
    const first = createDemoDeals()[0];
    const second = createDemoDeals()[1];
    const updated = applyProposalToDeal(first, { customerName: "Acme Industries", quantity: 300, unitPrice: 2500, proposedDiscount: 12 });

    expect(updated.customerName).toBe("Acme Industries");
    expect(second.customerName).toBe("Reliance Industries");
    expect(updated.governanceStatus).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
    expect(second.governanceStatus).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
  });

  it("creates a blank deal for a new commercial opportunity", () => {
    const deal = createBlankDeal();
    expect(deal.customerName).toBe("—");
    expect(deal.quantity).toBeNull();
    expect(deal.unitPrice).toBeNull();
    expect(deal.proposedDiscount).toBeNull();
  });

  it("returns transparent deterministic discount recommendations by quantity", () => {
    expect(recommendDiscount({ quantity: 300 }).recommendedDiscount).toBe(8);
    expect(recommendDiscount({ quantity: 500 }).recommendedDiscount).toBe(12);
    expect(recommendDiscount({ quantity: 750 }).recommendedDiscount).toBe(12);
    expect(recommendDiscount({ quantity: 1000 }).recommendedDiscount).toBe(15);
    expect(() => recommendDiscount({ quantity: 0 })).toThrow(RangeError);
    expect(() => recommendDiscount({ quantity: -1 })).toThrow(RangeError);
    expect(() => recommendDiscount({ quantity: 500.5 })).toThrow(RangeError);
  });

  it("recognizes varied explicit discount recommendation requests", () => {
    for (const request of [
      "Recommend a discount",
      "What discount can we offer?",
      "Suggest a discount",
      "What discount would you propose?",
      "Give them a suitable discount",
      "Recommend an offer",
    ]) {
      expect(detectDiscountRecommendationIntent(request), request).toBe(true);
    }
    expect(detectDiscountRecommendationIntent("Reliance wants 250 licences at ₹2,000 each")).toBe(false);
  });

  it("parses a natural-language commercial request into a structured deal", () => {
    const parsed = parseCommercialRequest("Mahindra wants 300 licences at ₹2,500 each and is asking for 12% off.");
    expect(parsed.customerName).toBe("Mahindra");
    expect(parsed.quantity).toBe(300);
    expect(parsed.unitPrice).toBe(2500);
    expect(parsed.proposedDiscount).toBe(12);
  });

  it("parses bare unit prices and creates a synchronized JSW governance handoff", () => {
    const parsed = parseCommercialRequest("JSW wants 500 licenses at 100 each for 35% discount");
    expect(parsed).toMatchObject({ customerName: "JSW", quantity: 500, unitPrice: 100, proposedDiscount: 35 });

    const deal = processCommercialMessage(createBlankDeal("deal-jsw"), "JSW wants 500 licenses at 100 each for 35% discount");
    expect(deal.governanceDecision).toMatchObject({ proposalComplete: true, status: "BLOCKED", authorityStatus: "BLOCKED", proposalState: ProposalState.BLOCKED });
    expect(deal.approvalState).toBe("BLOCKED");
    expect(deal.workflowPhase).toBe("sales-agent");
    expect(deal.pendingDealGuardMessageId).toBe(deal.messages[2].id);
    expect(deal.quantity! * deal.unitPrice!).toBe(50000);
    expect(deal.quantity! * deal.unitPrice! * deal.proposedDiscount! / 100).toBe(17500);
    expect(deal.quantity! * deal.unitPrice! * (1 - deal.proposedDiscount! / 100)).toBe(32500);
    expect(deal.messages.map((message) => message.actor)).toEqual(["user", "sales-agent", "dealguard"]);
    expect(new Set(deal.messages.map((message) => message.id)).size).toBe(3);
    expect(deal.messages.every((message) => message.createdAt && Array.isArray(message.parts))).toBe(true);
    expect(deal.messages.map((message) => message.parts[0]?.type === "text" ? message.parts[0].text : "")).toContainEqual(expect.stringContaining("Customer: JSW"));
    expect(deal.messages[2].parts[0]).toMatchObject({ type: "text", text: expect.stringContaining("Proposal: LOCKED") });
    expect(deal.auditTrail.map((entry) => entry.message)).toEqual([
      "New deal started",
      "Sales Agent constructed proposal with customer-requested discount",
      "Proposal submitted to DealGuard",
      "DealGuard evaluated decision rights",
      "Proposal blocked",
    ]);
    expect(deal.auditTrail.some((entry) => entry.message.includes("Awaiting Sales Agent proposal"))).toBe(false);
    const handoff = setDealWorkflowPhase(deal, "handoff");
    expect(handoff.pendingDealGuardMessageId).toBe(deal.messages[2].id);
    const completed = setDealWorkflowPhase(setDealWorkflowPhase(handoff, "dealguard-review"), "complete");
    expect(completed.workflowPhase).toBe("complete");
    expect(completed.pendingDealGuardMessageId).toBeNull();
  });

  it("asks for missing terms and completes a proposal from a follow-up message", () => {
    const first = processCommercialMessage(createBlankDeal("deal-reliance-test"), "Reliance wants 250 licenses");
    expect(first.messages[1].parts[0]).toMatchObject({ type: "text", text: "What is the unit price and requested discount?" });
    expect(first.governanceDecision.status).toBe("AWAITING PROPOSAL");
    expect(first.workflowPhase).toBe("idle");

    const completed = processCommercialMessage(first, "₹2,000 each and 17% off");
    expect(completed).toMatchObject({ customerName: "Reliance", quantity: 250, unitPrice: 2000, proposedDiscount: 17 });
    expect(completed.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(completed.messages.slice(-2).map((message) => message.actor)).toEqual(["sales-agent", "dealguard"]);
  });

  it("asks only for price when recommendation intent is explicit and resumes it from the follow-up", () => {
    const first = processCommercialMessage(createBlankDeal("deal-reliance-recommend"), "Reliance wants 500 licences. Recommend a discount.");
    expect(first.messages.at(-1)?.parts[0]).toMatchObject({ type: "text", text: "What is the unit price per licence?" });
    expect(first.recommendationRequested).toBe(true);
    expect(first.proposedDiscount).toBeNull();

    const completed = processCommercialMessage(first, "₹2,000 each.");
    expect(completed).toMatchObject({
      customerName: "Reliance",
      quantity: 500,
      unitPrice: 2000,
      proposedDiscount: 12,
      discountSource: "AI_RECOMMENDED",
      recommendationRequested: false,
    });
    expect(completed.discountRationale).toContain("base 8% + 4 percentage points");
    expect(completed.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(completed.auditTrail.map((entry) => entry.message)).toEqual([
      "New deal started",
      "Sales Agent constructed deal context",
      "Sales Agent recommended 12% discount",
      "Proposal submitted to DealGuard",
      "DealGuard evaluated decision rights",
      "Sales Manager approval required",
    ]);
  });

  it("hands AI recommendations to the unchanged deterministic authority decision", () => {
    const mahindra = processCommercialMessage(createBlankDeal("recommend-300"), "Mahindra wants 300 licences at ₹2,500 each. Recommend a discount.");
    expect(mahindra.proposedDiscount).toBe(8);
    expect(mahindra.governanceDecision.status).toBe("AUTHORIZED / RELEASABLE");

    const jsw = processCommercialMessage(createBlankDeal("recommend-500"), "JSW wants 500 licences at ₹100 each. Recommend a discount.");
    expect(jsw.proposedDiscount).toBe(12);
    expect(jsw.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(jsw.governanceDecision.proposalState).toBe(ProposalState.HELD);
    const salesText = jsw.messages.find((message) => message.actor === "sales-agent")?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(salesText).toContain("Recommended Discount: 12%");
    expect(salesText).toContain("Discount Source: AI Recommendation");

    const tcs = processCommercialMessage(createBlankDeal("recommend-1000"), "TCS wants 1,000 licences at ₹5,000 each. What discount can we offer?");
    expect(tcs.proposedDiscount).toBe(15);
    expect(tcs.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
  });

  it("never replaces a customer-requested discount, even if recommendation language is present", () => {
    const deal = processCommercialMessage(createBlankDeal("customer-discount"), "JSW wants 500 licences at ₹100 each for 17% discount. Recommend a discount.");
    expect(deal.proposedDiscount).toBe(17);
    expect(deal.discountSource).toBe("CUSTOMER_REQUESTED");
    expect(deal.discountRationale).toBeNull();
    expect(deal.recommendationRequested).toBe(false);
    expect(deal.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    const revised = processCommercialMessage(deal, "Recommend a discount.");
    expect(revised).toMatchObject({ proposedDiscount: 12, discountSource: "AI_RECOMMENDED", governanceDecision: { status: "SALES MANAGER APPROVAL REQUIRED" } });

    const normalMissing = processCommercialMessage(createBlankDeal("missing-discount-normal"), "Reliance wants 250 licences at ₹2,000 each.");
    expect(normalMissing.messages.at(-1)?.parts[0]).toMatchObject({ type: "text", text: "What is the requested discount?" });
    expect(normalMissing.proposedDiscount).toBeNull();

    const infosys = processCommercialMessage(createBlankDeal("infosys-customer-7"), "Infosys wants 180 licences at ₹3,200 each for 7% discount.");
    expect(infosys).toMatchObject({ proposedDiscount: 7, discountSource: "CUSTOMER_REQUESTED", governanceDecision: { status: "AUTHORIZED / RELEASABLE" } });

    const hdfc = processCommercialMessage(createBlankDeal("hdfc-customer-35"), "HDFC Bank wants 120 licences at ₹6,100 each and wants 35% off.");
    expect(hdfc).toMatchObject({ proposedDiscount: 35, discountSource: "CUSTOMER_REQUESTED", governanceDecision: { status: "BLOCKED", proposalState: ProposalState.BLOCKED } });
  });

  it("synchronizes approval and delegated authority outcomes", () => {
    const managerDeal = processCommercialMessage(createBlankDeal("deal-mahindra-test"), "Mahindra wants 300 licenses at ₹2,500 each for 12% discount");
    expect(managerDeal.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(managerDeal.governanceDecision.proposalState).toBe(ProposalState.HELD);
    const approved = setDealApproval(managerDeal, "APPROVED");
    expect(approved.governanceDecision.status).toBe("AUTHORIZED / RELEASABLE");
    expect(approved.governanceDecision.proposalState).toBe(ProposalState.AUTHORIZED);
    expect(approved.auditTrail.at(-1)?.message).toContain("Human approval recorded");

    const infosys = processCommercialMessage(createBlankDeal("deal-infosys-test"), "Infosys wants 180 licenses at ₹3,200 each for 7% discount");
    expect(infosys.governanceDecision.status).toBe("AUTHORIZED / RELEASABLE");
    expect(infosys.governanceDecision.approvalState).toBe("APPROVED");
  });

  it("rejects punctuation-only quick replies such as a lone question mark", () => {
    const parsed = extractQuickOptions("\nOPTIONS:\n- ?\n- Continue with 17% off");
    expect(parsed.options).toEqual(["Continue with 17% off"]);
  });

  it("evaluates demo deal statuses with the deterministic thresholds", () => {
    const deals = createDemoDeals();
    const infosys = deals.find((deal) => deal.customerName === "Infosys");
    const reliance = deals.find((deal) => deal.customerName === "Reliance Industries");
    const tcs = deals.find((deal) => deal.customerName === "Tata Consultancy Services");
    const hdfc = deals.find((deal) => deal.customerName === "HDFC Bank");

    expect(infosys?.governanceStatus).toBe("AUTO_APPROVED");
    expect(reliance?.governanceStatus).toBe("SALES_MANAGER_APPROVAL_REQUIRED");
    expect(tcs?.governanceStatus).toBe("FINANCE_APPROVAL_REQUIRED");
    expect(hdfc?.governanceStatus).toBe("BLOCKED");
    expect(hdfc?.proposalState).toBe("BLOCKED");
  });

  it("constructs a stable summary for the selected deal", () => {
    const deal: Deal = {
      id: "d-1",
      customerName: "Larsen & Toubro",
      quantity: 750,
      unitPrice: 1200,
      proposedDiscount: 18,
      discountSource: "CUSTOMER_REQUESTED",
      discountRationale: null,
      recommendationRequested: false,
      workflowPhase: "complete",
      pendingDealGuardMessageId: null,
      governanceStatus: "SALES_MANAGER_APPROVAL_REQUIRED",
      proposalState: ProposalState.HELD,
      approvalState: "PENDING_SALES_MANAGER",
      governanceDecision: {
        proposalComplete: true,
        status: "SALES MANAGER APPROVAL REQUIRED",
        authorityStatus: "SALES_MANAGER_APPROVAL_REQUIRED",
        proposalState: ProposalState.HELD,
        approvalState: "PENDING_SALES_MANAGER",
        description: "Discounts between 10% and 20% require Sales Manager approval before release.",
      },
      auditTrail: [],
      messages: [],
    };

    const summary = createDealSummary(deal);
    expect(summary).toContain("Larsen & Toubro");
    expect(summary).toContain("18%");
    expect(summary).toContain("Sales Manager");
  });
});
