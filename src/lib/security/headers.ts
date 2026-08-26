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
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
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
