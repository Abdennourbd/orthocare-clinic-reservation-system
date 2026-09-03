import { z } from "zod";

// Task 21 — services schemas, shared between admin route handlers and the
// dashboard form. FR-only messages (admin dashboard is FR-only, plan.md).
//
// `active` is patch-only: creation always starts active, deactivation goes
// through PATCH (same convention as team active toggle).

const slugSchema = z
  .string()
  .trim()
  .min(2, "Le slug est requis (2 caractères minimum).")
  .max(64, "Slug trop long.")
  .regex(/^[a-z0-9-]+$/, "Le slug ne peut contenir que des lettres minuscules, chiffres et tirets.");

const localizedFieldSchema = z.object({
  fr: z.string().trim().min(1, "Le texte français est requis.").max(5000, "Texte trop long."),
  ar: z.string().trim().max(5000, "Texte trop long.").optional(),
  en: z.string().trim().max(5000, "Texte trop long.").optional(),
});

export const serviceCreateSchema = z.object({
  slug: slugSchema,
  name: localizedFieldSchema,
  description: localizedFieldSchema,
  durationMinutes: z
    .number({ message: "La durée est requise." })
    .int("La durée doit être un nombre entier.")
    .min(5, "La durée minimum est de 5 minutes.")
    .max(480, "La durée maximum est de 480 minutes."),
  price: z.number().int().min(0, "Le prix ne peut pas être négatif.").nullable().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
});

export const servicePatchSchema = z
  .object({
    slug: slugSchema.optional(),
    name: localizedFieldSchema.optional(),
    description: localizedFieldSchema.optional(),
    durationMinutes: z
      .number()
      .int("La durée doit être un nombre entier.")
      .min(5, "La durée minimum est de 5 minutes.")
      .max(480, "La durée maximum est de 480 minutes.")
      .optional(),
    price: z.number().int().min(0, "Le prix ne peut pas être négatif.").nullable().optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.slug !== undefined ||
      v.name !== undefined ||
      v.description !== undefined ||
      v.durationMinutes !== undefined ||
      v.price !== undefined ||
      v.currency !== undefined ||
      v.active !== undefined,
    { message: "Aucune modification fournie." },
  );

export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
export type ServicePatchInput = z.infer<typeof servicePatchSchema>;
export type LocalizedFieldInput = z.infer<typeof localizedFieldSchema>;
