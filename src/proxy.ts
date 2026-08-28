import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import {
  readSessionTokenFromCookieHeader,
  verifySessionToken,
} from "@/lib/auth/session";

// Proxy (Next.js 16 middleware):
//   1. /admin* — the FR-only dashboard lives OUTSIDE [locale] and is
//      session-guarded here: unauthenticated / tampered / expired cookies are
//      redirected to /admin/login. This is the cheap gate for page navigation;
//      the authoritative per-request re-check (active, tokenVersion, roles)
//      lives in `requireStaff` (lib/auth/guard.ts) and the admin layout.
//   2. everything else — next-intl locale negotiation for the trilingual
//      public site (fr / ar / en).

const intlMiddleware = createMiddleware(routing);

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAdminPath(pathname)) {
    // The login page is always reachable — its own server component does the
    // DB-backed "already signed in → /admin" redirect, which the proxy
    // cannot do safely (see note below).
    if (pathname === "/admin/login") {
      return NextResponse.next();
    }

    const payload = await verifySessionToken(
      readSessionTokenFromCookieHeader(request.headers.get("cookie")),
    );
    if (!payload) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    // NOTE: deliberately no "already signed in → /admin" branch anywhere
    // here. The proxy cannot tell a revoked/deactivated session (cookie
    // still signed, DB says no) from a live one; redirecting to /admin would
    // bounce back to /admin/login from the dashboard layout — an infinite
    // redirect loop for exactly the revocation scenario Task 12 exists to
    // handle. The login page's own check handles the live-session case.
    return NextResponse.next();
  }

  return intlMiddleware(request);
}

export const config = {
  // Match all pathnames except for:
  // - those starting with /api, /trpc, /_next or /_vercel
  // - those containing a dot (e.g. favicon.ico)
  // NOTE: /admin is deliberately matched now (unlike the Task 2 version) so
  // the dashboard session guard above runs. API routes guard themselves via
  // requireStaff — never via this proxy.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
