import { z } from "zod";

// Task 19 — exports query schemas, shared by the route handlers and the admin
// UI. The admin dashboard is French-only, so validation messages are in
// French. Dates are clinic-local (Africa/Algiers); all date maths goes
// through lib/time/clinicTime.ts — never the server's timezone.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isRealCalendarDay(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m as number) - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === (m as number) - 1 &&
    dt.getUTCDate() === d
  );
}

export const appointmentsExportQuerySchema = z.object({
  month: z
    .string({ error: "Mois invalide (AAAA-MM attendu)." })
    .regex(MONTH_RE, "Mois invalide (AAAA-MM attendu)."),
  format: z.enum(["csv", "xlsx"], { error: "Format invalide (csv ou xlsx)." }),
  includeNotes: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
    .optional()
    .transform((v) => v ?? false),
});

export const daySheetQuerySchema = z.object({
  date: z
    .string({ error: "Date invalide (AAAA-MM-JJ attendue)." })
    .regex(DAY_RE, "Date invalide (AAAA-MM-JJ attendue).")
    .refine(isRealCalendarDay, { message: "Date invalide." }),
});

export type AppointmentsExportQuery = z.infer<
  typeof appointmentsExportQuerySchema
>;
export type DaySheetQuery = z.infer<typeof daySheetQuerySchema>;
