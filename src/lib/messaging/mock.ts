import { SmsStatus } from "@/generated/prisma/client";
import type { MessageProvider, SendMessageResult } from "./provider";

/**
 * Development/staging provider. Delivers nothing — the `SmsMessage` row the
 * dispatcher writes IS the mock's "log to DB" (plan.md: MockProvider logs to
 * DB). It reports success so the dispatcher records the message as SENT.
 */
export class MockProvider implements MessageProvider {
  readonly name = "mock" as const;

  async send(): Promise<SendMessageResult> {
    return { ok: true, status: SmsStatus.SENT };
  }
}