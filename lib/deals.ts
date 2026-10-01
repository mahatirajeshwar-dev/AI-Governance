import {
  evaluateDiscountAuthority,
  formatINR,
  type DiscountAuthorityStatus,
} from "@/app/api/chat/tools/deal-tools";
import { ProposalState, getAuthorityBand, getProposalOutcome } from "@/lib/governance";
import { createDealId, createDealMessage, type DealMessage } from "@/lib/messages";
import { createEventTimestamp } from "@/lib/time";

export type DealApprovalState =
  | "PENDING_SALES_MANAGER"
  | "PENDING_FINANCE"
  | "APPROVED"
  | "REJECTED"
  | "BLOCKED"
  | "NONE";

export interface GovernanceDecision {
  proposalComplete: boolean;
  status: string;
  authorityStatus: DiscountAuthorityStatus;
  proposalState: ProposalState;
  approvalState: DealApprovalState;
  description: string;
}

export interface DealAuditEntry {
  timestamp: string;
  message: string;
  tone: "sales" | "dealguard" | "human" | "blocked" | "authorized";
}

export type DiscountSource = "CUSTOMER_REQUESTED" | "AI_RECOMMENDED";

export interface DiscountRecommendation {
  recommendedDiscount: number;
  rationale: string;
  source: "AI_RECOMMENDED";
}

export type DealWorkflowPhase = "idle" | "sales-agent" | "handoff" | "dealguard-review" | "complete";

export interface Deal {
  id: string;
  customerName: string;
  quantity: number | null;
  unitPrice: number | null;
  proposedDiscount: number | null;
  discountSource: DiscountSource | null;
  discountRationale: string | null;
  recommendationRequested: boolean;
  workflowPhase: DealWorkflowPhase;
  pendingDealGuardMessageId: string | null;
  governanceStatus: DiscountAuthorityStatus;
  proposalState: ProposalState;
  approvalState: DealApprovalState;
  governanceDecision: GovernanceDecision;
  auditTrail: DealAuditEntry[];
  messages: DealMessage[];
}

export function createBlankDeal(id = createDealId("deal")): Deal {
  return {
    id,
    customerName: "—",
    quantity: null,
    unitPrice: null,
    proposedDiscount: null,
    discountSource: null,
    discountRationale: null,
    recommendationRequested: false,
    workflowPhase: "idle",
    pendingDealGuardMessageId: null,
    governanceStatus: "INVALID_INPUT",
    proposalState: ProposalState.PROPOSED,
    approvalState: "NONE",
    governanceDecision: {
      proposalComplete: false,
      status: "AWAITING PROPOSAL",
      authorityStatus: "INVALID_INPUT",
      proposalState: ProposalState.PROPOSED,
      approvalState: "NONE",
      description: "Awaiting Sales Agent proposal.",
    },
    auditTrail: [
      {
        timestamp: createEventTimestamp(),
        message: "New deal started",
        tone: "sales",
      },
      {
        timestamp: createEventTimestamp(),
        message: "Awaiting Sales Agent proposal",
        tone: "dealguard",
      },
    ],
    messages: [],
  };
}

export function setDealWorkflowPhase(deal: Deal, workflowPhase: DealWorkflowPhase): Deal {
  return {
    ...deal,
    workflowPhase,
    pendingDealGuardMessageId: workflowPhase === "complete" ? null : deal.pendingDealGuardMessageId,
  };
}

export function recommendDiscount({ quantity }: { quantity: number }): DiscountRecommendation {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("Recommendation quantity must be a positive integer.");
  }

  const volumeIncrease = quantity >= 1000 ? 7 : quantity >= 500 ? 4 : 0;
  const recommendedDiscount = Math.min(15, 8 + volumeIncrease);
  const rationale = quantity >= 1000
    ? "Volume-based recommendation: base 8% + 7 percentage points for quantities of 1,000 or more, capped at 15%."
    : quantity >= 500
      ? "Volume-based recommendation: base 8% + 4 percentage points for quantities of 500 or more."
      : "Volume-based recommendation: base 8%; no volume increase applies below 500 licences.";

  return { recommendedDiscount, rationale, source: "AI_RECOMMENDED" };
}

