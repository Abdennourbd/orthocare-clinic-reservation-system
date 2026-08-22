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
 * tests are unaffected. The production origin comes from `APP_URL`; when it is
 * not configured we stay permissive (Task 12 ships the strict CSRF layer for
 * the authenticated admin routes).
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

  const appUrl = process.env.APP_URL;
  if (!appUrl) return true;
  try {
    return new URL(appUrl).hostname === hostname;
  } catch {
    return false;
  }
}