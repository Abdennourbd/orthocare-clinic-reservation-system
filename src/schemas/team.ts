import { z } from "zod";

// Task 20 — team management schemas, shared between the admin route handlers
// and the dashboard form. FR-only messages (admin dashboard is FR-only,
// plan.md). Password SHAPE (non-empty, max) is checked here; password POLICY
// (12 chars, common-password block) is enforced in the routes via
// validatePasswordPolicy() so the failure code is WEAK_PASSWORD, not a flat
// VALIDATION_ERROR.

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis.").max(100, "Nom trop long."),
  email: z.string().trim().toLowerCase().email("Email invalide.").max(200),
  password: z.string().min(1, "Le mot de passe est requis.").max(200),
});

export const teamPatchSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est requis.").max(100, "Nom trop long.").optional(),
    role: z.enum(["ADMIN", "RECEPTIONIST"], { message: "Rôle invalide." }).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.active !== undefined, {
    message: "Aucune modification fournie.",
  });

export const teamResetPasswordSchema = z.object({
  newPassword: z.string().min(1, "Le mot de passe est requis.").max(200),
});

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamPatchInput = z.infer<typeof teamPatchSchema>;
export type TeamResetPasswordInput = z.infer<typeof teamResetPasswordSchema>;