export function getDefaultDealAuditTrail(customerName: string, discount: number | null): DealAuditEntry[] {
  const time = createEventTimestamp();
  const safeDiscount = discount ?? 0;
  const authorityStatus = evaluateDiscountAuthority(safeDiscount);

  const entries: DealAuditEntry[] = [
    {
      timestamp: time,
      message: `Sales Agent proposed ${customerName || "the commercial opportunity"} with ${formatPercent(discount)} discount.`,
      tone: "sales",
    },
    {
      timestamp: time,
      message: "DealGuard evaluated the discount against delegated authority.",
      tone: "dealguard",
    },
  ];

  if (authorityStatus.status === "BLOCKED") {
    entries.push({
      timestamp: time,
      message: "Blocked: proposal exceeds the 30% policy ceiling.",
      tone: "blocked",
    });
  } else if (authorityStatus.status === "AUTO_APPROVED") {
    entries.push({
      timestamp: time,
      message: "Authorization confirmed: within AI delegated authority.",
      tone: "authorized",
    });
  } else {
    entries.push({
      timestamp: time,
      message: `${getAuthorityBand(safeDiscount).bandName} approval required before release.`,
      tone: "dealguard",
    });
  }

  return entries;
}

export function createDealSummary(deal: Deal): string {
  const listValue = (deal.quantity ?? 0) * (deal.unitPrice ?? 0);
  const discountAmount = listValue * (((deal.proposedDiscount ?? 0) / 100) || 0);
  const approvalText =
    deal.governanceDecision.authorityStatus === "AUTO_APPROVED"
      ? "Within AI delegated authority"
      : deal.governanceDecision.approvalState === "APPROVED"
      ? "Approved"
      : deal.governanceDecision.approvalState === "REJECTED"
        ? "Rejected"
        : deal.governanceDecision.proposalState === ProposalState.HELD
          ? "Sales Manager"
          : deal.governanceDecision.proposalState === ProposalState.BLOCKED
            ? "Policy block"
            : "AI delegated authority";

  return `${deal.customerName}: ${deal.quantity ?? "—"} units at ${formatINR(deal.unitPrice ?? 0)} with ${formatPercent(deal.proposedDiscount)} discount (${formatINR(discountAmount)}). ${deal.governanceDecision.status}. ${approvalText} is the current decision status.`;
}

export function createDemoDeals(): Deal[] {
  return [
    buildDealFromProposal({
      id: "deal-infosys",
      customerName: "Infosys",
      quantity: 180,
      unitPrice: 3200,
      proposedDiscount: 7,
    }),
    buildDealFromProposal({
      id: "deal-reliance",
      customerName: "Reliance Industries",
      quantity: 240,
      unitPrice: 4400,
      proposedDiscount: 17,
    }),
    buildDealFromProposal({
      id: "deal-tcs",
      customerName: "Tata Consultancy Services",
      quantity: 350,
      unitPrice: 5100,
      proposedDiscount: 24,
    }),
    buildDealFromProposal({
      id: "deal-hdfc",
      customerName: "HDFC Bank",
      quantity: 120,
      unitPrice: 6100,
      proposedDiscount: 35,
    }),
  ];
}

export function applyProposalToDeal(deal: Deal, updates: Partial<Deal>): Deal {
  const nextDeal = {
    ...deal,
    customerName: updates.customerName ?? deal.customerName,
    quantity: updates.quantity ?? deal.quantity,
    unitPrice: updates.unitPrice ?? deal.unitPrice,
    proposedDiscount: updates.proposedDiscount ?? deal.proposedDiscount,
    discountSource: updates.discountSource ?? (updates.proposedDiscount != null ? "CUSTOMER_REQUESTED" : deal.discountSource),
    discountRationale: updates.discountRationale ?? (updates.proposedDiscount != null ? null : deal.discountRationale),
    recommendationRequested: updates.recommendationRequested ?? deal.recommendationRequested,
  };
  return synchronizeDecision(nextDeal);
}

