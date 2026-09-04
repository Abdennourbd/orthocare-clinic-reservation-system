/**
 * Same-site origin guard for state-changing public requests (plan.md §CSRF).
 *
 * Browsers always send the `Origin` header on cross-origin POSTs (and on
 * same-origin POSTs), and a hostile page cannot forge it. So a public write
 * endpoint can cheaply reject requests whose Origin/Referer host is not the
 * site itself — blocking cross-site calendar pollution, quota consumption and
 * bookings under a victim's phone number.
 *
 * `Referer` is only consulted when `Origin` is absent (older clients). A
 * request with NEITHER header is assumed to be a non-browser client (curl,
 * server-to-server) and allowed.
 *
 * Localhost is always treated as same-site so local dev and the integration
 * tests are unaffected. The production origin comes from `APP_URL`.
 *
 * Fail-closed contract (mirrors the strict admin guard in
 * `src/lib/auth/guard.ts`): in production, a request whose Origin matches
 * the Host the server itself received is same-origin by definition (an
 * attacker page cannot forge a matching pair), so any deployment URL works
 * without APP_URL configuration — but with neither Host-match nor APP_URL
 * we reject rather than accept. Outside production we stay permissive so
 * local dev and tests are unaffected.
 */
export function isSameSiteOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const value = origin ?? referer;
  if (!value) return true;

  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // Deployment-origin match (same logic as the strict admin guard in
  // `guard.ts`): a request whose Origin equals the Host the server itself
  // received is same-origin by definition — an attacker page cannot forge a
  // matching pair. This keeps production working without APP_URL set.
  // (`x-forwarded-host` covers proxies that rewrite Host.)
  const hostHeader =
    request.headers.get("host") ?? request.headers.get("x-forwarded-host");
  if (hostHeader) {
    const hostHostname = hostHeader.split(":")[0]?.trim().toLowerCase();
    if (hostHostname && hostHostname === hostname) return true;
  }

  // Fail closed: without any way to pin the expected origin we cannot
  // distinguish a hostile cross-site origin from our own. In production an
  // unset APP_URL must reject, not stay permissive (dev keeps the old
  // lenient behavior so local work and tests are unaffected).
  const appUrl = process.env.APP_URL;
  if (!appUrl) return process.env.NODE_ENV !== "production";
  try {
    return new URL(appUrl).hostname === hostname;
  } catch {
    return false;
  }
}