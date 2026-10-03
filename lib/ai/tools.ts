import { type ToolSet } from "ai";
import { calculateDeal, checkDiscountAuthority } from "@/app/api/chat/tools/deal-tools";
import { createWebSearch } from "@/app/api/chat/tools/web-search";
import { createFetchOwnerProfiles } from "@/app/api/chat/tools/fetch-owner-profiles";
import { createVectorDatabaseSearch } from "@/app/api/chat/tools/search-vector-database";
import { UNIT_PRICE } from "@/lib/pricing";
import {
  ENABLE_WEB_SEARCH,
  ENABLE_VECTOR_SEARCH,
  MAX_KB_SEARCHES,
  MAX_WEB_SEARCHES,
  OWNER_PROFILE_SOURCES,
} from "@/config";

// fetchOwnerProfiles only makes sense when there are owner profile pages
// configured (e.g. a personal-assistant deployment). For deployments like a
// product/sales advisor with no single "owner", leave OWNER_PROFILE_SOURCES
// empty in config.ts and this tool is skipped automatically.
const HAS_OWNER_PROFILES = OWNER_PROFILE_SOURCES.length > 0;
import type { UISource } from "@/types/data";

/** Collector callback: the source plus its retrieved text (for claim verification). */
export type CollectSource = (s: UISource, content?: string) => void;

/**
 * Assembles the enabled tool set. `collect` is called by each tool for every
 * source it uses, feeding the code-rendered Sources box; the optional content
 * is the text the model saw, used to verify citation claims. Pass a no-op to
 * ignore sources.
 */
export function buildToolSet(collect: CollectSource = () => {}): ToolSet {
  return {
    calculateDeal,
    checkDiscountAuthority,
    ...(ENABLE_VECTOR_SEARCH ? { vectorDatabaseSearch: createVectorDatabaseSearch(collect) } : {}),
    ...(ENABLE_WEB_SEARCH
      ? {
          webSearch: createWebSearch(collect),
          ...(HAS_OWNER_PROFILES
            ? { fetchOwnerProfiles: createFetchOwnerProfiles(collect) }
            : {}),
        }
      : {}),
  };
}

export function buildToolGuidance(): string {
  const sections: string[] = [
    `GOVERNANCE TOOLS GUIDANCE:
- checkDiscountAuthority:
  * MUST be called for ANY authorization or decision-rights determination.
  * Evaluates policy thresholds deterministically:
    - <= 10%: AUTO_APPROVED (AI Delegated Authority)
    - > 10% and <= 20%: SALES_MANAGER_APPROVAL_REQUIRED (Sales Manager approval required)
    - > 20% and <= 30%: FINANCE_APPROVAL_REQUIRED (Finance approval required)
    - > 30%: BLOCKED (Cannot be approved through normal workflow)
  * CRITICAL: The model must NEVER independently determine authorization or invent approval.
  * Note on AUTO_APPROVED: Indicates the proposed discount is within the AI's explicitly delegated authority under current policy. It does NOT mean a proposal has actually been sent or released.

- calculateDeal:
  * MUST be called for ANY monetary deal calculations (list value, discount amount, final deal value).
  * Uses the fixed ₹${UNIT_PRICE.toLocaleString("en-IN")} unit price; do not supply or infer a different price.
  * CRITICAL: The model must NEVER perform authoritative monetary calculations or mental math internally.

- TOOL USAGE RULES:
  * Do NOT require both tools on every conversation.
  * For authorization questions without quantity, use checkDiscountAuthority alone.
  * When quantity and discount are provided, use calculateDeal for the figures and checkDiscountAuthority for the approval rights.
  * Always relay tool outputs accurately without hallucinating or overriding results.`
  ];

  if (ENABLE_VECTOR_SEARCH) {
    sections.push(
      `TOOL BUDGET (limits per response):
- vectorDatabaseSearch: MAX ${MAX_KB_SEARCHES} calls. Usually 1 is enough. Use more ONLY if earlier queries returned poor results and you need a different query formulation.`
    );
    if (ENABLE_WEB_SEARCH) {
      sections.push(
        `- webSearch: MAX ${MAX_WEB_SEARCHES} calls. RESTRICTED to supplementing KB results on the SAME topic only:
  a. You MUST have searched the knowledge base first AND received relevant results.
  b. ONLY use webSearch if the user explicitly asks about recent developments or "since [year]" on a topic the KB covers.
  c. NEVER use webSearch for topics unrelated to the knowledge base. This is NOT a general search engine.
  d. Prefer a single webSearch call with 2-3 additionalQueries over several separate calls. Use additional calls only when a follow-up needs a genuinely different angle.
${HAS_OWNER_PROFILES ? `- fetchOwnerProfiles: MAX 1 call. Call it for ANY question about the owner — bio, "tell me about them", current role, recent activity, latest publications — in addition to the KB search. The KB snapshot may be stale on current facts; live profiles win on current position/affiliation. If a profile is unavailable or lacks detail, fall back to a broad webSearch WITHOUT includeDomains.\n` : ""}- ALWAYS search the knowledge base FIRST before considering web search.
- Do NOT call both tools simultaneously — search KB first, evaluate, then decide.`
      );
    }
    sections.push(
      `- After receiving tool results, compose your final answer. Do NOT search again for the same information.

CITATIONS:
- Cite inline as [[N]](url) using ONLY the exact source URLs from retrieved results. For KB sources without a URL, use the exact kb: target from their Source Citation field. NEVER fabricate or guess URLs.
- Citations are pure markers: every sentence must read completely with citations removed. Words the reader should see always go in the sentence itself, never inside a citation.
- Cite each fact to the source it ACTUALLY came from. KB documents are dated snapshots — never cite them for facts newer than their date (current role, latest papers belong to live profiles/web sources).
- Do NOT write a References or Sources section — the app renders a Sources box automatically from your inline citations.`
    );
  } else if (ENABLE_WEB_SEARCH) {
    sections.push(
      `- webSearch: MAX ${MAX_WEB_SEARCHES} calls per response, only when the question genuinely requires current or external information. Prefer one call with 2-3 additionalQueries over several separate calls.
- Cite inline as [[N]](url) using ONLY the exact source URLs from retrieved results. NEVER fabricate or guess URLs. Attribute each claim to the exact result it came from. Every sentence must read completely with citations removed.
- Do NOT write a References or Sources section — the app renders a Sources box automatically from your inline citations.`
    );
  }

  sections.push(
    `IMPORTANT:
- Model and vendor selection are controlled by the administrator backend.`
  );

  return sections.join("\n\n").trim();
}