export function hasCompleteProposal(
  deal: Pick<Deal, "customerName" | "quantity" | "unitPrice" | "proposedDiscount">
): deal is typeof deal & { customerName: string; quantity: number; unitPrice: number; proposedDiscount: number } {
  return deal.customerName !== "—" && deal.quantity !== null && Number.isInteger(deal.quantity) && deal.quantity > 0 &&
    deal.unitPrice !== null && deal.unitPrice > 0 && deal.proposedDiscount !== null;
}

export function hasProposalDetails(proposal: Partial<Deal>): boolean {
  return Boolean(
    (proposal.customerName && proposal.customerName !== "—") ||
    proposal.quantity != null || proposal.unitPrice != null || proposal.proposedDiscount != null ||
    proposal.recommendationRequested
  );
}

function synchronizeDecision(deal: Omit<Deal, "governanceDecision"> | Deal): Deal {
  if (!hasCompleteProposal(deal)) {
    return {
      ...deal,
      governanceStatus: "INVALID_INPUT",
      proposalState: ProposalState.PROPOSED,
      approvalState: "NONE",
      governanceDecision: {
        proposalComplete: false,
        status: "AWAITING PROPOSAL",
        authorityStatus: "INVALID_INPUT",
        proposalState: ProposalState.PROPOSED,
        approvalState: "NONE",
        description: "Awaiting Sales Agent proposal.",
      },
    };
  }

  const authority = evaluateDiscountAuthority(deal.proposedDiscount);
  const proposalState = getProposalOutcome(authority.status);
  const approvalState: DealApprovalState = authority.status === "AUTO_APPROVED" ? "APPROVED"
    : authority.status === "BLOCKED" ? "BLOCKED"
      : authority.status === "SALES_MANAGER_APPROVAL_REQUIRED" ? "PENDING_SALES_MANAGER"
        : "PENDING_FINANCE";
  const status = authority.status === "AUTO_APPROVED" ? "AUTHORIZED / RELEASABLE"
    : authority.status === "SALES_MANAGER_APPROVAL_REQUIRED" ? "SALES MANAGER APPROVAL REQUIRED"
      : authority.status === "FINANCE_APPROVAL_REQUIRED" ? "FINANCE APPROVAL REQUIRED"
        : "BLOCKED";

  return {
    ...deal,
    governanceStatus: authority.status,
    proposalState,
    approvalState,
    governanceDecision: {
      proposalComplete: true,
      status,
      authorityStatus: authority.status,
      proposalState,
      approvalState,
      description: getAuthorityBand(deal.proposedDiscount).description,
    },
  };
}

export function parseCommercialRequest(input: string): Partial<Deal> {
  const value = input.trim();
  if (!value) return {};

  const customerName = extractCustomerName(value);
  const quantity = extractQuantity(value);
  const unitPrice = extractUnitPrice(value);
  const proposedDiscount = extractDiscount(value);
  const recommendationRequested = detectDiscountRecommendationIntent(value);

  return {
    customerName: customerName ?? undefined,
    quantity: quantity ?? undefined,
    unitPrice: unitPrice ?? undefined,
    proposedDiscount: proposedDiscount ?? undefined,
    recommendationRequested,
  };
}

export function detectDiscountRecommendationIntent(input: string): boolean {
  const value = input.toLowerCase();
  return /\b(?:recommend|suggest)\b.{0,50}\b(?:discount|offer)\b/.test(value) ||
    /\b(?:recommend|suggest)\s+(?:an?\s+)?offer\b/.test(value) ||
    /\bwhat\s+discount\b.{0,50}\b(?:offer|propose|give|recommend|suggest)\b/.test(value) ||
    /\b(?:suitable|appropriate)\s+discount\b/.test(value) ||
    /\b(?:give|offer)\s+(?:them|the customer)\s+(?:a\s+)?(?:suitable|appropriate)\s+discount\b/.test(value);
}

