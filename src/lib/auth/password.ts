import * as argon2 from "argon2";

// Task 12 — password hashing + policy (plan.md §Auth/RBAC).
//
//   - argon2id (the provider default when no type is given, pinned explicitly
//     here so a library default change cannot silently weaken storage)
//   - minimum 12 characters
//   - blocked against a small common-password list (cheap check; the 12-char
//     floor already excludes most dictionary entries — this catches the long
//     trivially-guessable ones like "123456789012")

const MIN_LENGTH = 12;

// Small list of trivially-guessable passwords that pass the length floor.
// Matched case-insensitively against the exact value.
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "12345678901234",
  "password123456",
  "passwordpassword",
  "qwertyuiop123",
  "qwerty1234567",
  "aaaaaaaaaaaa12",
  "111111111111",
  "000000000000",
  "orthocare2026",
  "orthocare2024",
  "clinique12345",
  "bienvenue2026",
]);

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: string };

// Argon2 parameters are PINNED (not left to library defaults) so a future
// argon2 upgrade cannot silently change hash strength — or silently break the
// timing equalization below, which depends on DUMMY_HASH sharing hashPassword's
// exact cost parameters (guarded by a unit test).
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

// Synthetic hash burned on the login route's no-such-account / locked paths so
// every login response costs roughly the same CPU regardless of whether the
// email exists (timing-based account enumeration defence). Must share
// ARGON2_OPTIONS — verified in password.test.ts.
export const DUMMY_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$ytWjh4h3waLW6rN4djABAQ$luCkfs/+U0zFvKzYWKAB71+skxEHAQWnnoIF7SyWn2Y";

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères.` };
  }
  const normalized = password.toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) {
    return { ok: false, reason: "Ce mot de passe est trop courant. Choisissez-en un plus sûr." };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash stored in DB — treat as a failed verification rather
    // than throwing into the login route.
    return false;
  }
}
