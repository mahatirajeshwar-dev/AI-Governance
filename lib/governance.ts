import {
  evaluateDiscountAuthority,
  type DiscountAuthorityStatus,
} from "@/app/api/chat/tools/deal-tools";

export enum ProposalState {
  PROPOSED = "PROPOSED",
  HELD = "HELD",
  AUTHORIZED = "AUTHORIZED",
  REJECTED = "REJECTED",
  BLOCKED = "BLOCKED",
}

export interface AuthorityBand {
  status: DiscountAuthorityStatus;
  label: string;
  authorityLevel: string;
  description: string;
  bandName: string;
}

export function getAuthorityBand(discountPercent: number): AuthorityBand {
  const result = evaluateDiscountAuthority(discountPercent);

  if (result.status === "AUTO_APPROVED") {
    return {
      status: "AUTO_APPROVED",
      label: "AI delegated authority",
      authorityLevel: "AI Delegated Authority",
      description: "Discounts up to 10% are within the Sales Agent’s delegated authority.",
      bandName: "AI delegated authority",
    };
  }

  if (result.status === "SALES_MANAGER_APPROVAL_REQUIRED") {
    return {
      status: "SALES_MANAGER_APPROVAL_REQUIRED",
      label: "Sales Manager approval required",
      authorityLevel: "Sales Manager",
      description: "Discounts between 10% and 20% require Sales Manager approval before release.",
      bandName: "Sales Manager",
    };
  }

  if (result.status === "FINANCE_APPROVAL_REQUIRED") {
    return {
      status: "FINANCE_APPROVAL_REQUIRED",
      label: "Finance approval required",
      authorityLevel: "Finance",
      description: "Discounts between 20% and 30% require Finance approval before release.",
      bandName: "Finance",
    };
  }

  return {
    status: "BLOCKED",
    label: "Blocked",
    authorityLevel: "None (Policy Exceeded)",
    description: "Discounts above 30% are blocked and cannot be released under the current discount policy.",
    bandName: "Blocked",
  };
}

export function isApprovalRequired(status: DiscountAuthorityStatus | string): boolean {
  return (
    status === "SALES_MANAGER_APPROVAL_REQUIRED" ||
    status === "FINANCE_APPROVAL_REQUIRED"
  );
}

export function isProposalReleasable(
  status: DiscountAuthorityStatus | ProposalState | string
): boolean {
  return status === "AUTO_APPROVED" || status === ProposalState.AUTHORIZED;
}

export function getProposalOutcome(
  status: DiscountAuthorityStatus | ProposalState | string
): ProposalState {
  if (status === "BLOCKED") return ProposalState.BLOCKED;
  if (status === "SALES_MANAGER_APPROVAL_REQUIRED") return ProposalState.HELD;
  if (status === "FINANCE_APPROVAL_REQUIRED") return ProposalState.HELD;
  if (status === ProposalState.AUTHORIZED) return ProposalState.AUTHORIZED;
  if (status === ProposalState.REJECTED) return ProposalState.REJECTED;
  if (status === ProposalState.HELD) return ProposalState.HELD;
  if (status === ProposalState.BLOCKED) return ProposalState.BLOCKED;
  return ProposalState.AUTHORIZED;
}