export function processCommercialMessage(deal: Deal, input: string): Deal {
  const parsed = parseCommercialRequest(input);
  const userMessage = createDealMessage({
    dealId: deal.id,
    actor: "user",
    role: "user",
    text: input,
    sequence: deal.messages.length + 1,
  });
  const customerSuppliedDiscount = parsed.proposedDiscount != null;
  const recommendationRequested = deal.recommendationRequested || parsed.recommendationRequested === true;
  const replacePriorDiscountWithRecommendation = recommendationRequested && !customerSuppliedDiscount;
  let updated = synchronizeDecision({
    ...deal,
    customerName: parsed.customerName ?? deal.customerName,
    quantity: parsed.quantity ?? deal.quantity,
    unitPrice: parsed.unitPrice ?? deal.unitPrice,
    proposedDiscount: customerSuppliedDiscount ? parsed.proposedDiscount! : replacePriorDiscountWithRecommendation ? null : deal.proposedDiscount,
    discountSource: customerSuppliedDiscount ? "CUSTOMER_REQUESTED" : replacePriorDiscountWithRecommendation ? null : deal.discountSource,
    discountRationale: customerSuppliedDiscount || replacePriorDiscountWithRecommendation ? null : deal.discountRationale,
    recommendationRequested: customerSuppliedDiscount ? false : recommendationRequested,
    messages: [...deal.messages, userMessage],
  });

  if (
    recommendationRequested &&
    !customerSuppliedDiscount &&
    updated.proposedDiscount === null &&
    updated.quantity !== null && Number.isInteger(updated.quantity) && updated.quantity > 0 &&
    updated.unitPrice !== null
  ) {
    const recommendation = recommendDiscount({ quantity: updated.quantity });
    updated = synchronizeDecision({
      ...updated,
      proposedDiscount: recommendation.recommendedDiscount,
      discountSource: recommendation.source,
      discountRationale: recommendation.rationale,
      recommendationRequested: false,
    });
  }

  if (!updated.governanceDecision.proposalComplete) {
    const missing = [
      updated.customerName === "—" ? "customer name" : null,
      updated.quantity === null || !Number.isInteger(updated.quantity) || updated.quantity <= 0 ? "quantity" : null,
      updated.unitPrice === null ? "unit price" : null,
      !updated.recommendationRequested && updated.proposedDiscount === null ? "requested discount" : null,
    ].filter((field): field is string => field !== null);
    const question = updated.recommendationRequested && updated.unitPrice === null && updated.quantity !== null
      ? "What is the unit price per licence?"
      : missing.length === 2
        ? `What is the ${missing[0]} and ${missing[1]}?`
        : `What is the ${missing.join(", ")}?`;
    const followUp = createDealMessage({
      dealId: deal.id,
      actor: "sales-agent",
      role: "assistant",
      text: question,
      sequence: updated.messages.length + 1,
    });
    const waitingAudit = updated.auditTrail.some((entry) => entry.message === "Awaiting Sales Agent proposal")
      ? updated.auditTrail
      : [...updated.auditTrail, { timestamp: createEventTimestamp(), message: "Awaiting Sales Agent proposal", tone: "dealguard" as const }];
    return {
      ...updated,
      workflowPhase: "idle",
      pendingDealGuardMessageId: null,
      auditTrail: waitingAudit,
      messages: [...updated.messages, followUp],
    };
  }

  const recommendationLines = updated.discountSource === "AI_RECOMMENDED"
    ? [
        "Discount Recommendation",
        `Recommended Discount: ${formatPercent(updated.proposedDiscount)}`,
        `Rationale: ${updated.discountRationale}`,
        "",
      ]
    : [];
  const salesMessage = createDealMessage({
    dealId: deal.id,
    actor: "sales-agent",
    role: "assistant",
    text: [
      ...recommendationLines,
      "Proposed Commercial Action",
      "",
      `Customer: ${updated.customerName}`,
      `Quantity: ${updated.quantity} licences`,
      `Unit Price: ${formatINR(updated.unitPrice ?? 0)}`,
      `Proposed Discount: ${formatPercent(updated.proposedDiscount)}`,
      `Discount Source: ${updated.discountSource === "AI_RECOMMENDED" ? "AI Recommendation" : "Customer Request"}`,
      "",
      "Submitting this proposal to DealGuard for governance review...",
    ].join("\n"),
    sequence: updated.messages.length + 1,
  });
  const guardMessage = createDealMessage({
    dealId: deal.id,
    actor: "dealguard",
    role: "assistant",
    text: createGovernanceMessage(updated),
    sequence: updated.messages.length + 2,
  });

  return {
    ...updated,
    workflowPhase: "sales-agent",
    pendingDealGuardMessageId: guardMessage.id,
    auditTrail: createCompletedAuditTrail(updated),
    messages: [...updated.messages, salesMessage, guardMessage],
  };
}

