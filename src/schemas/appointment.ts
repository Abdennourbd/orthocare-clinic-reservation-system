import { z } from "zod";

// Task 14 — appointment management request schemas, shared between the admin
// route handlers and the dashboard forms (step 5). The admin dashboard is
// French-only (plan.md — "Admin dashboard language: FR only"), so validation
// messages are in French, same convention as patient.ts.

export const appointmentStatusValues = [
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
  "RESCHEDULED",
] as const;

/** Staff actions on an existing appointment (PATCH /[id]). Each maps to a
 * status transition via STATUS_TRANSITIONS (src/lib/booking/adminTransitions.ts). */
export const appointmentActionValues = [
  "CONFIRM",
  "CANCEL",
  "COMPLETE",
  "NO_SHOW",
] as const;

export const appointmentListQuerySchema = z.object({
  // Clinic-local calendar date "YYYY-MM-DD" (same convention as
  // bookingInputSchema.patient.birthDate). Optional — the route defaults it
  // to the clinic's today (lib/time/clinicTime.ts owns "today").
  date: z.string().date("Date invalide.").optional(),
  status: z.enum(appointmentStatusValues, { message: "Statut invalide." }).optional(),
});

/** Dashboard week strip (range view): clinic-local YYYY-MM-DD bounds, max
 * 31 days. Both required — the caller (dashboard home) always knows its
 * Sat→Thu week via getClinicWeekRange(), so no silent default range. */
export const appointmentRangeQuerySchema = z.object({
  from: z.string().date("Date de début invalide."),
  to: z.string().date("Date de fin invalide."),
  status: z.enum(appointmentStatusValues, { message: "Statut invalide." }).optional(),
});

export const manualBookingSchema = z.object({
  patientId: z.string().min(1, "Le patient est requis."),
  serviceId: z.string().min(1, "Le service est requis."),
  /** ISO-8601 UTC instant of the chosen slot (same convention as bookingInputSchema). */
  startTime: z.string().datetime({ message: "Date/heure de début invalide." }),
  // Reserved for v2 (second chair) — carried through to bookSlot().
  resourceId: z.string().min(1).nullish(),
  // Free-text front-desk note persisted on the appointment (visitNotes is the
  // Appointment model's only free-text column).
  notes: z.string().max(5000, "Les notes sont limitées à 5000 caractères.").optional(),
  // Optional with NO default: a default would silently overwrite the
  // patient's stored preferredLocale with "fr" when the front desk omits the
  // field. Only an explicitly provided locale updates preferredLocale.
  locale: z.enum(["fr", "ar", "en"]).optional(),
});

export const appointmentStatusChangeSchema = z.object({
  action: z.enum(appointmentActionValues, { message: "Action invalide." }),
});

export const appointmentRescheduleSchema = z.object({
  /** ISO-8601 UTC instant of the NEW slot — availability is re-checked by
   * rescheduleSlot() (bookSlotInTx re-validates under the advisory lock). */
  startTime: z.string().datetime({ message: "Nouvelle date/heure invalide." }),
  resourceId: z.string().min(1).nullish(),
});

export const appointmentSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Recherche requise.")
    .max(100, "Recherche limitée à 100 caractères."),
});

export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type AppointmentRangeQuery = z.infer<typeof appointmentRangeQuerySchema>;
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;
export type AppointmentStatusChangeInput = z.infer<typeof appointmentStatusChangeSchema>;
export type AppointmentRescheduleInput = z.infer<typeof appointmentRescheduleSchema>;
export type AppointmentSearchQuery = z.infer<typeof appointmentSearchQuerySchema>;
