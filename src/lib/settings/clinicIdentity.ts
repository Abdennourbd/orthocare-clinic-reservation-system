/**
 * Clinic identity (name, address, phone) — the single source of truth for the
 * clinic's contact details.
 *
 * Deliberately dependency-free (no DB, no i18n): both the DB-backed
 * `clinicInfo` Setting defaults and the static public `CLINIC_LOCATION` config
 * derive from here, so the token page and the public site can never drift.
 * Importing it never pulls Prisma into a client bundle.
 */

export const CLINIC_IDENTITY = {
  name: "Ortho'Care Clinic",
  // Verified against the clinic's Google Maps listing and clinicorthocare.com
  // (10 rue Larbi Abdelsalem, Rouiba, Algiers).
  address: "10, rue Larbi Abdelsalem, Rouiba, Alger",
  phone: "+213 793 03 58 93",
} as const;