import { getPrisma } from "@/lib/db";
import { errorResponse } from "@/lib/api/http";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  createSessionCookieHeader,
  readSessionTokenFromCookieHeader,
  type SessionPayload,
  type SessionRole,
} from "./session";

// Task 12 — request guard for every authenticated surface (plan.md §Auth/RBAC
// + §CSRF). Route handlers call `requireStaff(request, { roles })` and short-
// circuit on `!result.ok`. The proxy (src/proxy.ts) does the cheap cookie
// signature/expiry check for page navigation; this guard is the real
// enforcement point because it re-checks `active` and `tokenVersion` against
// the database on every request — a bumped tokenVersion revokes live sessions
// instantly, which a stateless cookie alone cannot do.

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: SessionRole;
  mustChangePassword: boolean;
}

export type StaffGuardResult =
  | { ok: true; user: StaffUser; payload: SessionPayload; refreshCookie: string }
  | { ok: false; response: Response };

/**
 * Strict same-site origin check for state-changing (non-GET) requests on
 * authenticated surfaces. Unlike the permissive public check
 * (`lib/security/origin.ts`), an authenticated admin API has no legitimate
 * non-browser caller, so a present-but-mismatched Origin/Referer is always a
 * CSRF attempt. Missing both headers is still allowed (curl, tests) — the
 * session cookie itself cannot be sent cross-site by a browser with
 * SameSite=Lax, so this is defense in depth, not the only line.
 *
 * Localhost is always same-site so local dev and tests are unaffected.
 */
export function assertSameOriginStrict(request: Request): boolean {
  const value =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!value) return true;

  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return true;
  }

  const appUrl = process.env.APP_URL;
  // Fail closed: without a configured origin we cannot distinguish a hostile
  // cross-site origin from our own, so only the explicit dev exemptions apply.
  if (!appUrl) return false;
  try {
    return new URL(appUrl).hostname === hostname;
  } catch {
    return false;
  }
}

export interface RequireStaffOptions {
  roles?: SessionRole[];
  /**
   * Routes that must stay reachable while `mustChangePassword` is set
   * (logout, me, change-password) pass `true`. Everything else — every admin
   * route — rejects with 403 PASSWORD_CHANGE_REQUIRED so an admin-issued
   * one-time reset cannot be used indefinitely without rotating it.
   */
  allowPasswordChangePending?: boolean;
}

/**
 * Verify the session cookie, re-check the user against the DB (exists, active,
 * tokenVersion matches), enforce the forced password-change gate and optional
 * role gating.
 */
export async function requireStaff(
  request: Request,
  opts: RequireStaffOptions = {},
): Promise<StaffGuardResult> {
  const token = readSessionTokenFromCookieHeader(
    request.headers.get("cookie"),
  );
  const payload = await verifySessionToken(token);
  if (!payload) {
    return {
      ok: false,
      response: errorResponse(401, "UNAUTHENTICATED", "Session invalide ou expirée."),
    };
  }

  const user = await getPrisma().user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      tokenVersion: true,
      mustChangePassword: true,
    },
  });

  if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) {
    return {
      ok: false,
      response: errorResponse(401, "UNAUTHENTICATED", "Session invalide ou expirée."),
    };
  }

  if (user.mustChangePassword && !opts.allowPasswordChangePending) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "Veuillez changer votre mot de passe.",
      ),
    };
  }

  if (opts.roles && !opts.roles.includes(user.role as SessionRole)) {
    return {
      ok: false,
      response: errorResponse(403, "FORBIDDEN", "Accès refusé."),
    };
  }

  // Sliding idle window: re-issue the cookie with a fresh `lastActive`, but
  // anchor `iat` to the original login so the absolute 12h cap is never reset.
  const refreshCookie = await createSessionCookieHeader({
    userId: user.id,
    role: user.role as SessionRole,
    tokenVersion: user.tokenVersion,
    iat: payload.iat,
  });

  return {
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as SessionRole,
      mustChangePassword: user.mustChangePassword,
    },
    payload,
    refreshCookie,
  };
}

/** Merge the refreshed session cookie into an outgoing response. */
export function withRefreshedSession<T extends Response>(
  response: T,
  guard: Extract<StaffGuardResult, { ok: true }>,
): T {
  response.headers.append("Set-Cookie", guard.refreshCookie);
  return response;
}

/**
 * Server-component variant of `requireStaff`: reads the session from the
 * Next.js cookie store (RSC layout/page context) instead of a Request.
 * Returns null when unauthenticated, deactivated, or revoked via tokenVersion.
 */
export async function getStaffFromCookies(): Promise<StaffUser | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const payload = await verifySessionToken(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  if (!payload) return null;

  const user = await getPrisma().user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      tokenVersion: true,
      mustChangePassword: true,
    },
  });
  if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) {
    return null;
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as SessionRole,
    mustChangePassword: user.mustChangePassword,
  };
}
