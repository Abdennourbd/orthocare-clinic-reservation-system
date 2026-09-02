import { SmsMessageType } from "@/generated/prisma/client";

// Transactional vs non-transactional (plan.md §Messaging).
//
// Transactional messages (booking received, confirmation, reschedule,
// cancellation, staff manual sends) are the service the patient asked for and
// are ALWAYS sent. Non-transactional messages (waitlist offers, no-show
// follow-up, delay broadcasts) are suppressed for patients with
// `messagingOptOut = true`.
//
// The dispatcher (`lib/messaging/index.ts`) is the ONLY place this split is
// enforced — no feature bypasses it.
export const NON_TRANSACTIONAL_TYPES: ReadonlySet<SmsMessageType> = new Set([
  SmsMessageType.NO_SHOW,
  SmsMessageType.DELAY,
  SmsMessageType.WAITLIST,
]);

export function isTransactional(type: SmsMessageType): boolean {
  return !NON_TRANSACTIONAL_TYPES.has(type);
}