/**
 * Security headers for the app, wired in via `next.config.ts`.
 *
 * NOTE ON REFERRER LEAKAGE (plan.md §Self-service link):
 * The self-service appointment token sits in the URL. Any page that embeds a
 * third-party script (Google Reviews / Maps) will send that token to the
 * vendor in the `Referer` header unless `Referrer-Policy: no-referrer` is set.
 * The token pages (`/[locale]/appointment/[token]`) must therefore apply the
 * STRICTER `noReferrerHeaders()` (and load no third-party scripts at all).
 *
 * Google embeds (Task 10) must be allow-listed in the CSP below BEFORE they
 * are mounted; see the CSP comment.
 */

import type { NextConfig } from "next";

type HeaderRule = NonNullable<
  NonNullable<NextConfig["headers"]> extends (
    ...args: never[]
  ) => infer R
    ? R extends Promise<infer PR>
      ? PR
      : R
    : never
>;
type Header = HeaderRule[number];

/**
 * `unsafe-eval` exists only for `next dev` (eval-source-map); production
 * builds never need it, so the production CSP drops it. `unsafe-inline`
 * stays in both: Next.js emits inline RSC scripts without a nonce unless
 * nonce plumbing is configured (a follow-up, not this task).
 * Evaluated at import time — `next.config.ts` loads this module at startup
 * with the deployment's real NODE_ENV.
 */
function scriptSrc(): string {
  return process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
}

export const SECURITY_HEADERS: Header[] = [
  {
    source: "/(.*)",
    headers: [
      // Content-Security-Policy: strict-by-default. Task 10 added `frame-src`
      // for the Google Reviews widget + Maps iframe (`google.com/maps/embed`
      // and `maps.google.com`). Only `frame-src` is extended: the iframe's own
      // scripts/images are governed by Google's CSP, not the parent's, so
      // adding `script-src`/`img-src`/`connect-src` here would widen the
      // policy without enabling anything. The self-service token pages get the
      // stricter no-referrer set below and must NEVER gain these domains.
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          scriptSrc(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self'",
          "frame-src https://www.google.com https://maps.google.com",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ],
  },
];

/**
 * Stricter headers for the self-service token pages, where the appointment
 * token is present in the URL. Sends `Referrer-Policy: no-referrer` so no
 * `Referer` header (and therefore no token) is disclosed to any linked or
 * embedded resource. These pages must also load NO third-party scripts.
 *
 * NOTE (Task 23): Next.js auto-emits `Link: rel=alternate hreflang` response
 * headers for every route under `[locale]` (framework behavior, not our
 * metadata — the token page sets no alternates and its HTML carries no
 * hreflang links). Those headers technically advertise alternate token URLs,
 * so the `X-Robots-Tag: noindex, nofollow` below is load-bearing: crawlers
 * must never index a capability-token URL even if they discover one (e.g. a
 * forwarded SMS link). Belt-and-braces with robots.txt Disallow + the
 * `<meta name=robots noindex>` on the token page itself.
 *
 * The CSP here mirrors `SECURITY_HEADERS` (Next.js's own inline RSC scripts +
 * self-hosted chunks must be allowed or the page never hydrates) BUT it is a
 * hard override of the global CSP: it must NEVER gain the Google embed domains
 * that Task 10 adds to the global `script-src`/`frame-src`/`img-src` — a
 * widget receiving the token in its `Referer` header is the exact leak this
 * rule exists to prevent. `frame-ancestors 'none'` stops clickjacking of the
 * token page.
 */
export const NO_REFERRER_HEADERS: Header[] = [
  {
    source: "/:locale/appointment/:token(.*)",
    headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Capability-token URLs must never be indexed even if discovered
      // (robots.txt Disallow is advisory only).
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          scriptSrc(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ],
  },
];
