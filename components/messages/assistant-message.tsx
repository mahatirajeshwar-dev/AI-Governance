"use client";

import { UIMessage, ToolCallPart, ToolResultPart } from "ai";
import { Response } from "@/components/ai-elements/response";
import { ReasoningPart } from "./reasoning-part";
import { ToolCall, ToolResult } from "./tool-call";
import { Sources } from "./sources";
import { rewriteCitationsInParts } from "@/lib/citations";
import { extractQuickOptions } from "@/lib/quick-options";
import { QuickOptions } from "./quick-options";
import type { UISource } from "@/types/data";
import { AssemblingIndicator } from "../ai-elements/assembling-indicator";
import { ProcessingIndicator } from "../ai-elements/processing-indicator";
import { ThumbsUp, ThumbsDown, ShieldCheck, BriefcaseBusiness, CheckCircle2, Clock3, BadgeAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { saveFeedback, loadFeedback } from "@/lib/storage";
import { normalizeDealMessage, type DealMessage } from "@/lib/messages";

function FeedbackButtons({ messageId, conversationId }: { messageId: string; conversationId?: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(() => {
    if (!conversationId) return null;
    const fb = loadFeedback(conversationId);
    return fb[messageId] || null;
  });

  async function submitFeedback(value: "up" | "down") {
    const newRating = rating === value ? null : value;
    setRating(newRating);
    if (conversationId && newRating) {
      saveFeedback(conversationId, messageId, newRating);
    }
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating: newRating }),
      });
    } catch {
      // Silently fail — feedback is non-critical
    }
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <Button
        variant="ghost"
        size="icon"
        className={`h-7 w-7 ${rating === "up" ? "text-green-600" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => submitFeedback("up")}
        aria-label="Good response"
      >
        <ThumbsUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={`h-7 w-7 ${rating === "down" ? "text-red-600" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => submitFeedback("down")}
        aria-label="Bad response"
      >
        <ThumbsDown className="size-3.5" />
      </Button>
    </div>
  );
}

function parseProposalCard(text: string): {
  fields: Array<[string, string]>;
  handoff: string;
  recommendation?: { discount: string; rationale: string };
} | null {
  const lines = text.split("\n");
  const actionIndex = lines.indexOf("Proposed Commercial Action");
  if (actionIndex < 0) return null;
  const fields = lines.slice(actionIndex + 1).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0 || line.startsWith("Submitting ")) return [];
    const originalLabel = line.slice(0, separator);
    const label = originalLabel === "Discount Source" ? "Source" : originalLabel;
    const value = line.slice(separator + 1).trim();
    return label === "Source"
      ? [[label, value === "AI Recommendation" ? "AI Recommendation" : "Customer Requested"] as [string, string]]
      : [[label, value] as [string, string]];
  });
  const handoff = lines.find((line) => line.startsWith("Submitting "));
  if (fields.length < 4 || !handoff) return null;

  const recommendationIndex = lines.indexOf("Discount Recommendation");
  if (recommendationIndex < 0) return { fields, handoff };
  const discountLine = lines.slice(recommendationIndex + 1, actionIndex).find((line) => line.startsWith("Recommended Discount:"));
  const rationaleLine = lines.slice(recommendationIndex + 1, actionIndex).find((line) => line.startsWith("Rationale:"));
  if (!discountLine || !rationaleLine) return { fields, handoff };
  return {
    fields,
    handoff,
    recommendation: {
      discount: discountLine.slice("Recommended Discount:".length).trim(),
      rationale: rationaleLine.slice("Rationale:".length).trim(),
    },
  };
}

function parseDecisionCard(text: string): { status: string; details: string; proposal: string } | null {
  const lines = text.split("\n").filter(Boolean);
  if (lines[0] !== "Governance Review" || lines.length < 4) return null;
  const proposalIndex = lines.findIndex((line) => line.startsWith("Proposal:"));
  if (proposalIndex < 3) return null;
  return {
    status: lines[1],
    details: lines.slice(2, proposalIndex).join(" "),
    proposal: lines[proposalIndex].slice("Proposal:".length).trim(),
  };
}

