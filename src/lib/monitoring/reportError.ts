import * as Sentry from "@sentry/nextjs";

/**
 * PII-safe error reporting for post-commit side effects (messaging fan-out,
 * waitlist notification, audit writes…).
 *
 * Never logs or ships the error OBJECT: Prisma validation errors serialize
 * field values and provider errors can echo recipient numbers, so both the
 * console line and the Sentry event carry the stable label + error class
 * only. Never throws itself.
 */
export function reportError(label: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  try {
    console.warn(JSON.stringify({ event: label, error: name }));
    Sentry.captureException(new Error(`${label}: ${name}`), {
      tags: { scope: "side-effect", label },
    });
  } catch {
    // Reporting must never throw.
  }
}
