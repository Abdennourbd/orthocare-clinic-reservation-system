import { z } from "zod";

// Shared request schemas for the public booking API (Task 6). Used by the
// route handlers (server) and the booking wizard form (client) so both sides
// validate the same shape.

const patientInputSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(30),
  email: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  birthDate: z.string().datetime().nullable().optional(),
});

/** Clinic-local calendar date "YYYY-MM-DD". */
export const watchDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "watchDates must be YYYY-MM-DD");

export const bookingInputSchema = z.object({
  serviceId: z.string().min(1),
  /** ISO-8601 UTC instant of the chosen slot. */
  startTime: z.string().datetime(),
  patient: patientInputSchema,
  /** GDPR-style consent: must be explicitly `true`; a booking without it is rejected. */
  consent: z.literal(true),
  /** The consent version the patient saw. The server rejects a stale version. */
  consentVersion: z.string().min(1),
  /**
   * Cancellation-watch opt-in (Task 6): clinic-local dates to watch for freed
   * slots. Validated against the booking policy (horizon, no past) server-side.
   */
  watchDates: z.array(watchDateSchema).max(10).optional(),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;
export type BookingPatientInput = z.infer<typeof patientInputSchema>;