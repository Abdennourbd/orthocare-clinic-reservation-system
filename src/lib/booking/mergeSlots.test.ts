import { describe, it, expect } from "vitest";
import { mergeSlots, type SlotDto } from "./mergeSlots";

const a = (startUTC: string, localTime: string): SlotDto => ({
  startUTC,
  localTime,
});

describe("mergeSlots", () => {
  it("returns an empty array when both inputs are empty", () => {
    expect(mergeSlots([], [])).toEqual([]);
  });

  it("merges available + occupied into one array with the correct status", () => {
    const merged = mergeSlots(
      [a("2026-08-29T09:30:00.000Z", "10:30")],
      [a("2026-08-29T09:00:00.000Z", "10:00")],
    );
    expect(merged).toEqual([
      { startUTC: "2026-08-29T09:00:00.000Z", localTime: "10:00", status: "occupied" },
      { startUTC: "2026-08-29T09:30:00.000Z", localTime: "10:30", status: "available" },
    ]);
  });

  it("sorts by startUTC ascending regardless of input order", () => {
    const merged = mergeSlots(
      [a("2026-08-29T10:30:00.000Z", "11:30"), a("2026-08-29T09:30:00.000Z", "10:30")],
      [a("2026-08-29T10:00:00.000Z", "11:00"), a("2026-08-29T09:00:00.000Z", "10:00")],
    );
    expect(merged.map((s) => s.startUTC)).toEqual([
      "2026-08-29T09:00:00.000Z",
      "2026-08-29T09:30:00.000Z",
      "2026-08-29T10:00:00.000Z",
      "2026-08-29T10:30:00.000Z",
    ]);
  });

  it("marks every slot with its status", () => {
    const merged = mergeSlots(
      [a("2026-08-29T09:30:00.000Z", "10:30")],
      [a("2026-08-29T09:00:00.000Z", "10:00")],
    );
    expect(merged.map((s) => s.status)).toEqual(["occupied", "available"]);
  });

  it("handles only-available and only-occupied inputs", () => {
    expect(mergeSlots([a("2026-08-29T09:00:00.000Z", "10:00")], []).map((s) => s.status)).toEqual([
      "available",
    ]);
    expect(mergeSlots([], [a("2026-08-29T09:00:00.000Z", "10:00")]).map((s) => s.status)).toEqual([
      "occupied",
    ]);
  });

  it("dedupes by startUTC with occupied winning (defensive — API guarantees disjoint)", () => {
    const merged = mergeSlots(
      [a("2026-08-29T09:00:00.000Z", "10:00 avail")],
      [a("2026-08-29T09:00:00.000Z", "10:00 occ")],
    );
    expect(merged).toEqual([
      { startUTC: "2026-08-29T09:00:00.000Z", localTime: "10:00 occ", status: "occupied" },
    ]);
  });
});
