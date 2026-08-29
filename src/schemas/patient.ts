import { z } from "zod";

// Task 13 — patient CRUD request schemas, shared between the admin route
// handlers (steps 4-6) and the dashboard forms (steps 7-8). The admin
// dashboard is French-only (plan.md — "Admin dashboard language: FR only"),
// so validation messages are in French, unlike the trilingual public booking
// schemas in booking.ts.

export const patientCreateSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis.").max(100),
  lastName: z.string().trim().min(1, "Le nom est requis.").max(100),
  phone: z.string().trim().min(6, "Numéro de téléphone invalide.").max(30),
  email: z
    .union([
      z.string().trim().email("Adresse e-mail invalide.").max(200),
      z.literal(""),
    ])
    .optional(),
  // The native <input type="date"> yields "YYYY-MM-DD" (not a full ISO
  // datetime) — same convention as bookingInputSchema.patient.birthDate.
  birthDate: z.string().date("Date de naissance invalide.").nullable().optional(),
  notes: z.string().max(5000, "Les notes sont limitées à 5000 caractères.").optional(),
  messagingOptOut: z.boolean().optional(),
  whatsappOptIn: z.boolean().optional(),
  preferredLocale: z.enum(["fr", "ar", "en"]).optional(),
  // Set by the client after the user has seen the duplicate-candidate
  // warning and chosen to proceed anyway (§Décisions d'architecture 1).
  // Covers NAME matches only — see phoneSharingAcknowledged below.
  duplicateAcknowledged: z.boolean().optional().default(false),
  // Task 13 étape 4 tour 2 — separate, explicit acknowledgement for a
  // PHONE-only match (no name overlap). Algerian families legitimately
  // share one phone, so sharing is never forbidden (no @unique on
  // phoneE164 — prisma/schema.prisma), but it must be a conscious staff
  // gesture, not the side-effect of dismissing an unrelated homonym
  // warning. Kept distinct from duplicateAcknowledged on purpose: a
  // request can trip one gate without the other.
  phoneSharingAcknowledged: z.boolean().optional().default(false),
});

export const patientUpdateSchema = patientCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

export const patientListQuerySchema = z.object({
  q: z.string().trim().max(100, "Recherche limitée à 100 caractères.").optional(),
  active: z.enum(["true", "false", "all"]).optional(),
  // Bounds mirror the audit route (src/app/api/admin/audit/route.ts).
  limit: z.coerce.number().int().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});

export const visitTypeValues = [
  "CONSULTATION",
  "TRAITEMENT",
  "CONTROLE",
  "URGENCE",
  "AUTRE",
] as const;

export const visitCreateSchema = z.object({
  // Accepts either a full ISO datetime or a plain calendar date, same
  // reasoning as patientCreateSchema.birthDate.
  date: z.union([z.string().datetime(), z.string().date()], {
    message: "Date de visite invalide.",
  }),
  serviceId: z.string().min(1).optional(),
  // Plain string in Prisma (Visit.type), not a DB enum — validated here so a
  // new visit category never needs a migration (schema.prisma comment on
  // model Visit).
  type: z.enum(visitTypeValues, { message: "Type de visite invalide." }),
  notes: z.string().max(5000, "Les notes sont limitées à 5000 caractères.").optional(),
  treatment: z
    .string()
    .max(5000, "Le traitement est limité à 5000 caractères.")
    .optional(),
});

// The erasure is irreversible (anonymizePatient nulls out identity fields in
// the same transaction as neutralizing SmsMessage rows — §Exigences point 4).
// Requiring a literal `true` means an accidental empty POST body can never
// trigger it.
export const anonymizeSchema = z.object({
  confirm: z.literal(true, { message: "Confirmation requise." }),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;
export type VisitCreateInput = z.infer<typeof visitCreateSchema>;
export type AnonymizeInput = z.infer<typeof anonymizeSchema>;
