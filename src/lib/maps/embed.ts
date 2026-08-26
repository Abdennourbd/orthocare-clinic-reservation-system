/**
 * Google embed URL builders for the public Reviews widget + location map
 * (Task 10). Pure functions over the locale so the pb-string construction is
 * unit-testable. No API key: both embeds are the free no-key Google Maps
 * iframe embeds.
 *
 * The parent page's CSP only needs `frame-src` for the embed hosts (the
 * iframe's own scripts/images are governed by Google's own CSP, not ours);
 * see src/lib/security/headers.ts.
 */

import { CLINIC_LOCATION } from "@/lib/settings/clinicLocation";
import { type Locale } from "@/lib/i18n/config";

/** Google Maps UI language code per app locale. */
const GOOGLE_LANG: Record<Locale, string> = {
  fr: "fr",
  ar: "ar",
  en: "en",
};

/** Google's region suffix for Algeria in the embed pb string. */
const REGION = "dz";

/** Encode like encodeURIComponent but also escape the apostrophe, which the
 *  Google pb format expects as %27. */
function encodePb(value: string): string {
  return encodeURIComponent(value).replace(/'/g, "%27");
}

/**
 * Reviews widget embed: the Google Maps "place card" iframe. Renders the map
 * with the clinic's live rating + review count and a link to the full
 * reviews. It does NOT render the individual review list (the free embed has
 * no such mode) — the 4★+ filter requires the Places API (tracked in
 * tasks/plan.md, Open Questions).
 */
export function buildReviewsEmbedSrc(locale: Locale): string {
  const pb = [
    "!1m18!1m12!1m3!1d3317.3",
    `!2d${CLINIC_LOCATION.longitude}`,
    `!3d${CLINIC_LOCATION.latitude}`,
    "!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1",
    "!3m3!1m2",
    `!1s${encodePb(CLINIC_LOCATION.placeId)}`,
    `!2s${encodePb(CLINIC_LOCATION.name)}`,
    "!5e0",
    `!3m2!1s${GOOGLE_LANG[locale]}!2s${REGION}`,
    "!4v1710000000000",
  ].join("");
  return `https://www.google.com/maps/embed?pb=${pb}`;
}

/**
 * Plain location map embed: a map centred on the clinic's coordinates with a
 * marker. Uses `output=embed` (no key). The map is locale-aware via `hl`.
 */
export function buildMapEmbedSrc(locale: Locale): string {
  const q = `${CLINIC_LOCATION.latitude},${CLINIC_LOCATION.longitude}`;
  return `https://www.google.com/maps?q=${q}&z=16&hl=${GOOGLE_LANG[locale]}&output=embed`;
}

/** One-click directions deep link (opens the Maps app on mobile). */
export function buildDirectionsUrl(): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${CLINIC_LOCATION.latitude},${CLINIC_LOCATION.longitude}`;
}

/** Deep link to the clinic's place page (used as the fallback behind the
 *  widgets so the page still works if an iframe fails to load). */
export function buildPlaceUrl(): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodePb(
    CLINIC_LOCATION.name,
  )}&query_place_id=${encodePb(CLINIC_LOCATION.placeId)}`;
}