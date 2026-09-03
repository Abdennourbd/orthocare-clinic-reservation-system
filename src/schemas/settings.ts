import { z } from "zod";

// Task 21 — settings schemas (working hours, slot config, booking policy,
// messaging templates). Shared between the admin route and dashboard forms.
// FR-only messages (admin FR-only).
//
// These guards exist so an admin typo can never crash the slot engine
// (SlotConfigError in src/lib/slots/engine.ts) or empty the booking grid.
// Every range here mirrors the engine's assertPositiveInteger /
// isValidDayConfig boundaries.

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmSchema = (label: string) =>
  z.string().trim().regex(HHMM_RE, `${label} doit être au format HH:MM (00:00–23:59).`);

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// One weekday: either closed, or open+close with close > open.
const daySchema = z.union([
  z.object({ closed: z.literal(true) }),
  z
    .object({
      open: hhmmSchema("L'ouverture"),
      close: hhmmSchema("La fermeture"),
    })
    .refine((v) => toMinutes(v.close) > toMinutes(v.open), {
      message: "La fermeture doit être après l'ouverture.",
    }),
]);

export const workingHoursSchema = z
  .object({
    sat: daySchema,
    sun: daySchema,
    mon: daySchema,
    tue: daySchema,
    wed: daySchema,
    thu: daySchema,
    fri: daySchema,
  })
  .refine(
    (v) =>
      [v.sat, v.sun, v.mon, v.tue, v.wed, v.thu, v.fri].some(
        (d) => !("closed" in d && d.closed === true),
      ),
    { message: "Au moins un jour doit être ouvert." },
  );

export const slotConfigSchema = z.object({
  granularityMinutes: z
    .number({ message: "La granularité est requise." })
    .int("La granularité doit être un nombre entier.")
    .min(5, "La granularité minimum est de 5 minutes.")
    .max(120, "La granularité maximum est de 120 minutes.")
    .refine((v) => v % 5 === 0, { message: "La granularité doit être un multiple de 5." }),
  bufferMinutes: z
    .number({ message: "Le tampon est requis." })
    .int("Le tampon doit être un nombre entier.")
    .min(0, "Le tampon ne peut pas être négatif.")
    .max(60, "Le tampon maximum est de 60 minutes."),
  lunchBreak: z
    .union([
      z.null(),
      z
        .object({
          start: hhmmSchema("Le début de la pause"),
          end: hhmmSchema("La fin de la pause"),
        })
        .refine((v) => toMinutes(v.end) > toMinutes(v.start), {
          message: "La fin de la pause doit être après son début.",
        }),
    ])
    .optional()
    .default(null),
});

export const bookingPolicySchema = z.object({
  pendingExpiryHours: z
    .number({ message: "Le délai d'expiration est requis." })
    .int("Le délai doit être un nombre entier.")
    .min(1, "Le délai minimum est d'1 heure.")
    .max(72, "Le délai maximum est de 72 heures."),
  minLeadTimeMinutes: z
    .number({ message: "Le délai minimum est requis." })
    .int()
    .min(0, "Le délai ne peut pas être négatif.")
    .max(10080, "Le délai maximum est de 10080 minutes (7 jours)."),
  maxHorizonDays: z
    .number({ message: "L'horizon est requis." })
    .int()
    .min(1, "L'horizon minimum est d'1 jour.")
    .max(365, "L'horizon maximum est de 365 jours."),
  clinicTimezone: z.literal("Africa/Algiers", { message: "Le fuseau doit être Africa/Algiers." }),
});

const TEMPLATE_KEYS = [
  "bookingReceived",
  "confirmation",
  "cancelled",
  "reschedule",
  "reminder",
  "noShow",
  "expired",
  "delay",
  "waitlist",
] as const;

export const messageTemplatesSchema = z
  .object(
    Object.fromEntries(
      TEMPLATE_KEYS.map((k) => [
        k,
        z
          .string()
          .trim()
          .min(1, "Le modèle ne peut pas être vide.")
          .max(1000, "Modèle trop long (1000 caractères maximum).")
          .optional(),
      ]),
    ) as Record<(typeof TEMPLATE_KEYS)[number], z.ZodOptional<z.ZodString>>,
  )
  .refine((v) => Object.values(v).some((s) => s !== undefined), {
    message: "Au moins un modèle est requis.",
  });

// PATCH /api/admin/settings — single-key update (safer audit + validation
// than a bulk write). `clinicInfo` is a passthrough shaped by the seed's
// CLINIC_IDENTITY; `consentVersion` is read-only (rejected here).
export const settingsPatchSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("workingHours"), value: workingHoursSchema }),
  z.object({ key: z.literal("slotConfig"), value: slotConfigSchema }),
  z.object({ key: z.literal("bookingPolicy"), value: bookingPolicySchema }),
  z.object({ key: z.literal("messageTemplates"), value: messageTemplatesSchema }),
  z.object({
    key: z.literal("clinicInfo"),
    value: z.object({
      name: z.string().trim().min(1, "Le nom est requis.").max(200).optional(),
      phone: z.string().trim().min(1).max(50).optional(),
      address: z.string().trim().min(1).max(500).optional(),
    }),
  }),
]);

export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;
export type SlotConfigInput = z.infer<typeof slotConfigSchema>;
export type BookingPolicySettingsInput = z.infer<typeof bookingPolicySchema>;
export type MessageTemplatesInput = z.infer<typeof messageTemplatesSchema>;
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>;
export const SETTINGS_TEMPLATE_KEYS = TEMPLATE_KEYS;
