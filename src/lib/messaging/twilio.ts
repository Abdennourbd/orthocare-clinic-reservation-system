import { SmsStatus } from "@/generated/prisma/client";
import type { MessageProvider, SendMessageResult } from "./provider";

/**
 * Real SMS via Twilio — a stub until Task 22 wires the SDK and credentials.
 * Env-gated: only instantiated when `MESSAGE_PROVIDER=twilio`. The stub fails
 * loudly rather than silently "succeeding", so an un-wired production channel
 * can never be mistaken for a delivered message.
 */
export class TwilioProvider implements MessageProvider {
  readonly name = "twilio" as const;

  async send(): Promise<SendMessageResult> {
    return {
      ok: false,
      status: SmsStatus.FAILED,
      error: "TwilioProvider is a stub — real SMS wiring lands in Task 22.",
    };
  }
}