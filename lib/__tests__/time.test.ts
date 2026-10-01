import { describe, expect, it } from "vitest";
import { formatDisplayTime } from "@/lib/time";

describe("timestamp formatting", () => {
  it("uses a deterministic en-US formatter across environments", () => {
    expect(formatDisplayTime("2026-10-01T18:18:00+05:30")).toBe("06:18 PM");
  });
});
