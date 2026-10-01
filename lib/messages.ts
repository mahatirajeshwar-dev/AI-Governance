import { UIMessage } from "ai";
import { nanoid } from "nanoid";

export type DealMessageActor = "user" | "sales-agent" | "dealguard";

export type DealMessage = UIMessage & {
  actor: DealMessageActor;
  createdAt: string;
  dealId: string;
  sequence: number;
};

export function createDealId(prefix = "deal"): string {
  return `${prefix}-${nanoid(8)}`;
}

export function createDealMessage({
  dealId,
  actor,
  role,
  text,
  sequence,
  id,
}: {
  dealId: string;
  actor: DealMessageActor;
  role: "user" | "assistant";
  text: string;
  sequence: number;
  id?: string;
}): DealMessage {
  return {
    id: id ?? `${dealId}-${actor}-${sequence}`,
    role,
    actor,
    createdAt: new Date().toISOString(),
    dealId,
    sequence,
    parts: [{ type: "text", text }],
  } as DealMessage;
}

export function normalizeDealMessage(
  message: object,
  fallback: { dealId: string; actor?: DealMessageActor; sequence?: number }
): DealMessage {
  const candidate = message as Partial<UIMessage> & Partial<DealMessage> & Record<string, unknown>;

  const safeParts = Array.isArray(candidate.parts)
    ? candidate.parts.filter(
        (part): part is UIMessage["parts"][number] =>
          typeof part === "object" && part !== null && "type" in part && typeof part.type === "string"
      )
    : typeof (candidate as { content?: string }).content === "string"
      ? [{ type: "text", text: (candidate as { content: string }).content }]
      : [];

  const actor = candidate.actor ?? fallback.actor ?? "sales-agent";
  const sequence = typeof candidate.sequence === "number" ? candidate.sequence : fallback.sequence ?? 0;
  const safeId = typeof candidate.id === "string" && candidate.id ? candidate.id : `${fallback.dealId}-${actor}-${sequence}`;

  return {
    id: safeId,
    role: candidate.role === "user" ? "user" : "assistant",
    actor,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    dealId: candidate.dealId ?? fallback.dealId,
    sequence,
    parts: safeParts,
  } as DealMessage;
}
