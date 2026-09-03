import { z } from "zod";

// Task 17.2 — staff waitlist request schemas, shared between the admin route
// handlers and the dashboard forms. The admin dashboard is French-only
// (plan.md — "Admin dashboard language: FR only"), so validation messages
// are in French, same convention as appointment.ts / patient.ts / sms.ts.
//
// `active` is deliberately NOT a coerced boolean: the list supports three
// states (`true` / `false` / `all`), which a boolean cannot express, so the
// raw query string is validated as an enum and the route maps it to a
// Prisma filter (default: active only). Ids are validated as non-empty
// strings, never strict cuids: a strict cuid would turn the matrix probe id
// ("does-not-exist") into a 400 instead of the indistinguishable 404 the
// routes guarantee, and the DB lookup is the real existence check anyway.
// Date SHAPE (YYYY-MM-DD) is checked here; date POLICY (no past, within the
// booking horizon) is enforced in the route with validateWatchDates() +
// the live Settings policy, because the horizon is admin-editable.

/** GET /api/admin/waitlist — filters + cursor pagination. */
export const waitlistListQuerySchema = z.object({
  serviceId: z.string().min(1, "Service invalide.").optional(),
  active: z
    .enum(["true", "false", "all"], { message: "Filtre actif invalide." })
    .optional()
    .default("true"),
  cursor: z.string().min(1, "Curseur invalide.").optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** POST /api/admin/waitlist — a front-desk clerk adds a patient to the
 * waitlist for one service on 1-10 preferred clinic-local dates. */
export const waitlistCreateSchema = z.object({
  patientId: z.string().min(1, "Le patient est requis."),
  serviceId: z.string().min(1, "Le service est requis."),
  preferredDates: z
    .array(z.string().date("Date invalide (AAAA-MM-JJ attendue)."), {
      message: "Les dates préférées sont requises.",
    })
    .min(1, "Au moins une date est requise.")
    .max(10, "Dix dates au maximum."),
});

export type WaitlistListQuery = z.infer<typeof waitlistListQuerySchema>;
export type WaitlistCreateInput = z.infer<typeof waitlistCreateSchema>;
