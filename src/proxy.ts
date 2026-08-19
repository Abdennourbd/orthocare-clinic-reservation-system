import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for:
  // - those starting with /api, /trpc, /_next or /_vercel
  // - those containing a dot (e.g. favicon.ico)
  // - /admin and its subpaths (the FR-only dashboard lives outside [locale])
  matcher:
    "/((?!api|trpc|_next|_vercel|admin|.*\\..*).*)",
};
