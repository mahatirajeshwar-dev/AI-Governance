import { UIMessage } from "ai";
import { Response } from "@/components/ai-elements/response";
import { normalizeDealMessage, type DealMessage } from "@/lib/messages";

export function UserMessage({ message }: { message: UIMessage | DealMessage }) {
    const safeMessage = normalizeDealMessage(message, {
        dealId: "unknown-deal",
        actor: "user",
        sequence: 0,
    });
    const parts = Array.isArray(safeMessage.parts) ? safeMessage.parts : [];

    return (
        <div className="whitespace-pre-wrap w-full flex justify-end">
            <div className="w-fit max-w-[75%] break-words rounded-2xl border border-sky-200/70 bg-sky-50/80 px-4 py-3 shadow-sm shadow-slate-900/[0.025]">
                <div className="text-sm">
                    {parts.map((part, i) => {
                        if (part.type !== "text") return null;
                        return <Response key={`${safeMessage.id}-${i}`}>{part.text}</Response>;
                    })}
                </div>
            </div>
        </div>
    )
}