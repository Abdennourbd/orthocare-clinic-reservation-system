import { z } from "zod";

// Task 21 — testimonials / FAQs / gallery schemas, shared between admin
// routes and dashboard forms. FR-only messages (admin FR-only).
//
// Ids are non-empty strings, never strict cuids (same convention as
// waitlist.ts): the matrix probe id ("does-not-exist") must reach the DB
// lookup and return the indistinguishable 404, not a 400 from Zod.

const keySchema = z
  .string()
  .trim()
  .min(1, "La clé est requise.")
  .max(64, "Clé trop longue.")
  .regex(/^[a-zA-Z0-9_-]+$/, "La clé ne peut contenir que lettres, chiffres, tirets et underscores.");

const localizedFieldSchema = z.object({
  fr: z.string().trim().min(1, "Le texte français est requis.").max(5000, "Texte trop long."),
  ar: z.string().trim().max(5000, "Texte trop long.").optional(),
  en: z.string().trim().max(5000, "Texte trop long.").optional(),
});

// --- Testimonials ---

export const testimonialCreateSchema = z.object({
  key: keySchema,
  author: localizedFieldSchema,
  content: localizedFieldSchema,
  rating: z
    .number({ message: "La note est requise." })
    .int("La note doit être un nombre entier.")
    .min(1, "La note minimum est 1.")
    .max(5, "La note maximum est 5."),
  active: z.boolean().optional(),
});

export const testimonialPatchSchema = z
  .object({
    key: keySchema.optional(),
    author: localizedFieldSchema.optional(),
    content: localizedFieldSchema.optional(),
    rating: z.number().int().min(1, "La note minimum est 1.").max(5, "La note maximum est 5.").optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.key !== undefined ||
      v.author !== undefined ||
      v.content !== undefined ||
      v.rating !== undefined ||
      v.active !== undefined,
    { message: "Aucune modification fournie." },
  );

// --- FAQs ---

export const faqCreateSchema = z.object({
  key: keySchema,
  question: localizedFieldSchema,
  answer: localizedFieldSchema,
  active: z.boolean().optional(),
});

export const faqPatchSchema = z
  .object({
    key: keySchema.optional(),
    question: localizedFieldSchema.optional(),
    answer: localizedFieldSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.key !== undefined ||
      v.question !== undefined ||
      v.answer !== undefined ||
      v.active !== undefined,
    { message: "Aucune modification fournie." },
  );

// --- Gallery ---

// Images render as <img src> on the public gallery — only local paths and
// http(s) URLs are allowed (never javascript:/data:/file: schemes).
const imageUrlSchema = (required: boolean) => {
  const base = z.string().trim().max(2000, "URL trop longue.");
  const withMin = required
    ? base.min(1, "L'URL de l'image est requise.")
    : base.min(1, "L'URL ne peut pas être vide.");
  return withMin.refine((u) => u.startsWith("/") || /^https?:\/\//i.test(u), {
    message: "Seules les URLs http(s) ou les chemins locaux (/images/…) sont autorisés.",
  });
};

export const galleryCreateSchema = z.object({
  key: keySchema,
  imageUrl: imageUrlSchema(true),
  caption: localizedFieldSchema,
  active: z.boolean().optional(),
});

export const galleryPatchSchema = z
  .object({
    key: keySchema.optional(),
    imageUrl: imageUrlSchema(false).optional(),
    caption: localizedFieldSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.key !== undefined ||
      v.imageUrl !== undefined ||
      v.caption !== undefined ||
      v.active !== undefined,
    { message: "Aucune modification fournie." },
  );

export type TestimonialCreateInput = z.infer<typeof testimonialCreateSchema>;
export type TestimonialPatchInput = z.infer<typeof testimonialPatchSchema>;
export type FaqCreateInput = z.infer<typeof faqCreateSchema>;
export type FaqPatchInput = z.infer<typeof faqPatchSchema>;
export type GalleryCreateInput = z.infer<typeof galleryCreateSchema>;
export type GalleryPatchInput = z.infer<typeof galleryPatchSchema>;
