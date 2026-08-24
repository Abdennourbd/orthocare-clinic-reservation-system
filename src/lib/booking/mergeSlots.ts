/**
 * Merge available + occupied slot lists into one time-ordered array.
 *
 * The `GET /api/slots` route returns slots split into `available` and
 * `occupied`. The booking wizard renders them as a single chronological
 * grid where already-taken slots stay in their natural position (red,
 * disabled). This helper does that merge + sort as pure logic so it can be
 * unit-tested without React.
 *
 * The two inputs are disjoint by construction (a slot is either bookable or
 * already reserved). The de-dup guard is defensive: if the same `startUTC`
 * ever appears in both, the occupied entry wins — a slot shown as taken must
 * never render as clickable.
 */

export type SlotDto = { startUTC: string; localTime: string };

export type MergedSlot = SlotDto & {
  status: "available" | "occupied";
};

export function mergeSlots(
  available: SlotDto[],
  occupied: SlotDto[],
): MergedSlot[] {
  // Occupied wins on duplicate startUTC, so seed the map with available first
  // and let occupied overwrite.
  const byStart = new Map<string, MergedSlot>();
  for (const s of available) {
    byStart.set(s.startUTC, { ...s, status: "available" });
  }
  for (const s of occupied) {
    byStart.set(s.startUTC, { ...s, status: "occupied" });
  }
  return [...byStart.values()].sort((x, y) =>
    x.startUTC < y.startUTC ? -1 : x.startUTC > y.startUTC ? 1 : 0,
  );
}
