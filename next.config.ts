import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";
import { SECURITY_HEADERS, NO_REFERRER_HEADERS } from "./src/lib/security/headers";
import { LEGACY_REDIRECTS } from "./src/lib/seo/redirects";

const nextConfig: NextConfig = {
  headers: async () => [...SECURITY_HEADERS, ...NO_REFERRER_HEADERS],
  // 301s from clinicorthocare.com (Task 23). Audited source list lives in
  // src/lib/seo/redirects.ts — old site had 2 indexed URLs (/ + /privacy-policy/).
  redirects: async () => LEGACY_REDIRECTS.map((r) => ({ ...r })),
  // Gallery images may be admin-uploaded remote URLs (Vercel Blob) or local
  // /images/* files — next/image optimizes both, remote hosts allow-listed.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
  // CLAUDE.md and AGENTS.md are hand-maintained here (see CLAUDE.md). Without
  // this flag `next dev` regenerates both on every start and overwrites them.
  agentRules: false,
};
const withNextIntl = createNextIntlPlugin();

// Sentry sourcemap upload only when a DSN is configured (prod/staging).
// Local builds stay dependency-free and green without it.
const withSentry =
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
    ? (c: NextConfig) =>
        withSentryConfig(c, {
          silent: true,
          widenClientFileUpload: true,
        })
    : (c: NextConfig) => c;

export default withSentry(withNextIntl(nextConfig));
