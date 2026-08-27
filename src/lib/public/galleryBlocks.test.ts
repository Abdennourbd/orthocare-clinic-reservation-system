import { describe, it, expect } from "vitest";
import { groupIntoBlocks, type GalleryItem } from "./galleryBlocks";

// Minimal fixture builder — only `caption` drives the logic under test, but
// `id`/`imageUrl` are required by the type and useful for asserting identity
// (e.g. that the "after" item isn't duplicated).
const item = (id: string, caption: string | null): GalleryItem =>
  ({ id, imageUrl: `https://example.test/${id}.jpg`, caption }) as GalleryItem;

describe("groupIntoBlocks", () => {
  it("returns an empty array for an empty list", () => {
    expect(groupIntoBlocks([])).toEqual([]);
  });

  it("pairs a simple before → after in French", () => {
    const before = item("1", "Avant traitement");
    const after = item("2", "Après traitement");
    expect(groupIntoBlocks([before, after])).toEqual([{ type: "pair", before, after }]);
  });

  it("pairs a simple before → after in English", () => {
    const before = item("1", "Before treatment");
    const after = item("2", "After treatment");
    expect(groupIntoBlocks([before, after])).toEqual([{ type: "pair", before, after }]);
  });

  it("pairs a simple before → after in Arabic", () => {
    const before = item("1", "قبل العلاج");
    const after = item("2", "بعد العلاج");
    expect(groupIntoBlocks([before, after])).toEqual([{ type: "pair", before, after }]);
  });

  it("keeps an 'after' with no preceding 'before' as a single", () => {
    const solo = item("1", "Après traitement");
    expect(groupIntoBlocks([solo])).toEqual([{ type: "single", item: solo }]);
  });

  it("keeps a 'before' with no following 'after' as a single", () => {
    const solo = item("1", "Avant traitement");
    expect(groupIntoBlocks([solo])).toEqual([{ type: "single", item: solo }]);
  });

  it("treats two consecutive 'before' captions as two singles", () => {
    const a = item("1", "Avant traitement 1");
    const b = item("2", "Avant traitement 2");
    expect(groupIntoBlocks([a, b])).toEqual([
      { type: "single", item: a },
      { type: "single", item: b },
    ]);
  });

  it("forms one pair then a single from before/after/after", () => {
    const before = item("1", "Avant traitement");
    const after1 = item("2", "Après traitement");
    const after2 = item("3", "Après encore");
    const blocks = groupIntoBlocks([before, after1, after2]);
    expect(blocks).toEqual([
      { type: "pair", before, after: after1 },
      { type: "single", item: after2 },
    ]);
  });

  it("does not re-emit the consumed 'after' item as a single", () => {
    const before = item("1", "Avant traitement");
    const after = item("2", "Après traitement");
    const blocks = groupIntoBlocks([before, after]);
    const allEmittedIds = blocks.flatMap((b) =>
      b.type === "pair" ? [b.before.id, b.after.id] : [b.item.id],
    );
    expect(allEmittedIds).toEqual(["1", "2"]);
  });

  it("does not crash on a null caption", () => {
    const solo = item("1", null);
    expect(groupIntoBlocks([solo])).toEqual([{ type: "single", item: solo }]);
  });

  it("does not crash on an empty-string caption", () => {
    const solo = item("1", "");
    expect(groupIntoBlocks([solo])).toEqual([{ type: "single", item: solo }]);
  });

  it("does not crash when a 'before' is followed by a null-caption item", () => {
    const before = item("1", "Avant traitement");
    const nullNext = item("2", null);
    expect(groupIntoBlocks([before, nullNext])).toEqual([
      { type: "single", item: before },
      { type: "single", item: nullNext },
    ]);
  });

  it("preserves arrival order and never re-sorts", () => {
    // z, a, m — deliberately not alphabetical/chronological. groupIntoBlocks
    // must not reorder; the caller (DB `orderBy: key asc`) owns ordering.
    const z = item("z", "photo z");
    const a = item("a", "photo a");
    const m = item("m", "photo m");
    const blocks = groupIntoBlocks([z, a, m]);
    expect(blocks.map((b) => (b.type === "single" ? b.item.id : `${b.before.id}-${b.after.id}`))).toEqual([
      "z",
      "a",
      "m",
    ]);
  });

  it("known limitation: a false-positive pair can form from unrelated uses of the words", () => {
    // "avant" and "après" are common French words outside the before/after
    // photo sense (e.g. "avant" = "in front of" / "beforehand" in another
    // clause, "après" = "afterwards"). The detector has no way to distinguish
    // that from a genuine treatment-photo pair — it only looks at word
    // boundaries in the caption text. This test documents the accepted
    // behaviour (a spurious pair is formed), not a passing/correct outcome.
    const decoy1 = item("1", "Salle d'attente, juste avant la réception");
    const decoy2 = item("2", "Le sourire du patient, quelques mois après");
    expect(groupIntoBlocks([decoy1, decoy2])).toEqual([
      { type: "pair", before: decoy1, after: decoy2 },
    ]);
  });
});
