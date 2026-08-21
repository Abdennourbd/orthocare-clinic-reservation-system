import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { SECURITY_HEADERS, NO_REFERRER_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  headers: async () => [...SECURITY_HEADERS, ...NO_REFERRER_HEADERS],
};
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
