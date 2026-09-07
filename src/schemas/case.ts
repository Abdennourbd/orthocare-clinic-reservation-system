import { z } from "zod";
import { ALLOWED_IMAGE_TYPES, type AllowedImageMimeType } from "@/lib/gallery/images";

// G2 — Zod schemas for patient case gallery, shared between admin routes
// and dashboard forms (one schema, never duplicated). Admin FR-only, so
// messages are French — same convention as src/schemas/content.ts.
//
// Ids are non-empty strings, never strict cuids (same convention as
// content.ts): the matrix probe id ("does-not-exist") must reach the DB
// lookup and return the indistinguishable 404, not a 400 from Zod.

const keySchema = z
  .string()
  .trim()
  .min(1, "La clé est requise.")
  .max(64, "Clé trop longue.")
  .regex(/^[a-zA-Z0-9_-]+$/, "La clé ne peut contenir que lettres, chiffres, tirets et underscores.");

const localizedText = (max: number) =>
  z.object({
    fr: z.string().trim().min(1, "Le texte français est requis.").max(max, "Texte trop long."),
    ar: z.string().trim().max(max, "Texte trop long.").optional(),
    en: z.string().trim().max(max, "Texte trop long.").optional(),
  });

// Images render inline on PUBLIC pages — only local paths and http(s) URLs
// are allowed (never javascript:/data:/file: schemes). Same rule as the
// gallery schemas in content.ts.
const imageUrlSchema = z
  .string()
  .trim()
  .min(1, "L'URL de l'image est requise.")
  .max(2000, "URL trop longue.")
  .refine((u) => u.startsWith("/") || /^https?:\/\//i.test(u), {
    message: "Seules les URLs http(s) ou les chemins locaux (/images/…) sont autorisés.",
  });

// Publication requires written patient consent. Zod rejects the explicit
// contradiction (active + consentConfirmed:false); the route additionally
// checks the merged DB state, so PATCH {active:true} on an unconsented case
// is also refused even when consent is simply absent from the body.
const consentRefine = (
  v: { active?: boolean; consentConfirmed?: boolean },
  ctx: z.RefinementCtx,
) => {
  if (v.active === true && v.consentConfirmed === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Le consentement écrit du patient est requis pour publier ce cas.",
    });
  }
};

export const caseCreateSchema = z
  .object({
    key: keySchema,
    title: localizedText(200),
    description: localizedText(5000),
    beforeImageUrl: imageUrlSchema,
    afterImageUrl: imageUrlSchema,
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    featured: z.boolean().optional(),
    featuredOrder: z.number().int().min(0).max(9999).optional(),
    consentConfirmed: z.boolean().optional(),
  })
  .superRefine(consentRefine);

export const casePatchSchema = z
  .object({
    key: keySchema.optional(),
    title: localizedText(200).optional(),
    description: localizedText(5000).optional(),
    beforeImageUrl: imageUrlSchema.optional(),
    afterImageUrl: imageUrlSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    featured: z.boolean().optional(),
    featuredOrder: z.number().int().min(0).max(9999).optional(),
    consentConfirmed: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.key !== undefined ||
      v.title !== undefined ||
      v.description !== undefined ||
      v.beforeImageUrl !== undefined ||
      v.afterImageUrl !== undefined ||
      v.active !== undefined ||
      v.sortOrder !== undefined ||
      v.featured !== undefined ||
      v.featuredOrder !== undefined ||
      v.consentConfirmed !== undefined,
    { message: "Aucune modification fournie." },
  )
  .superRefine(consentRefine);

export const caseExtraCreateSchema = z.object({
  imageUrl: imageUrlSchema,
  caption: localizedText(500),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

// Upload metadata travelling alongside the file. Zod never looks at bytes —
// content is validated separately by validateCaseImageBytes.
const FORBIDDEN_NAME_PATTERN = /[\x00-\x1f\x7f\\/";]|\.\./;

const imageMimeKeys = Object.keys(ALLOWED_IMAGE_TYPES) as [
  AllowedImageMimeType,
  ...AllowedImageMimeType[],
];

export const caseUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "Le nom du fichier est requis.")
    .max(255, "Le nom du fichier est limité à 255 caractères.")
    .refine((value) => !FORBIDDEN_NAME_PATTERN.test(value), {
      message: "Le nom du fichier contient des caractères non autorisés.",
    }),
  declaredMimeType: z.enum(imageMimeKeys, {
    message: "Type de fichier non autorisé.",
  }),
});

export type CaseCreateInput = z.infer<typeof caseCreateSchema>;
export type CasePatchInput = z.infer<typeof casePatchSchema>;
export type CaseExtraCreateInput = z.infer<typeof caseExtraCreateSchema>;
export type CaseUploadInput = z.infer<typeof caseUploadSchema>;
