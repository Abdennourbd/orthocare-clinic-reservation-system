import { z } from "zod";

// Task 16 — SMS Center request schemas, shared between the admin route
// handlers and the dashboard forms (Tasks 4-6). The admin dashboard is
// French-only (plan.md — "Admin dashboard language: FR only"), so validation
// messages are in French, same convention as appointment.ts / patient.ts.

export const smsMessageTypeValues = [
  "BOOKING_RECEIVED",
  "CONFIRMATION",
  "REMINDER",
  "NO_SHOW",
  "MANUAL",
  "RESCHEDULE",
  "CANCELLED",
  "DELAY",
  "WAITLIST",
  "EXPIRED",
] as const;

/** POST /api/admin/sms — single free-text SMS to one patient. The dispatcher
 * (sendMessage) re-validates the body defensively; the route schema bounds it
 * here so an oversized body is rejected before any DB access. */
export const singleSmsSchema = z.object({
  patientId: z.string().min(1, "Le patient est requis."),
  body: z
    .string()
    .trim()
    .min(1, "Le message est requis.")
    .max(480, "Le message est limité à 480 caractères."),
});

/** POST /api/admin/sms/broadcast/preview — audience + sample body for the
 * broadcast UI. `date` is optional: the route defaults it to the clinic's
 * today (lib/time/clinicTime.ts owns "today"), same convention as
 * appointmentListQuerySchema. */
export const broadcastPreviewSchema = z.object({
  date: z.string().date("Date invalide.").optional(),
  delayMinutes: z
    .number()
    .int("Durée invalide.")
    .min(1, "La durée doit être d'au moins 1 minute.")
    .max(480, "La durée est limitée à 480 minutes."),
});

/** POST /api/admin/sms/broadcast — sends the delay broadcast. The unique
 * `idempotencyKey` is the double-click guard: a P2002 on it makes runBroadcast
 * return the existing batch and send nothing (SmsBroadcast.idempotencyKey). */
export const broadcastSendSchema = broadcastPreviewSchema.extend({
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Clé d'idempotence invalide.")
    .max(100, "Clé d'idempotence trop longue."),
});

/** GET /api/admin/sms — history filters. Cursor-paginated (cursor + limit),
 * same shape as the other admin list endpoints. */
export const smsHistoryQuerySchema = z.object({
  batchId: z.string().min(1).optional(),
  patientId: z.string().min(1).optional(),
  type: z.enum(smsMessageTypeValues).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type SingleSmsInput = z.infer<typeof singleSmsSchema>;
export type BroadcastPreviewInput = z.infer<typeof broadcastPreviewSchema>;
export type BroadcastSendInput = z.infer<typeof broadcastSendSchema>;
export type SmsHistoryQuery = z.infer<typeof smsHistoryQuerySchema>;
