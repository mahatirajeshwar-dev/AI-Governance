"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Download,
  FileText,
  Mic,
  PanelLeft,
  ShieldCheck,
  Square,
} from "lucide-react";
import { ThinkingIndicator } from "@/components/ai-elements/thinking-indicator";
import { MessageWall } from "@/components/messages/message-wall";
import { ChatHeader, ChatHeaderBlock } from "@/app/parts/chat-header";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  AI_DESCRIPTION,
  AI_NAME,
  OWNER_NAME,
  WELCOME_MESSAGE,
  COMPACTION_ENABLED,
  COMPACTION_TOKEN_THRESHOLD,
  COMPACTION_SHOW_CONTEXT_MEMORY,
  MAX_MESSAGE_TEXT_LENGTH,
} from "@/config";
import Link from "next/link";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import {
  createConversation,
  loadConversationData,
  saveConversationData,
  migrateFromLegacyStorage,
  listConversations,
  loadCompactedSummary,
  saveCompactedSummary,
  loadFeedback,
  loadDealWorkspace,
  saveDealWorkspace,
} from "@/lib/storage";
import { GovernancePanel } from "@/components/dealguard/governance-panel";
import {
  createBlankDeal,
  createDemoDeals,
  hasCompleteProposal,
  hasProposalDetails,
  parseCommercialRequest,
  processCommercialMessage,
  setDealApproval,
  setDealWorkflowPhase,
  type DealWorkflowPhase,
  type Deal,
} from "@/lib/deals";
import { createDealId, createDealMessage, normalizeDealMessage } from "@/lib/messages";

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    // Same limit the server enforces (config.ts), so the form never accepts
    // a message the API would reject.
    .max(MAX_MESSAGE_TEXT_LENGTH, `Message must be at most ${MAX_MESSAGE_TEXT_LENGTH} characters.`),
});

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[]>(() => createDemoDeals());
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [dealStorageReady, setDealStorageReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showContextMemory, setShowContextMemory] = useState(false);
  const welcomeMessageShownRef = useRef<boolean>(false);

  useEffect(() => {
    if (!selectedDealId && deals[0]) {
      setSelectedDealId(deals[0].id);
    }

    if (selectedDealId && !deals.some((deal) => deal.id === selectedDealId) && deals[0]) {
      setSelectedDealId(deals[0].id);
    }
  }, [deals, selectedDealId]);

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId) ?? deals[0] ?? null;
  const workflowBusy = selectedDeal !== null && ["sales-agent", "handoff", "dealguard-review"].includes(selectedDeal.workflowPhase);

  // Compaction state: stored summary persists across requests
  const summaryRef = useRef<{ summary: string; summarizedUpTo: number; signature: string } | null>(null);
  const activeConvIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  // Load stored summary when conversation changes
  useEffect(() => {
    if (isClient && activeConvId) {
      const stored = loadCompactedSummary(activeConvId);
      summaryRef.current = stored;
    }
  }, [isClient, activeConvId]);

  const { sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (url, options) => {
        const headers = new Headers(options?.headers);
        if (summaryRef.current) {
          headers.set("X-Compacted-Summary", btoa(unescape(encodeURIComponent(summaryRef.current.summary))));
          headers.set("X-Compacted-UpTo", String(summaryRef.current.summarizedUpTo));
          headers.set("X-Compacted-Signature", summaryRef.current.signature);
        }
        if (activeConvIdRef.current) {
          const fb = loadFeedback(activeConvIdRef.current);
          if (Object.keys(fb).length > 0) {
            headers.set("X-Feedback", btoa(JSON.stringify(fb)));
          }
        }
        const response = await fetch(url, { ...options, headers });

        const newSummaryB64 = response.headers.get("X-Compacted-Summary");
        const newUpTo = response.headers.get("X-Compacted-UpTo");
        const newSignature = response.headers.get("X-Compacted-Signature");
        if (newSummaryB64 && newUpTo && newSignature && activeConvIdRef.current) {
          try {
            const summary = decodeURIComponent(escape(atob(newSummaryB64)));
            const summarizedUpTo = parseInt(newUpTo, 10);
            summaryRef.current = { summary, summarizedUpTo, signature: newSignature };
            saveCompactedSummary(activeConvIdRef.current, summary, summarizedUpTo, newSignature);
          } catch (e) {
            console.warn("Compaction save failed:", e);
          }
        }

        return response;
      },
    }),
    experimental_throttle: 50,
    onFinish(event) {
      const targetDealId = selectedDealId;
      if (!targetDealId) return;
      setDeals((prev) =>
        prev.map((deal) => {
          if (deal.id !== targetDealId) return deal;
          const storedMessage = normalizeDealMessage(event.message, {
            dealId: targetDealId,
            actor: "sales-agent",
            sequence: deal.messages.length + 1,
          });
          const hasContent = storedMessage.parts.some((part) =>
            part.type === "text" ? Boolean(part.text.trim()) : true
          );
          if (!hasContent) return deal;
          return {
            ...deal,
            messages: [...deal.messages, storedMessage],
          };
        })
      );
    },
    onError(error) {
      toast.error(error.message || "Something went wrong. Please try again.");
    },
  });

  // Initialize: migrate legacy storage, load or create conversation
  useEffect(() => {
    setIsClient(true);

    try {
      const storedDeals = loadDealWorkspace();
      if (storedDeals) {
        setDeals(storedDeals.deals);
        setSelectedDealId(storedDeals.selectedDealId);
      } else {
        const demoDeals = createDemoDeals();
        setDeals(demoDeals);
        saveDealWorkspace({ deals: demoDeals, selectedDealId: demoDeals[0]?.id ?? null });
        setSelectedDealId(demoDeals[0]?.id ?? null);
      }
      setDealStorageReady(true);
    } catch (error) {
      console.error("Deal workspace restore failed:", error);
      toast.error("Saved deals could not be restored. Your stored data was left unchanged.");
    }

    // Migrate from old single-chat format if present
    const migratedId = migrateFromLegacyStorage();

    const convs = listConversations();
    let convId: string;

    if (migratedId) {
      convId = migratedId;
    } else if (convs.length > 0) {
      convId = convs[0].id; // most recent
    } else {
      const newConv = createConversation();
      convId = newConv.id;
    }

    setActiveConvId(convId);
    const data = loadConversationData(convId);
    setMessages(data.messages);
    setDurations(data.durations);

    // Show welcome message if this is a fresh conversation
    if (data.messages.length === 0 && !welcomeMessageShownRef.current) {
      const welcomeMessage = createDealMessage({
        dealId: createDealId("welcome"),
        actor: "dealguard",
        role: "assistant",
        text: WELCOME_MESSAGE,
        sequence: 1,
      });
      setMessages([welcomeMessage]);
      saveConversationData(convId, {
        messages: [welcomeMessage],
        durations: {},
      });
      welcomeMessageShownRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!dealStorageReady) return;
    try {
      saveDealWorkspace({ deals, selectedDealId });
    } catch (error) {
      console.error("Deal workspace save failed:", error);
      toast.error("Deal changes could not be saved to this browser.");
    }
  }, [dealStorageReady, deals, selectedDealId]);

  const activeDealMessages = selectedDeal?.messages ?? [];
  const visibleDealMessages = activeDealMessages.filter((message) =>
    message.id !== selectedDeal?.pendingDealGuardMessageId || selectedDeal.workflowPhase === "complete"
  );

  // Compaction notification is handled by the model in its response text
  // (server instructs the model to include a notice when compaction occurs)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { message: "" },
  });

  // Shared send path for both the text form and quick-reply option chips.
  function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !/[a-z0-9]/i.test(trimmed) || !selectedDealId || workflowBusy || status === "streaming" || status === "submitted") return;

    const parsedProposal = parseCommercialRequest(trimmed);
    const isProposalTurn = hasProposalDetails(parsedProposal) || Boolean(
      selectedDeal && hasProposalDetails(selectedDeal) && !hasCompleteProposal(selectedDeal)
    );

    if (isProposalTurn) {
      const targetDealId = selectedDealId;
      const targetDeal = selectedDeal;
      if (!targetDeal) return;
      const processedDeal = processCommercialMessage(targetDeal, trimmed);
      setDeals((prev) => prev.map((deal) => deal.id === targetDealId ? processedDeal : deal));

      if (processedDeal.workflowPhase === "sales-agent") {
        const transition = (expected: DealWorkflowPhase, next: DealWorkflowPhase) => {
          setDeals((prev) => prev.map((deal) =>
            deal.id === targetDealId && deal.workflowPhase === expected
              ? setDealWorkflowPhase(deal, next)
              : deal
          ));
        };
        window.setTimeout(() => {
          transition("sales-agent", "handoff");
          window.setTimeout(() => {
            transition("handoff", "dealguard-review");
            window.setTimeout(() => transition("dealguard-review", "complete"), 530);
          }, 280);
        }, 140);
      }
      return;
    }

    const dealSequence = (selectedDeal?.messages.length ?? 0) + 1;
    const userMessage = createDealMessage({
      dealId: selectedDealId,
      actor: "user",
      role: "user",
      text: trimmed,
      sequence: dealSequence,
    });

    setDeals((prev) =>
      prev.map((deal) =>
        deal.id === selectedDealId
          ? {
              ...deal,
              messages: [...deal.messages, userMessage],
            }
          : deal
      )
    );

    const s = summaryRef.current;
    sendMessage({
      text: trimmed,
      body: s ? { compactedSummary: s.summary, summarizedUpTo: s.summarizedUpTo } : undefined,
    } as any);
  }

  function onSubmit(data: z.infer<typeof formSchema>) {
    sendText(data.message);
    form.reset();
  }

  // Tapping a quick-reply chip sends it immediately, same as typing + Enter.
  function handleOptionSelect(value: string) {
    sendText(value);
  }

  // --- Voice input (Web Speech API) ---
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    setVoiceSupported(
      typeof window !== "undefined" &&
        !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }, []);

  function toggleVoiceInput() {
    const SpeechRecognition =
      typeof window !== "undefined" &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    if (!SpeechRecognition) {
      toast.error("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      form.setValue("message", transcript, { shouldValidate: true, shouldDirty: true });
    };
    recognition.onerror = () => {
      setIsListening(false);
      toast.error("Couldn't hear that — please try again or type instead.");
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  useEffect(() => {
    // Stop listening if the component unmounts mid-recognition.
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  function switchConversation(id: string) {
    setActiveConvId(id);
    const data = loadConversationData(id);
    setMessages(data.messages);
    setDurations(data.durations);
    welcomeMessageShownRef.current = true;
  }

  function newDeal() {
    const existingDraft = deals.find(
      (deal) =>
        deal.customerName === "—" &&
        deal.quantity === null &&
        deal.proposedDiscount === null
    );

    if (existingDraft) {
      setSelectedDealId(existingDraft.id);
      toast.success("Blank draft reused");
      return;
    }

    const freshDeal = createBlankDeal(createDealId("deal"));
    setDeals((prev) => [freshDeal, ...prev]);
    setSelectedDealId(freshDeal.id);
    toast.success("New deal opened");
  }

  function handleApproveDeal(dealId: string) {
    setDeals((prev) => prev.map((deal) => deal.id === dealId ? setDealApproval(deal, "APPROVED") : deal));
  }

  function handleRejectDeal(dealId: string) {
    setDeals((prev) => prev.map((deal) => deal.id === dealId ? setDealApproval(deal, "REJECTED") : deal));
  }

  function exportChat() {
    const dealMessages = selectedDeal?.messages ?? [];
    if (dealMessages.length === 0) {
      toast.error("No messages to export");
      return;
    }

    const markdown = dealMessages
      .map((msg) => {
        const role = msg.role === "user" ? "You" : AI_NAME;
        const text = msg.parts
          .filter((p) => p.type === "text")
          .map((p: any) => p.text)
          .join("\n");
        return `### ${role}\n\n${text}`;
      })
      .join("\n\n---\n\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${AI_NAME}-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Chat exported");
  }

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        (status === "streaming" || status === "submitted")
      ) {
        e.preventDefault();
        stop();
      }
    },
    [status, stop]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen font-sans dark:bg-black">
      {isClient && (
        <aside className="hidden h-screen w-64 shrink-0 md:block">
          <ConversationSidebar
            deals={deals}
            activeDealId={selectedDealId}
            onSelectDeal={setSelectedDealId}
            onNewDeal={newDeal}
            onClose={() => {}}
          />
        </aside>
      )}
      {isClient && sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-50 md:hidden">
            <ConversationSidebar
              deals={deals}
              activeDealId={selectedDealId}
              onSelectDeal={(id) => {
                setSelectedDealId(id);
                setSidebarOpen(false);
              }}
              onNewDeal={() => {
                newDeal();
                setSidebarOpen(false);
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </>
      )}

      <main className="relative flex h-screen min-w-0 flex-1 flex-col overflow-y-auto xl:overflow-hidden">
        <div className="sticky top-0 z-50 shrink-0 border-b border-border/70 bg-background/95 backdrop-blur-sm">
          <ChatHeader>
            <ChatHeaderBlock>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden"
                onClick={() => setSidebarOpen((prev) => !prev)}
                aria-label="Open deals"
              >
                <PanelLeft className="size-4" />
              </Button>
            </ChatHeaderBlock>
            <ChatHeaderBlock className="justify-center items-center gap-2">
              <div className="flex items-center gap-3 text-sm font-semibold text-foreground/80">
                <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                  <ShieldCheck className="size-3.5" />
                </span>
                <div className="flex flex-col leading-none">
                  <span>{AI_NAME}</span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{AI_DESCRIPTION}</span>
                </div>
              </div>
            </ChatHeaderBlock>

            <ChatHeaderBlock className="justify-end gap-2">
              {(() => {
                if (!COMPACTION_SHOW_CONTEXT_MEMORY) return null;
                const cs = activeConvId ? loadCompactedSummary(activeConvId) : null;
                if (!cs) return null;
                return (
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowContextMemory(!showContextMemory)}
                      aria-label="Context Memory"
                      className="h-8 w-8"
                      title={`Context Memory (${cs.summarizedUpTo} messages summarized)`}
                    >
                      <FileText className="size-4" />
                    </Button>
                    {showContextMemory && (
                      <div className="absolute right-0 top-10 z-50 w-80 max-h-64 overflow-y-auto rounded-md border bg-background p-3 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium">Context Memory</span>
                          <span className="text-[10px] text-muted-foreground">{cs.summarizedUpTo} messages summarized</span>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                          {cs.summary}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
              <Button
                variant="ghost"
                size="icon"
                onClick={exportChat}
                aria-label="Export chat"
                className="h-8 w-8"
              >
                <Download className="size-4" />
              </Button>
            </ChatHeaderBlock>
          </ChatHeader>
        </div>

        <div className="min-h-0 flex-1 px-3 py-4 sm:px-5 xl:overflow-hidden xl:px-6 xl:py-6">
          <div className="mx-auto grid min-h-full w-full max-w-[1480px] grid-cols-1 gap-6 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_minmax(400px,480px)] xl:gap-6">
            <section className="flex min-w-0 flex-col xl:min-h-0">
              <div className="min-w-0 flex-1 xl:min-h-0 xl:overflow-y-auto xl:pr-2">
                {isClient && (
                  <>
                    <MessageWall
                      messages={visibleDealMessages}
                      status={status}
                      workflowPhase={selectedDeal?.workflowPhase}
                      durations={durations}
                      conversationId={selectedDeal?.id ?? undefined}
                      onDurationChange={(k, d) =>
                        setDurations((prev) => ({
                          ...prev,
                          [k]: d,
                        }))
                      }
                      onOptionSelect={handleOptionSelect}
                    />
                    {status === "submitted" && (
                      <div className="w-full max-w-[760px]">
                        <ThinkingIndicator isCompacting={(() => {
                          if (!COMPACTION_ENABLED || activeDealMessages.length <= 4) return false;
                          let chars = 0;
                          for (const msg of activeDealMessages) {
                            for (const part of msg.parts) {
                              const p = part as any;
                              chars += p.type === "text" ? (p.text?.length ?? 0) : JSON.stringify(p).length;
                            }
                          }
                          return Math.ceil(chars / 4) >= COMPACTION_TOKEN_THRESHOLD;
                        })()} />
                      </div>
                    )}
                  </>
                )}
              </div>
              <form className="shrink-0 pt-3" onSubmit={form.handleSubmit(onSubmit)}>
                <Controller
                  name="message"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <div className="relative">
                      <Textarea
                        {...field}
                        rows={1}
                        className="min-h-14 max-h-48 resize-none overflow-y-auto rounded-2xl bg-white pl-4 pr-24 py-4 leading-5 shadow-sm border border-slate-300/80 focus-visible:ring-sky-600/30"
                        placeholder={isListening ? "Listening..." : "Describe a customer deal or reply to the Sales Agent..."}
                        disabled={workflowBusy || status === "streaming" || status === "submitted"}
                        aria-label="Message"
                        aria-invalid={fieldState.invalid}
                        autoComplete="off"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            form.handleSubmit(onSubmit)();
                          }
                        }}
                      />
                      {voiceSupported && (
                        <Button
                          className={`absolute bottom-2.5 right-12 rounded-lg ${isListening ? "animate-pulse" : ""}`}
                          type="button"
                          variant={isListening ? "default" : "ghost"}
                          size="icon"
                          disabled={workflowBusy || status === "streaming" || status === "submitted"}
                          onClick={toggleVoiceInput}
                          aria-pressed={isListening}
                          aria-label={isListening ? "Stop voice input" : "Start voice input"}
                          title={isListening ? "Stop voice input" : "Speak your message"}
                        >
                          <Mic className="size-4" />
                        </Button>
                      )}
                      {(status === "ready" || status === "error") && (
                        <Button
                          className="absolute bottom-2.5 right-2 rounded-lg bg-sky-700 text-white hover:bg-sky-800"
                          type="submit"
                          disabled={workflowBusy || !field.value?.trim()}
                          size="icon"
                          aria-label="Send message"
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                      )}
                      {(status === "streaming" || status === "submitted") && (
                        <Button
                          className="absolute bottom-2.5 right-2 rounded-lg"
                          size="icon"
                          type="button"
                          onClick={() => stop()}
                          aria-label="Stop response"
                        >
                          <Square className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                />
              </form>
              <div className="shrink-0 pt-2 text-center text-[11px] text-muted-foreground">
                &copy; {new Date().getFullYear()} {OWNER_NAME}{" "}
                <Link href="/terms" className="underline">Terms of Use</Link>{" "}
                Powered by{" "}
                <Link href="https://www.ringel.ai" className="underline">ringel.AI</Link>
              </div>
            </section>

            <div className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
              <GovernancePanel
                deal={selectedDeal}
                onApprove={handleApproveDeal}
                onReject={handleRejectDeal}
              />
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
