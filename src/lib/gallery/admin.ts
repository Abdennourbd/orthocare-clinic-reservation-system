import { getPrisma } from "@/lib/db";
import { MAX_FEATURED_CASES } from "@/lib/gallery/images";
import { blobKeyFromUrl, deleteCaseImage } from "@/lib/gallery/blobStorage";

// G2 — shared helpers for the admin cases API. Keeps the four route files
// thin and the business rules in exactly one place.

export const caseRowSelect = {
  id: true,
  key: true,
  title: true,
  description: true,
  beforeImageUrl: true,
  afterImageUrl: true,
  active: true,
  sortOrder: true,
  featured: true,
  featuredOrder: true,
  consentConfirmed: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Publication requires written patient consent. Returns the refusal message,
 * or null when publishing is allowed. Applied to the MERGED state (body over
 * DB row), so PATCH {active:true} on an unconsented case is refused even
 * when consent is absent from the body. */
export function consentRefusal(active: boolean, consentConfirmed: boolean): string | null {
  if (active && !consentConfirmed) {
    return "Le consentement écrit du patient est requis pour publier ce cas.";
  }
  return null;
}

/** Whether featuring one more case would exceed the home-page cap
 * (MAX_FEATURED_CASES). `excludeId` skips the row being updated so
 * re-saving an already-featured case never trips the cap. */
export async function featuredCapReached(excludeId?: string): Promise<boolean> {
  const count = await getPrisma().smileCase.count({
    where: { featured: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  return count >= MAX_FEATURED_CASES;
}

/** Best-effort blob cleanup for image URLs that point at our store.
 * Local paths and foreign URLs resolve to null and are skipped. Failures
 * never throw — by the time this runs the DB row is already gone, so a
 * failure leaves an unreachable orphan rather than a live leak (same
 * discipline as documents/deleteDocument). */
export async function deleteCaseBlobsBestEffort(imageUrls: string[]): Promise<void> {
  for (const url of imageUrls) {
    const key = blobKeyFromUrl(url);
    if (!key) continue;
    try {
      await deleteCaseImage(key);
    } catch {
      // Already reported inside deleteCaseImage; the row is gone either way.
    }
  }
}
