import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlankDeal, processCommercialMessage } from "@/lib/deals";
import { loadDealWorkspace, saveDealWorkspace } from "@/lib/storage";
import { UNIT_PRICE } from "@/lib/pricing";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("DealGuard workspace persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips independent deals, selected deal, conversations, governance, and audit history", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
    const first = processCommercialMessage(
      createBlankDeal("persistent-jsw"),
      "JSW wants 500 licences. Recommend a discount."
    );
    const second = processCommercialMessage(
      createBlankDeal("persistent-infosys"),
      "Infosys needs 180 licences with 7% discount."
    );
    const workspace = { deals: [first, second], selectedDealId: second.id };

    saveDealWorkspace(workspace);
    const restored = loadDealWorkspace();

    expect(restored?.selectedDealId).toBe(second.id);
    expect(restored?.deals.map((deal) => deal.id)).toEqual([first.id, second.id]);
    expect(restored?.deals[0]).toEqual(first);
    expect(restored?.deals[1]).toEqual(second);
    expect(restored?.deals[0].messages.map((message) => message.id)).toEqual(
      first.messages.map((message) => message.id)
    );
    expect(restored?.deals[0].auditTrail).toEqual(first.auditTrail);
  });

  it("returns null only when this browser has no saved deal workspace", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
    expect(loadDealWorkspace()).toBeNull();
  });

  it("migrates old saved deal prices and writes the recalculated workspace back", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
    const oldDeal = {
      ...processCommercialMessage(
        createBlankDeal("old-price-deal"),
        "JSW wants 500 licences for 12% discount."
      ),
      unitPrice: 3200,
    };
    const originalAudit = [...oldDeal.auditTrail];
    const originalMessageIds = oldDeal.messages.map((message) => message.id);
    storage.setItem(
      "dealguard-workspace",
      JSON.stringify({ deals: [oldDeal], selectedDealId: oldDeal.id })
    );

    const restored = loadDealWorkspace();
    const savedAgain = JSON.parse(storage.getItem("dealguard-workspace") ?? "{}");

    expect(restored?.deals[0].unitPrice).toBe(UNIT_PRICE);
    expect(restored?.deals[0].auditTrail.slice(0, originalAudit.length)).toEqual(originalAudit);
    expect(restored?.deals[0].auditTrail.at(-1)?.message).toContain("Migration: unit price changed");
    expect(restored?.deals[0].messages.map((message) => message.id)).toEqual(originalMessageIds);
    expect(savedAgain.deals[0].unitPrice).toBe(UNIT_PRICE);
    expect(savedAgain.selectedDealId).toBe(oldDeal.id);
  });
});