function createGovernanceMessage(deal: Deal): string {
  const decision = deal.governanceDecision;
  if (decision.status === "BLOCKED") {
    return `Governance Review\n\nBLOCKED\n\nThe proposed ${formatPercent(deal.proposedDiscount)} discount exceeds the maximum delegated authority.\n\nProposal: LOCKED`;
  }
  if (decision.status === "AUTHORIZED / RELEASABLE") {
    return "Governance Review\n\nAUTHORIZED / RELEASABLE\n\nThe proposed discount is within AI delegated authority.\n\nProposal: RELEASABLE";
  }
  return `Governance Review\n\n${decision.status}\n\n${decision.description}\n\nProposal: HELD`;
}

function createCompletedAuditTrail(deal: Deal): DealAuditEntry[] {
  const authorityStatus = deal.governanceDecision.authorityStatus;
  const entries: DealAuditEntry[] = [
    { timestamp: createEventTimestamp(), message: "New deal started", tone: "sales" },
  ];
  if (deal.discountSource === "AI_RECOMMENDED") {
    entries.push(
      { timestamp: createEventTimestamp(), message: "Sales Agent constructed deal context", tone: "sales" },
      { timestamp: createEventTimestamp(), message: `Sales Agent recommended ${formatPercent(deal.proposedDiscount)} discount`, tone: "sales" },
    );
  } else {
    entries.push({ timestamp: createEventTimestamp(), message: "Sales Agent constructed proposal with customer-requested discount", tone: "sales" });
  }
  entries.push(
    { timestamp: createEventTimestamp(), message: "Proposal submitted to DealGuard", tone: "sales" },
    { timestamp: createEventTimestamp(), message: "DealGuard evaluated decision rights", tone: "dealguard" },
  );
  if (authorityStatus === "BLOCKED") {
    entries.push({ timestamp: createEventTimestamp(), message: "Proposal blocked", tone: "blocked" });
  } else if (authorityStatus === "AUTO_APPROVED") {
    entries.push({ timestamp: createEventTimestamp(), message: "Proposal authorized within delegated authority", tone: "authorized" });
  } else {
    entries.push({ timestamp: createEventTimestamp(), message: `${getAuthorityBand(deal.proposedDiscount ?? 0).bandName} approval required`, tone: "dealguard" });
  }
  return entries;
}

export function buildDealFromProposal(partial: Partial<Deal>): Deal {
  const base = createBlankDeal(partial.id ?? createDealId("deal"));
  const next = synchronizeDecision({
    ...base,
    ...partial,
    customerName: partial.customerName ?? "—",
    quantity: partial.quantity ?? null,
    unitPrice: partial.unitPrice ?? null,
    proposedDiscount: partial.proposedDiscount ?? null,
    discountSource: partial.discountSource ?? (partial.proposedDiscount != null ? "CUSTOMER_REQUESTED" : null),
    discountRationale: partial.discountRationale ?? null,
    recommendationRequested: partial.recommendationRequested ?? false,
  });
  if (!next.governanceDecision.proposalComplete) return next;

  return {
    ...next,
    workflowPhase: "complete",
    pendingDealGuardMessageId: null,
    auditTrail: partial.auditTrail?.length ? partial.auditTrail : createCompletedAuditTrail(next),
    messages: next.messages.length ? next.messages : buildDemoConversation(next),
  };
}

