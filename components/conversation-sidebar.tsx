"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Deal } from "@/lib/deals";
import { BriefcaseBusiness, Plus, ShieldCheck } from "lucide-react";

export function ConversationSidebar({
  deals,
  activeDealId,
  onSelectDeal,
  onNewDeal,
  onClose,
}: {
  deals: Deal[];
  activeDealId: string | null;
  onSelectDeal: (id: string) => void;
  onNewDeal: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-64 flex-col border-r bg-background">
      <div className="border-b p-3 pt-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
          <span className="text-sm font-semibold">Deals</span>
        </div>
        <Button variant="outline" size="sm" className="mt-3 w-full justify-start" onClick={onNewDeal} aria-label="New deal">
          <Plus className="size-4" /> New Deal
        </Button>
      </div>

      <div className="border-b px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Active deals</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {deals.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No deals yet</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {deals.map((deal) => {
              const isReviewing = deal.workflowPhase === "sales-agent" || deal.workflowPhase === "handoff" || deal.workflowPhase === "dealguard-review";
              const dealTone = isReviewing
                ? "border-sky-200 bg-sky-50 text-sky-700"
                :
                deal.governanceDecision.proposalState === "BLOCKED"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : deal.governanceDecision.proposalState === "REJECTED"
                    ? "border-red-200 bg-red-50 text-red-700"
                  : deal.governanceDecision.proposalState === "AUTHORIZED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : deal.governanceDecision.authorityStatus === "FINANCE_APPROVAL_REQUIRED"
                      ? "border-violet-200 bg-violet-50 text-violet-800"
                    : deal.governanceDecision.proposalState === "HELD"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-50 text-slate-600";

              return (
                <button
                  key={deal.id}
                  onClick={() => {
                    onSelectDeal(deal.id);
                    onClose();
                  }}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-slate-50",
                    activeDealId === deal.id && "border-slate-300 bg-slate-100/80"
                  )}
                >
                  <div className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                    <BriefcaseBusiness className="size-3.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{deal.customerName}</span>
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em]", dealTone)}>
                        {isReviewing
                          ? "reviewing"
                          : deal.governanceDecision.proposalState === "AUTHORIZED"
                          ? "ok"
                          : deal.governanceDecision.proposalState === "BLOCKED"
                            ? "blocked"
                            : deal.governanceDecision.proposalState === "REJECTED"
                              ? "rejected"
                            : deal.governanceDecision.proposalState === "HELD"
                              ? "held"
                              : "new"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {isReviewing
                        ? `${deal.proposedDiscount ?? ""}% · REVIEWING`
                        : deal.proposedDiscount !== null
                        ? `${deal.proposedDiscount}% · ${deal.governanceDecision.status}`
                        : deal.governanceDecision.status}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          DealGuard review
        </div>
      </div>
    </div>
  );
}
