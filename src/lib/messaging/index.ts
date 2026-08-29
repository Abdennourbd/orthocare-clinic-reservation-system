import { getPrisma } from "@/lib/db";
import {
  SmsStatus,
  type SmsMessage,
  type SmsMessageType,
} from "@/generated/prisma/client";
import { MockProvider } from "./mock";
import { TwilioProvider } from "./twilio";
import { WhatsAppProvider } from "./whatsapp";
import type { MessageProvider, SendMessageResult } from "./provider";
import { isTransactional } from "./classify";
import {
  readMessageTemplate,
  renderTemplate,
  type MessageTemplateKey,
} from "./templates";

// Dispatcher + provider factory (plan.md §Messaging). The provider is selected
// once per process by MESSAGE_PROVIDER; `sendMessage` is the single gate
// through which every outbound message flows. It enforces the opt-out split
// here so no feature can bypass it, and it owns the SmsMessage row lifecycle
// (the "log to DB" for the mock provider, the audit record for real channels).

const mockProvider = new MockProvider();
const twilioProvider = new TwilioProvider();
const whatsappProvider = new WhatsAppProvider();

/** Select the active provider from `MESSAGE_PROVIDER`. Unknown values fall
 * back to mock (a typo in an env var must never take down a booking). */
export function getProvider(): MessageProvider {
  const env = (process.env.MESSAGE_PROVIDER ?? "mock").trim().toLowerCase();
  switch (env) {
    case "twilio":
      return twilioProvider;
    case "whatsapp":
      return whatsappProvider;
    case "mock":
      return mockProvider;
    default:
      console.warn(
        `Unknown MESSAGE_PROVIDER "${env}" — falling back to mock.`,
      );
      return mockProvider;
  }
}

export type SendMessageInput = {
  type: SmsMessageType;
  /** Owning patient. Used for the opt-out check on non-transactional types. */
  patientId: string;
  /** E.164 recipient. */
  to: string;
  /** Template key into `messageTemplates` Settings. */
  templateKey: MessageTemplateKey;
  /** Placeholders substituted into the template. */
  vars: Record<string, string>;
  appointmentId?: string;
  batchId?: string;
  sentById?: string;
};

/**
 * Send one outbound message through the active provider and record it in
 * `SmsMessage`.
 *
 * - **Opt-out:** non-transactional types are suppressed (returns null, no row)
 *   for patients with `messagingOptOut`. Transactional types always send.
 * - **Idempotent:** the unique `(appointmentId, type)` index means a retried
 *   or overlapping send of an automated message returns the existing row and
 *   does not message the patient twice.
 * - A provider failure — whether it *returns* a failed result or *throws* — is
 *   recorded on the row (status FAILED + error) and the row is still returned,
 *   so a messaging failure never fails the caller's operation.
 *
 * @param provider overrides the env-selected provider (used by tests).
 */
export async function sendMessage(
  input: SendMessageInput,
  provider: MessageProvider = getProvider(),
): Promise<SmsMessage | null> {
  const prisma = getPrisma();

  // 1. Opt-out gate (non-transactional only). Task 13 étape 5 (§Contraintes
  // point 6): a soft-deleted record (`active: false`) must stop receiving
  // NON-transactional messages too, same as an explicit opt-out — before
  // this, deactivating a patient (the dashboard's only "delete") left them
  // still reachable by every marketing/reminder-class send. Transactional
  // messages (e.g. a booking confirmation the patient is actively waiting
  // on) still always send, same as an opt-out.
  if (!isTransactional(input.type)) {
    const patient = await prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { messagingOptOut: true, active: true },
    });
    if (patient?.messagingOptOut || patient?.active === false) return null;
  }

  // 2. Render the body from the (admin-editable) template.
  const body = renderTemplate(
    await readMessageTemplate(input.templateKey),
    input.vars,
  );

  // 3. Record the send. A unique-violation here means this appointment+type
  // was already messaged. If the previous attempt FAILED the patient never
  // received it, so RETRY the send (at-least-once); if it was already SENT,
  // return the existing row (exactly-once) — a retried cron/route can never
  // message the same patient twice.
  let message: SmsMessage;
  try {
    message = await prisma.smsMessage.create({
      data: {
        to: input.to,
        body,
        patientId: input.patientId,
        type: input.type,
        templateId: input.templateKey,
        batchId: input.batchId,
        provider: provider.name,
        status: SmsStatus.SENDING,
        appointmentId: input.appointmentId,
        sentById: input.sentById,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const existing = await prisma.smsMessage.findFirst({
        where: {
          appointmentId: input.appointmentId,
          type: input.type,
        },
        orderBy: { createdAt: "asc" },
      });
      if (existing && existing.status === SmsStatus.FAILED) {
        // The patient never got the message — deliver it now. Re-check the
        // opt-out gate first: the patient may have opted out since the failed
        // attempt, and a non-transactional message must never be delivered
        // after opt-out (the dispatcher owns the opt-out split, including on
        // the retry path).
        if (!isTransactional(input.type)) {
          const patient = await prisma.patient.findUnique({
            where: { id: input.patientId },
            select: { messagingOptOut: true, active: true },
          });
          if (patient?.messagingOptOut || patient?.active === false) return null;
        }
        const retryResult = await deliver(provider, existing.to, existing.body);
        return prisma.smsMessage.update({
          where: { id: existing.id },
          data: {
            provider: provider.name,
            status: retryResult.status,
            error: retryResult.error ?? null,
            sentAt: retryResult.ok ? new Date() : null,
          },
        });
      }
      return existing;
    }
    throw e;
  }

  // 4. Deliver, then persist the outcome. A provider that throws is recorded
  // as FAILED (not left SENDING) so a transient network error never leaves a
  // dangling row and never fails the caller's operation.
  const result = await deliver(provider, message.to, message.body);
  return prisma.smsMessage.update({
    where: { id: message.id },
    data: {
      status: result.status,
      error: result.error ?? null,
      sentAt: result.ok ? new Date() : null,
    },
  });
}

/** Call the provider, converting a throw into a recorded FAILED result. */
async function deliver(
  provider: MessageProvider,
  to: string,
  body: string,
): Promise<SendMessageResult> {
  try {
    return await provider.send({ to, body });
  } catch (e) {
    return {
      ok: false,
      status: SmsStatus.FAILED,
      error: e instanceof Error ? e.message : "Message provider error",
    };
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}