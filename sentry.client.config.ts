import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/monitoring/sentryScrub";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Never ship PII to Sentry by default (Task 23). Patient names, request
    // bodies and self-service tokens are scrubbed in beforeSend as well.
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    denyUrls: [/\/appointment\//],
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as never;
    },
  });
}
