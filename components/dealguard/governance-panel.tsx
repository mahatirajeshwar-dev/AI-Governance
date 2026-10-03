"use client";

import {
  ArrowRight,
  BadgeAlert,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProposalState } from "@/lib/governance";
import { createBlankDeal, type Deal } from "@/lib/deals";
import { calculateDealTerms, formatINR } from "@/app/api/chat/tools/deal-tools";
import { formatDisplayTime } from "@/lib/time";
import { UNIT_PRICE } from "@/lib/pricing";

export function GovernancePanel({
  deal,
  onApprove,
  onReject,
}: {
  deal: Deal | null;
  onApprove: (dealId: string) => void;
  onReject: (dealId: string) => void;
}) {
  const displayDeal = deal ?? createBlankDeal("draft");
  const decision = displayDeal.governanceDecision;
  const isBlank = !decision.proposalComplete;
  const workflowActive = displayDeal.workflowPhase === "sales-agent" || displayDeal.workflowPhase === "handoff" || displayDeal.workflowPhase === "dealguard-review";
  const visibleGovernanceStatus = workflowActive
    ? displayDeal.workflowPhase === "sales-agent" ? "REVIEW IN PROGRESS" : "REVIEWING DECISION RIGHTS"
    : decision.status;
  const visibleGovernanceDescription = workflowActive
    ? displayDeal.workflowPhase === "sales-agent"
      ? "Sales Agent proposal is ready for independent DealGuard review."
      : "DealGuard is evaluating the proposal against delegated decision rights."
    : decision.description;
  const economics = decision.proposalComplete
    ? calculateDealTerms(displayDeal.quantity!, displayDeal.proposedDiscount!)
    : null;
  const listValue = economics?.listValue ?? 0;
  const discountAmount = economics?.discountAmount ?? 0;
  const finalValue = economics?.dealValue ?? 0;
  const showApprovalCard = !workflowActive && !isBlank && (decision.approvalState === "PENDING_SALES_MANAGER" || decision.approvalState === "PENDING_FINANCE");
  const isReleasable = !workflowActive && !isBlank && decision.status === "AUTHORIZED / RELEASABLE";
  const isManagerApproval = decision.authorityStatus === "SALES_MANAGER_APPROVAL_REQUIRED";
  const hasHumanDecision = !workflowActive && !isBlank && (
    decision.proposalState === ProposalState.REJECTED ||
    decision.proposalState === ProposalState.AUTHORIZED && decision.authorityStatus !== "AUTO_APPROVED"
  );
  const submissionIndex = displayDeal.auditTrail.findIndex((entry) => entry.message === "Proposal submitted to DealGuard");
  const auditEntries = workflowActive
    ? displayDeal.auditTrail.slice(0, displayDeal.workflowPhase === "sales-agent" ? submissionIndex : submissionIndex + 1)
    : displayDeal.auditTrail;

  return (
    <aside className="w-full rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Current deal</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{displayDeal.customerName}</h2>
        </div>
        <div className={cn("max-w-[55%] rounded-full border px-2.5 py-1 text-right text-[9px] font-semibold uppercase tracking-[0.12em]", getStatusTone(visibleGovernanceStatus))}>
          {visibleGovernanceStatus}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            <BriefcaseBusiness className="size-3.5 text-sky-700" />
            Commercial details
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <MetricRow label="Quantity" value={`${displayDeal.quantity ?? "—"} licences`} />
            <MetricRow label="Unit Price" value={formatINR(UNIT_PRICE)} />
            <MetricRow
              label="Proposed Discount"
              value={formatPercent(displayDeal.proposedDiscount)}
              detail={displayDeal.discountSource === "AI_RECOMMENDED" ? "AI Recommended" : displayDeal.discountSource ? "Customer Requested" : undefined}
            />
            <MetricRow label="List Value" value={formatINR(listValue)} />
            <MetricRow label="Discount Amount" value={formatINR(discountAmount)} />
            <MetricRow label="Final Value" value={formatINR(finalValue)} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Decision rights</p>
            <span className="text-xs font-medium text-slate-500">{formatPercent(displayDeal.proposedDiscount)}</span>
          </div>
          <div className="relative mb-3 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="absolute inset-y-0 left-0 flex w-full">
              <div className="h-full w-[25%] bg-sky-500/90" />
              <div className="h-full w-[25%] bg-amber-400/90" />
              <div className="h-full w-[25%] bg-violet-500/90" />
              <div className="h-full w-[25%] bg-red-500/90" />
            </div>
            <div
              className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-md"
              style={{ left: `${Math.min(Math.max(getBandPosition(displayDeal.proposedDiscount), 2), 96)}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-1 text-[10px] font-medium text-slate-600">
            <span>0–10</span>
            <span>10–20</span>
            <span>20–30</span>
            <span>&gt;30</span>
          </div>
        </div>

        <div className={cn("rounded-xl border p-4", getStatusTone(visibleGovernanceStatus))}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Governance status</p>
              <p className="mt-1 text-lg font-semibold">{visibleGovernanceStatus}</p>
            </div>
            {visibleGovernanceStatus === "BLOCKED" ? (
              <BadgeAlert className="h-5 w-5 flex-none" />
            ) : isReleasable ? (
              <CheckCircle2 className="h-5 w-5 flex-none" />
            ) : visibleGovernanceStatus === "AUTHORIZED / RELEASABLE" ? (
              <ShieldCheck className="h-5 w-5 flex-none" />
            ) : (
              <Clock3 className="h-5 w-5 flex-none" />
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="font-medium">Proposal</span>
            <span className={cn("font-semibold", decision.proposalState === ProposalState.AUTHORIZED ? "text-emerald-700" : decision.proposalState === ProposalState.BLOCKED || decision.proposalState === ProposalState.REJECTED ? "text-red-700" : "text-amber-700")}>
              {workflowActive
                ? "IN REVIEW"
                : decision.proposalState === ProposalState.AUTHORIZED
                ? "RELEASABLE"
                : decision.proposalState === ProposalState.BLOCKED || decision.proposalState === ProposalState.REJECTED
                  ? "LOCKED"
                  : decision.proposalComplete ? "HELD" : "AWAITING PROPOSAL"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">{visibleGovernanceDescription}</p>
        </div>

        {showApprovalCard ? (
          <div className={cn("rounded-xl border p-4", isManagerApproval ? "border-amber-200 bg-amber-50/80" : "border-violet-200 bg-violet-50/80")}>
            <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]", isManagerApproval ? "text-amber-800" : "text-violet-800")}>
              {isManagerApproval ? <BriefcaseBusiness className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              {isManagerApproval ? "Sales Manager approval required" : "Finance approval required"}
            </div>
            <div className={cn("mt-3 space-y-2 text-sm", isManagerApproval ? "text-amber-950" : "text-violet-950")}>
              <div className="flex items-center justify-between"><span>Requested discount</span><strong>{formatPercent(displayDeal.proposedDiscount)}</strong></div>
              <div className="flex items-center justify-between"><span>Financial impact</span><strong>{formatINR(discountAmount)}</strong></div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" onClick={() => onApprove(displayDeal.id)} className={cn("flex-1 text-white", isManagerApproval ? "bg-amber-700 hover:bg-amber-800" : "bg-violet-700 hover:bg-violet-800")}>Approve</Button>
              <Button type="button" variant="outline" onClick={() => onReject(displayDeal.id)} className={cn("flex-1 bg-white", isManagerApproval ? "border-amber-200 text-amber-900 hover:bg-amber-100" : "border-violet-200 text-violet-900 hover:bg-violet-100")}>
                Reject
              </Button>
            </div>
          </div>
        ) : null}

        {hasHumanDecision && !showApprovalCard ? (
          <div className={cn("rounded-xl border p-4 text-sm", decision.proposalState === ProposalState.REJECTED ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>
            <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.14em]">
              {decision.proposalState === ProposalState.REJECTED ? <BadgeAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {decision.proposalState === ProposalState.AUTHORIZED ? "Human approval recorded" : "Rejected"}
            </div>
            <p className="mt-2 leading-relaxed">{decision.description}</p>
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200/80 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            <ArrowRight className="h-3.5 w-3.5" />
            Audit trail
          </div>
          <div className="space-y-3">
            {auditEntries.map((entry, index) => (
              <div key={`${entry.message}-${index}`} className="flex gap-3">
                <div className={cn("mt-1.5 size-2 shrink-0 rounded-full", getAuditTone(entry.tone))} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500">{formatDisplayTime(entry.timestamp)}</p>
                  <p className="text-sm text-slate-700">{entry.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MetricRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 border-t border-slate-200/80 pt-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-slate-900">{value}</p>
      {detail && <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-slate-500">{detail}</p>}
    </div>
  );
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function getBandPosition(discount: number | null): number {
  if (discount === null || Number.isNaN(discount)) return 0;
  const bounded = Math.min(Math.max(discount, 0), 40);
  return (bounded / 40) * 100;
}

function getStatusTone(status: string) {
  switch (status) {
    case "AUTO_APPROVED":
    case "AUTHORIZED / RELEASABLE":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200 border-emerald-200";
    case "SALES MANAGER APPROVAL REQUIRED":
      return "bg-amber-50 text-amber-700 ring-amber-200 border-amber-200";
    case "FINANCE APPROVAL REQUIRED":
    case "FINANCE_APPROVAL_REQUIRED":
      return "bg-violet-50 text-violet-800 ring-violet-200 border-violet-200";
    case "SALES_MANAGER_APPROVAL_REQUIRED":
      return "bg-amber-50 text-amber-700 ring-amber-200 border-amber-200";
    case "BLOCKED":
    case "REJECTED":
      return "bg-red-50 text-red-700 ring-red-200 border-red-200";
    case "REVIEW IN PROGRESS":
    case "REVIEWING DECISION RIGHTS":
      return "bg-sky-50 text-sky-700 ring-sky-200 border-sky-200";
    default:
      return "bg-sky-50 text-sky-700 ring-sky-200 border-sky-200";
  }
}

function getAuditTone(tone: string): string {
  switch (tone) {
    case "authorized":
      return "bg-emerald-500";
    case "blocked":
      return "bg-red-500";
    case "dealguard":
      return "bg-emerald-500";
    case "human":
      return "bg-violet-500";
    default:
      return "bg-sky-500";
  }
}
