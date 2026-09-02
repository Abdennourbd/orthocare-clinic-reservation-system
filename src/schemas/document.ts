import { z } from "zod";
import { ALLOWED_TYPES, type AllowedMimeType } from "@/lib/documents/mime";

// Task 15 step 2 — shared metadata schema for a document upload, imported by
// both the route handler (step 3) and the upload form (step 5), per the
// Definition of Done (tasks/todo.md:12 — one Zod schema, never duplicated).
// The admin dashboard is French-only (task-15.md §Contexte, verified in
// src/app/admin/layout.tsx), so messages are French, same convention as
// src/schemas/patient.ts.
//
// This schema only checks the metadata that travels alongside the file
// (`name`, `declaredMimeType`) — Zod does not look at bytes. The binary
// content itself is validated separately by
// `validateDocumentBytes` (src/lib/documents/mime.ts), which is the module
// that actually decides what a file is allowed to be.

/** Rejects any control character (this includes \r and \n — both are below
 * 0x20), any path separator (`/` or `\`), any ".." segment, and the two
 * `Content-Disposition` header-grammar metacharacters `"` and `;`. `name` is
 * stored in the database and later DISPLAYED to staff (dir="auto", same
 * rule as patient names — task-15.md §Contexte) — never used to derive the
 * blob's storage key (buildBlobKey, src/lib/documents/blobStorage.ts), but a
 * hostile name could still smuggle a CRLF into a future response header or a
 * path segment into a future log line if left unchecked here. `"` and `;`
 * matter specifically because step 4 echoes `name` into
 * `Content-Disposition: attachment; filename="<name>"`: an unescaped `"`
 * closes that quoted parameter early, letting a second parameter — including
 * a `filename*` that takes priority over `filename` per RFC 6266 §4.3 — be
 * injected right after it (ortho-security audit, task-15.md §Étape 2). */
const FORBIDDEN_NAME_PATTERN = /[\x00-\x1f\x7f\\/";]|\.\./;

/** Derived from ALLOWED_TYPES's own keys — never a second, hand-written
 * list that could drift from the one true allow-list in mime.ts. */
const mimeTypeKeys = Object.keys(ALLOWED_TYPES) as [
  AllowedMimeType,
  ...AllowedMimeType[],
];

export const documentUploadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Le nom du fichier est requis.")
    .max(255, "Le nom du fichier est limité à 255 caractères.")
    .refine((value) => !FORBIDDEN_NAME_PATTERN.test(value), {
      message: "Le nom du fichier contient des caractères non autorisés.",
    }),
  declaredMimeType: z.enum(mimeTypeKeys, {
    message: "Type de fichier non autorisé.",
  }),
});

export type DocumentUploadInput = z.infer<typeof documentUploadSchema>;