export function setDealApproval(deal: Deal, approval: "APPROVED" | "REJECTED"): Deal {
  const proposalState = approval === "APPROVED" ? ProposalState.AUTHORIZED : ProposalState.REJECTED;
  const status = approval === "APPROVED" ? "AUTHORIZED / RELEASABLE" : "REJECTED";
  return {
    ...deal,
    proposalState,
    approvalState: approval,
    governanceDecision: {
      ...deal.governanceDecision,
      status,
      proposalState,
      approvalState: approval,
      description: approval === "APPROVED"
        ? "Human approval recorded. The proposal is authorized and releasable."
        : "The proposal was rejected and remains locked.",
    },
    auditTrail: [
      ...deal.auditTrail,
      {
        timestamp: createEventTimestamp(),
        message: approval === "APPROVED"
          ? "Human approval recorded: proposal authorized and releasable."
          : "Human approval recorded: proposal rejected and remains locked.",
        tone: approval === "APPROVED" ? "authorized" : "blocked",
      },
    ],
  };
}

function buildDemoConversation(deal: Deal): DealMessage[] {
  const userText = `${deal.customerName} wants ${deal.quantity} licences at ₹${deal.unitPrice?.toLocaleString("en-IN")} each and is asking for ${deal.proposedDiscount}% off.`;
  const assistantText = [
    "Proposed Commercial Action",
    "",
    `Customer: ${deal.customerName}`,
    `Quantity: ${deal.quantity} licences`,
    `Unit Price: ${formatINR(deal.unitPrice ?? 0)}`,
    `Proposed Discount: ${formatPercent(deal.proposedDiscount)}`,
    `Discount Source: ${deal.discountSource === "AI_RECOMMENDED" ? "AI Recommendation" : "Customer Request"}`,
    "",
    "Submitting this proposal to DealGuard for governance review...",
  ].join("\n");

  return [
    createDealMessage({ dealId: deal.id, actor: "user", role: "user", text: userText, sequence: 1, id: `${deal.id}-user-1` }),
    createDealMessage({ dealId: deal.id, actor: "sales-agent", role: "assistant", text: assistantText, sequence: 2, id: `${deal.id}-sales-1` }),
    createDealMessage({ dealId: deal.id, actor: "dealguard", role: "assistant", text: createGovernanceMessage(deal), sequence: 3, id: `${deal.id}-dealguard-1` }),
  ];
}

function extractCustomerName(value: string): string | null {
  const patterns = [
    /(?:for|with|to)\s+([A-Z][A-Za-z0-9&.'\- ]{2,40})(?=\s+(?:wants|needs|is\s+looking\s+for|seeks|requests|asking\s+for|is\s+considering))/i,
    /([A-Z][A-Za-z0-9&.'\- ]{2,40})\s+(?:wants|needs|seeks|requests|is\s+looking\s+for|is\s+considering)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function extractQuantity(value: string): number | null {
  const match = value.match(/(\d[\d,]*)\s*(?:licences?|licenses?|seats?|users?|units?|items?)/i);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function extractUnitPrice(value: string): number | null {
  const patterns = [
    /^\s*(?:₹|INR)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:each)?[.!?]?\s*$/i,
    /(?:₹|INR)\s*(\d[\d,]*(?:\.\d+)?)\s*(?:each|per\s+(?:licence|license|seat|user|unit|item)|price)/i,
    /(?:at|for)\s*(?:₹|INR)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:each|per\s+(?:licence|license|seat|user|unit|item))/i,
    /(?:at|for)\s*(?:₹|INR)\s*(\d[\d,]*(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return Number(match[1].replace(/,/g, ""));
  }

  return null;
}

function extractDiscount(value: string): number | null {
  const match = value.match(/(\d{1,2}(?:\.\d+)?)\s*%?\s*(?:off|discount)/i);
  if (!match) return null;
  return Number(match[1]);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}
