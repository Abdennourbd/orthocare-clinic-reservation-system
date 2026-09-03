import { z } from "zod";

// Task 18 — GET /api/admin/kpis query schema, shared by the route handler.
// Both dates are clinic-local YYYY-MM-DD and optional: the route defaults an
// omitted side to the current Sat→Thu clinic week
// (src/lib/kpis/aggregations.ts — getClinicWeekRange). The admin dashboard is
// French-only, so validation messages are in French.

export const kpisQuerySchema = z.object({
  from: z.string().date("Date invalide.").optional(),
  to: z.string().date("Date invalide.").optional(),
});

export type KpisQuery = z.infer<typeof kpisQuerySchema>;
