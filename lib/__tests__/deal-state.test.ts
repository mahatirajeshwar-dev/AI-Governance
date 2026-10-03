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
  migrateSavedDeal,
  type Deal,
} from "@/lib/deals";
import { UNIT_PRICE } from "@/lib/pricing";

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
    expect(deal.unitPrice).toBe(UNIT_PRICE);
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

  it("enforces the configured price and creates a synchronized JSW governance handoff", () => {
    const parsed = parseCommercialRequest("JSW wants 500 licenses at Rs. 100 each for 35% discount");
    expect(parsed).toMatchObject({ customerName: "JSW", quantity: 500, unitPrice: 100, proposedDiscount: 35 });

    const deal = processCommercialMessage(createBlankDeal("deal-jsw"), "JSW wants 500 licenses at Rs. 100 each for 35% discount");
    expect(deal.governanceDecision).toMatchObject({ proposalComplete: true, status: "BLOCKED", authorityStatus: "BLOCKED", proposalState: ProposalState.BLOCKED });
    expect(deal.approvalState).toBe("BLOCKED");
    expect(deal.workflowPhase).toBe("sales-agent");
    expect(deal.pendingDealGuardMessageId).toBe(deal.messages[2].id);
    expect(deal.unitPrice).toBe(UNIT_PRICE);
    expect(deal.quantity! * deal.unitPrice!).toBe(1250000);
    expect(deal.quantity! * deal.unitPrice! * deal.proposedDiscount! / 100).toBe(437500);
    expect(deal.quantity! * deal.unitPrice! * (1 - deal.proposedDiscount! / 100)).toBe(812500);
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

  it("asks only for a missing discount and completes the proposal from a follow-up", () => {
    const first = processCommercialMessage(createBlankDeal("deal-reliance-test"), "Reliance wants 250 licenses");
    expect(first.messages[1].parts[0]).toMatchObject({ type: "text", text: "What is the requested discount?" });
    expect(first.governanceDecision.status).toBe("AWAITING PROPOSAL");
    expect(first.workflowPhase).toBe("idle");

    const completed = processCommercialMessage(first, "17% off");
    expect(completed).toMatchObject({ customerName: "Reliance", quantity: 250, unitPrice: UNIT_PRICE, proposedDiscount: 17 });
    expect(completed.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(completed.messages.slice(-2).map((message) => message.actor)).toEqual(["sales-agent", "dealguard"]);
  });

  it("recommends a discount immediately without asking for unit price", () => {
    const first = processCommercialMessage(createBlankDeal("deal-reliance-recommend"), "Reliance wants 500 licences. Recommend a discount.");
    expect(first).toMatchObject({
      customerName: "Reliance",
      quantity: 500,
      unitPrice: UNIT_PRICE,
      proposedDiscount: 12,
      discountSource: "AI_RECOMMENDED",
      recommendationRequested: false,
    });
    expect(first.discountRationale).toContain("base 8% + 4 percentage points");
    expect(first.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(first.auditTrail.map((entry) => entry.message)).toEqual([
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

    const jsw = processCommercialMessage(createBlankDeal("recommend-500"), "JSW wants 500 licences. Recommend a discount.");
    expect(jsw.proposedDiscount).toBe(12);
    expect(jsw.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(jsw.governanceDecision.proposalState).toBe(ProposalState.HELD);
    const salesText = jsw.messages.find((message) => message.actor === "sales-agent")?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    expect(salesText).toContain("Recommended Discount: 12%");
    expect(salesText).toContain("Discount Source: AI Recommendation");

    const tcs = processCommercialMessage(createBlankDeal("recommend-1000"), "TCS wants 1,000 licences. What discount can we offer?");
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

    const normalMissing = processCommercialMessage(createBlankDeal("missing-discount-normal"), "Reliance wants 250 licences.");
    expect(normalMissing.messages.at(-1)?.parts[0]).toMatchObject({ type: "text", text: "What is the requested discount?" });
    expect(normalMissing.proposedDiscount).toBeNull();

    const infosys = processCommercialMessage(createBlankDeal("infosys-customer-7"), "Infosys needs 180 licences with 7% discount.");
    expect(infosys).toMatchObject({ unitPrice: UNIT_PRICE, proposedDiscount: 7, discountSource: "CUSTOMER_REQUESTED", governanceDecision: { status: "AUTHORIZED / RELEASABLE" } });

    const hdfc = processCommercialMessage(createBlankDeal("hdfc-customer-35"), "HDFC wants 120 licences and is asking for 35% off.");
    expect(hdfc).toMatchObject({ unitPrice: UNIT_PRICE, proposedDiscount: 35, discountSource: "CUSTOMER_REQUESTED", governanceDecision: { status: "BLOCKED", proposalState: ProposalState.BLOCKED } });
  });

  it("recognizes common rupee expressions and explains when a non-configured price is supplied", () => {
    for (const [expression, expected] of [
      ["₹2,500 each", 2500],
      ["Rs 2500 each", 2500],
      ["Rs. 2500 per licence", 2500],
      ["INR 2500 each", 2500],
      ["2500 rupees each", 2500],
      ["2500 rs each", 2500],
      ["2500 bucks each", 2500],
    ]) {
      expect(parseCommercialRequest(`JSW wants 500 licences at ${expression} and 12% off`).unitPrice).toBe(expected);
    }

    const corrected = processCommercialMessage(createBlankDeal("fixed-price-correction"), "JSW wants 500 licences at Rs 3,000 each and 12% off");
    expect(corrected.unitPrice).toBe(UNIT_PRICE);
    expect(corrected.messages.at(-2)?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("The requested price will not be used"),
    });
  });

  it("synchronizes approval and delegated authority outcomes", () => {
    const managerDeal = processCommercialMessage(createBlankDeal("deal-mahindra-test"), "Mahindra wants 300 licenses at ₹2,500 each for 12% discount");
    expect(managerDeal.governanceDecision.status).toBe("SALES MANAGER APPROVAL REQUIRED");
    expect(managerDeal.governanceDecision.proposalState).toBe(ProposalState.HELD);
    const approved = setDealApproval(managerDeal, "APPROVED");
    expect(approved.governanceDecision.status).toBe("AUTHORIZED / RELEASABLE");
    expect(approved.governanceDecision.proposalState).toBe(ProposalState.AUTHORIZED);
    expect(approved.auditTrail.at(-1)?.message).toContain("Human approval recorded");
    const revised = processCommercialMessage(approved, "Change the discount to 15% off.");
    expect(revised.approvalState).toBe("PENDING_SALES_MANAGER");
    expect(revised.auditTrail.some((entry) => entry.message.includes("Human approval recorded"))).toBe(true);
    expect(revised.auditTrail.at(-1)?.message).toBe("Sales Manager approval required");

    const infosys = processCommercialMessage(createBlankDeal("deal-infosys-test"), "Infosys wants 180 licenses for 7% discount");
    expect(infosys.governanceDecision.status).toBe("AUTHORIZED / RELEASABLE");
    expect(infosys.governanceDecision.approvalState).toBe("APPROVED");
  });

  it("migrates saved prices without changing IDs or rewriting history", () => {
    const originallyApproved = setDealApproval(
      processCommercialMessage(createBlankDeal("saved-deal-approved"), "Infosys needs 180 licences with 12% discount."),
      "APPROVED"
    );
    const historical = {
      ...originallyApproved,
      unitPrice: 3200,
      messages: originallyApproved.messages.map((message) => ({ ...message })),
    };
    const migrated = migrateSavedDeal(historical);

    expect(migrated.migrated).toBe(true);
    expect(migrated.deal.id).toBe(historical.id);
    expect(migrated.deal.unitPrice).toBe(UNIT_PRICE);
    expect(migrated.deal.approvalState).toBe("APPROVED");
    expect(migrated.deal.messages.map((message) => message.id)).toEqual(
      historical.messages.map((message) => message.id)
    );
    expect(migrated.deal.auditTrail.slice(0, historical.auditTrail.length)).toEqual(historical.auditTrail);
    expect(migrated.deal.auditTrail.at(-1)?.message).toContain("Migration: unit price changed");

    const previouslyBlockedByHistory = setDealApproval(
      processCommercialMessage(createBlankDeal("saved-deal-blocked"), "HDFC wants 120 licences and is asking for 35% off."),
      "APPROVED"
    );
    const blockedMigration = migrateSavedDeal({ ...previouslyBlockedByHistory, unitPrice: 4000 });
    expect(blockedMigration.deal.approvalState).toBe("BLOCKED");
    expect(blockedMigration.deal.governanceDecision.status).toBe("BLOCKED");
    expect(blockedMigration.deal.auditTrail).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Human approval recorded") })
    );
    expect(blockedMigration.deal.auditTrail.at(-1)?.message).toContain("no longer valid");
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
      unitPrice: UNIT_PRICE,
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
