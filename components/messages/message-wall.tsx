import { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import { normalizeDealMessage, type DealMessage } from "@/lib/messages";
import type { DealWorkflowPhase } from "@/lib/deals";
import { ArrowDown, ShieldCheck } from "lucide-react";


export function MessageWall({ messages, status, durations, onDurationChange, conversationId, onOptionSelect, workflowPhase = "idle" }: { messages: Array<UIMessage | DealMessage>; status?: string; durations?: Record<string, number>; onDurationChange?: (key: string, duration: number) => void; conversationId?: string; onOptionSelect?: (value: string) => void; workflowPhase?: DealWorkflowPhase }) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    return (
        <div className="relative w-full max-w-[760px]">
            <div className="relative flex flex-col gap-4">
                {messages.map((message, messageIndex) => {
                    const normalizedMessage = normalizeDealMessage(message, {
                        dealId: `wall-${messageIndex}`,
                        actor: message.role === "user" ? "user" : "sales-agent",
                        sequence: messageIndex + 1,
                    });
                    const isLastMessage = messageIndex === messages.length - 1;
                    const key = normalizedMessage.id ?? `message-${messageIndex}-${normalizedMessage.role}`;
                    return (
                        <div key={key} className="w-full">
                            {normalizedMessage.role === "user" ? <UserMessage message={normalizedMessage} /> : <AssistantMessage message={normalizedMessage} status={status} isLastMessage={isLastMessage} durations={durations} onDurationChange={onDurationChange} conversationId={conversationId} onOptionSelect={onOptionSelect} />}
                        </div>
                    );
                })}

                {(workflowPhase === "handoff" || workflowPhase === "dealguard-review") && (
                    <div className="ml-11 flex items-center gap-2 py-1.5 text-xs text-slate-500" role="status" aria-live="polite">
                        {workflowPhase === "handoff" ? (
                            <ArrowDown className="size-3.5 text-sky-700" aria-hidden="true" />
                        ) : (
                            <ShieldCheck className="size-3.5 text-emerald-700" aria-hidden="true" />
                        )}
                        <span>{workflowPhase === "handoff" ? "Submitting proposal to DealGuard" : "DealGuard reviewing decision rights"}</span>
                        <span className="inline-flex items-center gap-1" aria-hidden="true">
                            <span className="size-1 rounded-full bg-slate-400 motion-safe:animate-pulse motion-safe:[animation-delay:0ms] motion-reduce:animate-none" />
                            <span className="size-1 rounded-full bg-slate-400 motion-safe:animate-pulse motion-safe:[animation-delay:150ms] motion-reduce:animate-none" />
                            <span className="size-1 rounded-full bg-slate-400 motion-safe:animate-pulse motion-safe:[animation-delay:300ms] motion-reduce:animate-none" />
                        </span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>
        </div>
    );
}