function getDecisionTone(status: string) {
  if (status === "BLOCKED") {
    return { surface: "border-red-200/80 bg-red-50/50", text: "text-red-800", pill: "border-red-200 bg-red-50 text-red-800" };
  }
  if (status === "AUTHORIZED / RELEASABLE") {
    return { surface: "border-emerald-200/80 bg-emerald-50/45", text: "text-emerald-800", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (status === "FINANCE APPROVAL REQUIRED") {
    return { surface: "border-violet-200/80 bg-violet-50/45", text: "text-violet-800", pill: "border-violet-200 bg-violet-50 text-violet-800" };
  }
  return { surface: "border-amber-200/80 bg-amber-50/45", text: "text-amber-800", pill: "border-amber-200 bg-amber-50 text-amber-800" };
}

export function AssistantMessage({
  message,
  status,
  isLastMessage,
  durations,
  onDurationChange,
  conversationId,
  onOptionSelect,
}: {
  message: UIMessage | DealMessage;
  status?: string;
  isLastMessage?: boolean;
  durations?: Record<string, number>;
  onDurationChange?: (key: string, duration: number) => void;
  conversationId?: string;
  onOptionSelect?: (value: string) => void;
}) {
  const normalizedMessage = normalizeDealMessage(message, {
    dealId: "unknown-deal",
    actor: "sales-agent",
    sequence: 0,
  });
  const parts = Array.isArray(normalizedMessage.parts) ? normalizedMessage.parts : [];
  const isStreaming = status === "streaming" && isLastMessage;
  const showFeedback = !isStreaming && parts.some((p) => p.type === "text");

  // Structured Sources box, rendered from the `data-sources` stream part
  // (independent of the model's markdown). Empty until the response finishes.
  const sourcesPart = parts.find((p) => p.type === "data-sources") as
    | { type: "data-sources"; data: UISource[] }
    | undefined;
  const sources = sourcesPart?.data ?? [];

  // Canonicalize citations across ALL text parts with shared numbering state —
  // the same transform the server runs on the joined text to build the Sources
  // box, so inline numbers and box numbers agree by construction.
  const textPartIndexes: number[] = [];
  parts.forEach((p, i) => {
    if (p.type === "text") textPartIndexes.push(i);
  });
  const rewrittenTexts = rewriteCitationsInParts(
    textPartIndexes.map((i) => (parts[i] as { text: string }).text)
  );
  const rewrittenByIndex = new Map<number, string>(
    textPartIndexes.map((partIndex, j) => [partIndex, rewrittenTexts[j]])
  );

  // Track which parts come after tool calls
  const hasToolBefore = new Set<number>();
  let seenTool = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type?.startsWith("tool-") || p.type === "dynamic-tool") {
      seenTool = true;
    } else if (seenTool && (p.type === "reasoning" || p.type === "text")) {
      hasToolBefore.add(i);
    }
  }

  // Check if there's any tool or reasoning in the message
  const hasContentBefore = parts.some(
    (p) => p.type === "reasoning" || p.type?.startsWith("tool-") || p.type === "dynamic-tool"
  );

  // Find the last text part index
  let lastTextIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === "text") {
      lastTextIndex = i;
      break;
    }
  }

  const isDealGuardMessage = normalizedMessage.actor === "dealguard";

  return (
    <div className={`w-full max-w-[90%] flex gap-3 ${isDealGuardMessage ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-reduce:animate-none" : ""}`}>
      <div className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${isDealGuardMessage ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground"}`}>
        {isDealGuardMessage ? <ShieldCheck className="size-4" /> : <BriefcaseBusiness className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span className={isDealGuardMessage ? "text-emerald-700" : "text-sky-700"}>{isDealGuardMessage ? "DealGuard" : "AI Sales Agent"}</span>
      </div>
      <div className="text-sm flex flex-col gap-4">
        {parts.map((part, i) => {
          const isPartStreaming =
            isStreaming && i === parts.length - 1;
          const durationKey = `${normalizedMessage.id}-${i}`;
          const duration = durations?.[durationKey];

          if (part.type === "text") {
            const isLastText = i === lastTextIndex;
            const isAfterTool = hasToolBefore.has(i);
            // Check if there's already an intermediate text part after tools (processing already shown)
            const hasIntermediateProcessingText = isLastText && seenTool && parts.some(
              (p, idx) => idx < i && p.type === "text" && hasToolBefore.has(idx)
            );
            const rawText = rewrittenByIndex.get(i) ?? part.text;
            // Quick-reply chips: only parsed off the last text part of the
            // live (last) message, and only once it's done streaming — a
            // partial "OPTIONS:" block mid-stream should render as plain text.
            const canShowOptions =
              isLastText && isLastMessage && !isStreaming && !!onOptionSelect;
            const { text: displayText, options } = canShowOptions
              ? extractQuickOptions(rawText)
              : { text: rawText, options: [] as string[] };
            const proposalCard = normalizedMessage.actor === "sales-agent"
              ? parseProposalCard(displayText)
              : null;
            const decisionCard = normalizedMessage.actor === "dealguard"
              ? parseDecisionCard(displayText)
              : null;
            if (proposalCard) {
              return (
                <div key={`${normalizedMessage.id}-${i}`} className="rounded-xl border border-sky-200/70 bg-white px-4 py-3.5 shadow-sm shadow-slate-900/[0.025]">
                  {proposalCard.recommendation && (
                    <div className="mb-3 border-b border-sky-100 pb-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800">Discount Recommendation</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">Recommended Discount: {proposalCard.recommendation.discount}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{proposalCard.recommendation.rationale}</p>
                    </div>
                  )}
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-800">Proposed Commercial Action</p>
                  <dl className="mt-3 space-y-2">
                    {proposalCard.fields.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                        <dt className="text-xs text-slate-500">{label}</dt>
                        <dd className="text-right text-sm font-medium text-slate-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs leading-relaxed text-slate-600">{proposalCard.handoff}</p>
                </div>
              );
            }
            if (decisionCard) {
              const decisionTone = getDecisionTone(decisionCard.status);
              const DecisionIcon = decisionCard.status === "BLOCKED" ? BadgeAlert
                : decisionCard.status === "AUTHORIZED / RELEASABLE" ? CheckCircle2 : Clock3;
              return (
                <div key={`${normalizedMessage.id}-${i}`} className={`rounded-xl border px-4 py-3.5 ${decisionTone.surface}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Governance Review</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${decisionTone.pill}`}>
                      <DecisionIcon className="mr-1 inline size-3" />{decisionCard.proposal}
                    </span>
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${decisionTone.text}`}>{decisionCard.status}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{decisionCard.details}</p>
                </div>
              );
            }
            return (
              <div key={`${normalizedMessage.id}-${i}`}>
                {isLastText && isAfterTool && !hasIntermediateProcessingText && (
                  <ProcessingIndicator isStreaming={false} />
                )}
                {isLastText && hasContentBefore && (
                  <AssemblingIndicator isStreaming={isPartStreaming} />
                )}
                {!isLastText && isAfterTool && (
                  <ProcessingIndicator isStreaming={isPartStreaming} />
                )}
                <div className={`rounded-xl border px-4 py-3 shadow-sm shadow-slate-900/[0.025] ${isDealGuardMessage ? "border-emerald-200/70 bg-white" : "border-sky-200/70 bg-white"}`}>
                  <Response isAnimating={isPartStreaming}>
                    {displayText}
                  </Response>
                </div>
                {options.length > 0 && (
                  <QuickOptions options={options} onSelect={onOptionSelect!} />
                )}
              </div>
            );
          } else if (part.type === "reasoning") {
            return (
              <ReasoningPart
                key={`${normalizedMessage.id}-${i}`}
                part={part}
                isStreaming={isPartStreaming}
                category={hasToolBefore.has(i) ? "processing" : "thinking"}
                duration={duration}
                onDurationChange={
                  onDurationChange
                    ? (d) => onDurationChange(durationKey, d)
                    : undefined
                }
              />
            );
          } else if (
            part.type.startsWith("tool-") ||
            part.type === "dynamic-tool"
          ) {
            if ("state" in part && part.state === "output-available") {
              return (
                <ToolResult
                  key={`${normalizedMessage.id}-${i}`}
                  part={part as unknown as ToolResultPart}
                />
              );
            } else {
              return (
                <ToolCall
                  key={`${normalizedMessage.id}-${i}`}
                  part={part as unknown as ToolCallPart}
                />
              );
            }
          }
          return null;
        })}
      </div>
      {sources.length > 0 && <Sources sources={sources} />}
      {showFeedback && <FeedbackButtons messageId={normalizedMessage.id} conversationId={conversationId} />}
      </div>
    </div>
  );
}
