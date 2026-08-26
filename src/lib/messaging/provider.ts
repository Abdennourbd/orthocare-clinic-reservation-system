import type { SmsStatus } from "@/generated/prisma/client";

// MessageProvider contract (plan.md §Messaging). Providers are thin, pure
// adapters over a single channel: they deliver a rendered body to an E.164
// number and report the outcome. They hold NO policy (opt-out, idempotency,
// template rendering) — that lives in the dispatcher (`lib/messaging/index.ts`)
// so the transactional/non-transactional split is enforced in one place and no
// feature can bypass it. Real channel wiring is Task 22; mock is the default.

export type MessageProviderName = "mock" | "twilio" | "whatsapp";

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
  /** Human-readable failure reason (only when `ok` is false). */
  error?: string;
};

export interface MessageProvider {
  readonly name: MessageProviderName;
  send(params: SendMessageParams): Promise<SendMessageResult>;
}