import { SmsStatus } from "@/generated/prisma/client";
import type { MessageProvider, SendMessageResult } from "./provider";

/**
 * WhatsApp Business messages via Meta's Cloud API — a stub until Task 22.
 * Env-gated: only instantiated when `MESSAGE_PROVIDER=whatsapp`. WhatsApp
 * business-initiated messages require documented patient opt-in
 * (`Patient.whatsappOptIn`) and pre-approved templates; both are recorded in
 * the plan as Task 22 dependencies, not code details.
 */
export class WhatsAppProvider implements MessageProvider {
  readonly name = "whatsapp" as const;

  async send(): Promise<SendMessageResult> {
    return {
      ok: false,
      status: SmsStatus.FAILED,
      error: "WhatsAppProvider is a stub — real WhatsApp wiring lands in Task 22.",
    };
  }
}