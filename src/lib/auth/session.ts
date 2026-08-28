// Task 12 — signed session cookie (plan.md §Auth/RBAC).
//
//   - HMAC-SHA256 signature over a compact JSON payload (Web Crypto, so this
//     module is importable from both the proxy/middleware edge runtime and
//     Node route handlers)
//   - Cookie: `__Host-` prefixed (requires Secure + Path=/ + no Domain),
//     HttpOnly, SameSite=Lax
//   - Absolute expiry 12h, idle expiry 2h (sliding — routes re-issue the
//     cookie with a fresh `lastActive` on each authenticated request)
//   - `tokenVersion` claim: the guard compares it against the DB row, so a
//     bump (deactivation / password reset) instantly invalidates live sessions

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // absolute: 12h
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // idle: 2h

export const SESSION_COOKIE_NAME = "__Host-orthocare_session";

export type SessionRole = "ADMIN" | "RECEPTIONIST";

export interface SessionPayload {
  userId: string;
  role: SessionRole;
  tokenVersion: number;
  /** Issued-at (epoch ms). */
  iat: number;
  /** Last activity (epoch ms) — the idle-expiry anchor. */
  lastActive: number;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Generate one with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

// ── base64url helpers (no Node Buffer, edge-safe) ──────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// ── token creation / verification ──────────────────────────────────────────

export async function createSessionToken(
  input: Omit<SessionPayload, "iat" | "lastActive"> & {
    iat?: number;
    lastActive?: number;
  },
): Promise<string> {
  const now = Date.now();
  const payload: SessionPayload = {
    ...input,
    iat: input.iat ?? now,
    lastActive: input.lastActive ?? now,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns the payload when the token is intact and within both TTLs, else null. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let expected: Uint8Array;
  try {
    expected = fromBase64Url(sigPart);
  } catch {
    return null;
  }
  const key = await hmacKey();
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      expected as unknown as ArrayBuffer,
      encoder.encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (
    typeof payload.userId !== "string" ||
    typeof payload.tokenVersion !== "number" ||
    typeof payload.iat !== "number" ||
    typeof payload.lastActive !== "number"
  ) {
    return null;
  }

  const now = Date.now();
  if (now - payload.iat > SESSION_TTL_MS) return null; // absolute expiry
  if (now - payload.lastActive > IDLE_TTL_MS) return null; // idle expiry
  return payload;
}

// ── cookie header builders (plain Response-compatible, no next/headers) ────

export async function createSessionCookieHeader(
  input: Omit<SessionPayload, "iat" | "lastActive"> & { iat?: number },
): Promise<string> {
  const now = Date.now();
  // `iat` must be propagated on refresh (guard.ts) so the ABSOLUTE 12h expiry
  // is anchored to the original login, not reset on every request. Only
  // `lastActive` slides.
  const iat = input.iat ?? now;
  const token = await createSessionToken({ ...input, iat, lastActive: now });
  const maxAge = Math.max(0, Math.floor((SESSION_TTL_MS - (now - iat)) / 1000));
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Extract the raw session token from a Request's Cookie header. */
export function readSessionTokenFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return null;
}
