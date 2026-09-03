import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/monitoring/sentryScrub";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubEvent(event as unknown as Record<string, unknown>) as never;
    },
  });
}
