/**
 * Canonical client-IP resolver for rate limiting and audit logging.
 *
 * THE PROBLEM IT SOLVES
 * ---------------------
 * `x-forwarded-for` is attacker-controlled: a client can set it to any value,
 * so reading it directly lets an attacker mint a fresh identity per request
 * and bypass every per-IP rate limit. The only headers we may trust are the
 * ones injected by the trusted reverse proxy in front of the app (Vercel
 * sets `x-real-ip` and `x-vercel-forwarded-for`). These are overwritten by
 * the edge, so a client cannot forge them.
 *
 * Priority (first non-empty match):
 *   1. `x-real-ip`            (set by Vercel / nginx-style proxies)
 *   2. `x-vercel-forwarded-for` (Vercel-specific, comma list, leftmost = client)
 *   3. Vercel's non-standard `cf-connecting-ip`-like? -> no. Fall through.
 *   4. `x-forwarded-for`      ONLY as a last resort and only when NOT directly
 *                             client-reachable (see `trustForwardedFor`).
 *
 * We deliberately do NOT read `x-forwarded-for` by default: in a deployment
 * where clients hit the origin directly (e.g. local dev / self-host), it is
 * forgeable and must not be trusted for rate limiting.
 */

const FORWARDED_HEADERS = ["x-vercel-forwarded-for", "x-real-ip"] as const;

/**
 * Return the best-effort client IP, or `null` when none can be trusted.
 *
 * @param headers Headers map (from a Next.js `Request`, e.g. `request.headers`).
 * @param opts.trustForwardedFor When `true`, fall back to `x-forwarded-for`'s
 *   first value. Only enable this behind a proxy that sanitizes the header;
 *   leave off by default.
 */
export function getClientIp(
  headers: Headers | Record<string, string | string[] | undefined>,
  opts: { trustForwardedFor?: boolean } = {},
): string | null {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name);
    }
    const value = headers[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  // Trusted proxy headers first.
  for (const name of FORWARDED_HEADERS) {
    const value = get(name)?.trim();
    if (value) return value.split(",")[0].trim();
  }

  if (opts.trustForwardedFor) {
    const fwd = get("x-forwarded-for")?.trim();
    if (fwd) return fwd.split(",")[0].trim();
  }

  return null;
}
