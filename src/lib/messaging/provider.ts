import type { SmsStatus } from "@/generated/prisma/client";

// MessageProvider contract (plan.md §Messaging). Providers are thin, pure
// adapters over a single channel: they deliver a rendered body to an E.164
// number and report the outcome. They hold NO policy (opt-out, idempotency,
// template rendering) — that lives in the dispatcher (`lib/messaging/index.ts`)
// so the transactional/non-transactional split is enforced in one place and no
// feature can bypass it. Real channel wiring is Task 22; mock is the default.

export type MessageProviderName =
  | "mock"
  | "twilio"
  | "whatsapp"
  | "whatsapp-first";

export type SendMessageParams = {
  /** E.164 recipient, e.g. "+213550123456". */
  to: string;
  /** Rendered message body. */
  body: string;
};

export type SendMessageResult = {
  ok: boolean;
  /** `SENT` when delivered, `FAILED` otherwise. */
  status: SmsStatus;
  /** Human-readable failure reason (only when `ok` is false). Never carries
   * secrets or patient PII — it is persisted on the SmsMessage row. */
  error?: string;
  /** Machine-readable failure code for programmatic branching (e.g. the
   * hybrid provider falling back on `NOT_ON_WHATSAPP`). Optional and
   * additive — existing providers omit it. */
  code?: string;
  /** Actual channel used for this send. Set by delegating providers (the
   * `whatsapp-first` hybrid) so the dispatcher records the real channel on
   * the SmsMessage row. Direct providers omit it (the dispatcher uses
   * `provider.name`). */
  provider?: MessageProviderName;
};

export interface MessageProvider {
  readonly name: MessageProviderName;
  send(params: SendMessageParams): Promise<SendMessageResult>;
}