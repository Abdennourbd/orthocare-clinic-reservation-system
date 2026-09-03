import { SmsStatus } from "@/generated/prisma/client";
import type {
  MessageProvider,
  MessageProviderName,
  SendMessageParams,
  SendMessageResult,
} from "./provider";
import { TwilioProvider } from "./twilio";
import { WhatsAppProvider } from "./whatsapp";

// Task 22 — WhatsApp-first + SMS fallback (plan.md §Messaging channel
// strategy: ~90% of Algerian numbers are on WhatsApp; WhatsApp is ~6–7×
// cheaper than Twilio SMS to DZ).
//
// Try WhatsApp; on ANY WhatsApp failure fall back to Twilio SMS (a failed
// WhatsApp send means "not delivered", so the SMS is the delivery, not a
// duplicate). The result carries `provider` = the channel actually used, so
// the dispatcher's SmsMessage row records reality and WhatsApp coverage
// stays measurable. When both fail, the SMS result is returned with both
// errors combined.

type SendFn = (params: SendMessageParams) => Promise<SendMessageResult>;

export class WhatsAppFirstProvider implements MessageProvider {
  readonly name: MessageProviderName = "whatsapp-first";

  private readonly whatsappSend: SendFn;
  private readonly twilioSend: SendFn;

  constructor(deps?: {
    whatsapp?: Pick<MessageProvider, "send">;
    twilio?: Pick<MessageProvider, "send">;
  }) {
    const whatsapp = deps?.whatsapp ?? new WhatsAppProvider();
    const twilio = deps?.twilio ?? new TwilioProvider();
    this.whatsappSend = whatsapp.send.bind(whatsapp);
    this.twilioSend = twilio.send.bind(twilio);
  }

  async send(params: SendMessageParams): Promise<SendMessageResult> {
    const wa = await this.whatsappSend(params);
    if (wa.ok) {
      return { ...wa, provider: "whatsapp" as const };
    }

    const sms = await this.twilioSend(params);
    if (sms.ok) {
      return { ...sms, provider: "twilio" as const };
    }
    return {
      ok: false,
      status: SmsStatus.FAILED,
      code: sms.code ?? "PROVIDER_ERROR",
      error: combineErrors(wa.error, sms.error),
    };
  }
}

function combineErrors(
  whatsappError: string | undefined,
  smsError: string | undefined,
): string {
  const wa = whatsappError ?? "unknown WhatsApp error";
  const sms = smsError ?? "unknown SMS error";
  return `WhatsApp failed (${wa}); SMS fallback failed (${sms})`.slice(0, 500);
}
