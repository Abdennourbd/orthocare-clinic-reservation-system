import { z } from "zod";

// Task 21 — closure (ScheduleException) schemas, shared between admin routes
// and the dashboard form. FR-only messages (admin FR-only).
//
// Dates are clinic-local calendar days ("YYYY-MM-DD"); the route converts
// them to UTC ranges via getClinicDayBoundsUTC (same convention as the
// waitlist). Time SHAPE (HH:MM) is checked here; overlap with existing
// appointments is computed in the route (it needs the DB).

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const localizedFieldSchema = z.object({
  fr: z.string().trim().min(1, "Le motif français est requis.").max(500, "Motif trop long."),
  ar: z.string().trim().max(500, "Motif trop long.").optional(),
  en: z.string().trim().max(500, "Motif trop long.").optional(),
});

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export const closureCreateSchema = z
  .object({
    startDate: z.string().date("Date de début invalide (AAAA-MM-JJ attendue)."),
    endDate: z.string().date("Date de fin invalide (AAAA-MM-JJ attendue)."),
    allDay: z.boolean().default(true),
    startTime: z.string().trim().regex(HHMM_RE, "L'heure de début doit être HH:MM.").optional(),
    endTime: z.string().trim().regex(HHMM_RE, "L'heure de fin doit être HH:MM.").optional(),
    reason: localizedFieldSchema,
    serviceId: z.string().min(1, "Service invalide.").nullable().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "La date de fin doit être après la date de début.",
    path: ["endDate"],
  })
  .refine(
    (v) => {
      if (v.allDay) return true;
      return v.startTime !== undefined && v.endTime !== undefined;
    },
    { message: "Les heures de début et fin sont requises pour une fermeture partielle.", path: ["startTime"] },
  )
  .refine(
    (v) => {
      if (v.allDay || !v.startTime || !v.endTime) return true;
      return toMinutes(v.endTime) > toMinutes(v.startTime);
    },
    { message: "L'heure de fin doit être après l'heure de début.", path: ["endTime"] },
  );

export const closureResolveSchema = z.object({
  action: z.enum(["cancel_and_notify", "keep_for_call"], { message: "Action invalide." }),
  appointmentIds: z.array(z.string().min(1)).max(200, "Trop de rendez-vous."),
  acknowledgedUnresolved: z.boolean().optional().default(false),
});

export type ClosureCreateInput = z.infer<typeof closureCreateSchema>;
export type ClosureResolveInput = z.infer<typeof closureResolveSchema>;
