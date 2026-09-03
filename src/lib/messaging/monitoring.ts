import { getPrisma } from "@/lib/db";

// Task 22 — cost awareness + send-volume guard (observability skill).
//
// On-call questions this answers:
// 1. "How much does a message cost?" → MESSAGE_COSTS_USD + estimateCostUsd.
//    Estimates for DZ numbers (plan.md §Messaging): Twilio SMS ~$0.27/segment
//    (alphanumeric sender ID required on Mobilis); WhatsApp ~$0.01–0.02/msg.
// 2. "Are we suddenly sending far more than normal?" →
//    checkMessageVolume() counts SmsMessage rows in a trailing window; the
//    caller logs/alerts when breached. The external alert (Vercel log drain /
//    uptime monitor watching SmsMessage.failedCount spikes) is documented in
//    docs/messaging-production.md — Sentry catches errors, not silence.

export const MESSAGE_COSTS_USD = {
  /** Twilio SMS to Algeria, per 160-char (GSM-7) segment. */
  twilioSmsPerSegment: 0.27,
  /** WhatsApp Business API to DZ, per delivered message (Jul-2025 pricing). */
  whatsappPerMessage: 0.02,
} as const;

/** Hourly tripwire: ~600–800 msgs/month ≈ 30/day, so 200/hour is a spike. */
export const DEFAULT_VOLUME_THRESHOLD_PER_HOUR = 200;

function isAscii(body: string): boolean {
  return /^[\x00-\x7F]*$/.test(body);
}

/**
 * Billable SMS segments for `body` (GSM-7: 160 first, 153 concatenated;
 * UCS-2 e.g. Arabic: 70 first, 67 concatenated).
 */
export function smsSegments(body: string): number {
  if (body.length === 0) return 1;
  if (isAscii(body)) {
    return body.length <= 160 ? 1 : Math.ceil(body.length / 153);
  }
  return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
}

export function estimateCostUsd(
  body: string,
  channel: "twilio" | "whatsapp",
): number {
  if (channel === "whatsapp") return MESSAGE_COSTS_USD.whatsappPerMessage;
  return smsSegments(body) * MESSAGE_COSTS_USD.twilioSmsPerSegment;
}

export type VolumeCheck = {
  count: number;
  windowHours: number;
  threshold: number;
  breached: boolean;
};

/**
 * Count SmsMessage rows created in the trailing `windowHours` and compare
 * against `threshold`. Pure query — the caller decides what breached means
 * (log warn, page, dashboard banner). Never returns message contents.
 */
export async function checkMessageVolume(
  opts: { windowHours?: number; threshold?: number } = {},
): Promise<VolumeCheck> {
  const windowHours = opts.windowHours ?? 1;
  const threshold = opts.threshold ?? DEFAULT_VOLUME_THRESHOLD_PER_HOUR;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const count = await getPrisma().smsMessage.count({
    where: { createdAt: { gte: since } },
  });
  return { count, windowHours, threshold, breached: count > threshold };
}
