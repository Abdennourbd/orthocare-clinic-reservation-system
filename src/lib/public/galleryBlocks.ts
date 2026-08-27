import type { listActiveGalleryItems } from "@/lib/public/content";

export type GalleryItem = Awaited<ReturnType<typeof listActiveGalleryItems>>[number];

export type GalleryBlock =
  | { type: "single"; item: GalleryItem }
  | { type: "pair"; before: GalleryItem; after: GalleryItem };

// The seed guarantees three before/after pairs on *consecutive* keys (see the
// comment above `galleryItems` in prisma/seed.ts) and spells "before"/"after"
// out in every caption, in every locale. We detect that here, at render time,
// purely to decide layout — the list itself is never re-sorted: it arrives in
// exactly the order `listActiveGalleryItems` returned (DB `orderBy: key asc`).
// Detecting from the caption text (rather than trusting key naming) keeps this
// resilient to future edits as long as the editorial convention holds.
const BEFORE_MARKERS: (RegExp | string)[] = [/\bavant\b/i, /\bbefore\b/i, "قبل"];
const AFTER_MARKERS: (RegExp | string)[] = [/\bapr[eè]s\b/i, /\bafter\b/i, "بعد"];

function matchesAny(caption: string, markers: (RegExp | string)[]): boolean {
  return markers.some((marker) =>
    typeof marker === "string" ? caption.includes(marker) : marker.test(caption)
  );
}

export function groupIntoBlocks(items: GalleryItem[]): GalleryBlock[] {
  const blocks: GalleryBlock[] = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const next = items[i + 1];
    if (
      next &&
      matchesAny(current.caption ?? "", BEFORE_MARKERS) &&
      matchesAny(next.caption ?? "", AFTER_MARKERS)
    ) {
      blocks.push({ type: "pair", before: current, after: next });
      i++; // the "after" item was consumed as part of the pair
    } else {
      blocks.push({ type: "single", item: current });
    }
  }
  return blocks;
}
