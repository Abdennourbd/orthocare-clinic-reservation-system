/**
 * Clinic location used by the public Google embeds (Task 10): the reviews
 * widget, the map and the one-click directions button.
 *
 * Kept as STATIC constants (not the admin-editable `clinicInfo` Setting) so
 * the shared layout/footer and the home page stay statically renderable —
 * reading the Setting here would force-dynamic every page that renders them.
 * Task 21 (admin dashboard) can migrate these into the Setting when editing
 * goes live; the plan's decision is recorded in tasks/plan.md.
 *
 * Dependency-free on purpose: importing this module (directly or via
 * `lib/maps/embed.ts`) never pulls Prisma/`db.ts` into a client bundle, so it
 * stays safe even if a client component ever consumes it. The identity fields
 * (name/address/phone) come from the shared `CLINIC_IDENTITY` so the public
 * site and the DB-backed token page can never drift.
 */

import { CLINIC_IDENTITY } from "./clinicIdentity";

export const CLINIC_LOCATION = {
  ...CLINIC_IDENTITY,
  // Google Maps pin for the clinic.
  latitude: 36.7351871,
  longitude: 3.2836918,
  // Place ID from the clinic's Google Maps listing (ChIJ feature ID).
  placeId: "0x128e5b9de26cb8dd:0xb0b176111c5df02c",
} as const;

export type ClinicLocation = typeof CLINIC_LOCATION;