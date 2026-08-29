import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { SECURITY_HEADERS, NO_REFERRER_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  headers: async () => [...SECURITY_HEADERS, ...NO_REFERRER_HEADERS],
  // CLAUDE.md and AGENTS.md are hand-maintained here (see CLAUDE.md). Without
  // this flag `next dev` regenerates both on every start and overwrites them.
  agentRules: false,
};
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
