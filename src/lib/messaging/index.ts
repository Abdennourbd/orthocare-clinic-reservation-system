import { getPrisma } from "@/lib/db";
import {
  SmsStatus,
  type SmsMessage,
  type SmsMessageType,
} from "@/generated/prisma/client";
import { MockProvider } from "./mock";
import { TwilioProvider } from "./twilio";
import { WhatsAppProvider } from "./whatsapp";
import { WhatsAppFirstProvider } from "./hybrid";
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
const whatsappFirstProvider = new WhatsAppFirstProvider();

/** Select the active provider from `MESSAGE_PROVIDER`. Unknown values fall
 * back to mock (a typo in an env var must never take down a booking).
 * `whatsapp-first` is the production channel strategy (plan.md §Messaging):
 * try WhatsApp, fall back to Twilio SMS. */
export function getProvider(): MessageProvider {
  const env = (process.env.MESSAGE_PROVIDER ?? "mock").trim().toLowerCase();
  switch (env) {
    case "twilio":
      return twilioProvider;
    case "whatsapp":
      return whatsappProvider;
    case "whatsapp-first":
    case "whatsapp_first":
    case "hybrid":
      return whatsappFirstProvider;
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
  appointmentId?: string;
  batchId?: string;
  sentById?: string;
} & (
  | {
      /** Free-text body (Task 16 manual sends) used verbatim instead of a
       * template. The route's Zod schema enforces non-empty / max 480 chars;
       * the dispatcher re-checks defensively because it is a public function. */
      bodyOverride: string;
      /** Exclusive with `bodyOverride` — the template layer is never touched. */
      templateKey?: never;
      vars?: never;
    }
  | {
      bodyOverride?: never;
      /** Template key into `messageTemplates` Settings. */
      templateKey: MessageTemplateKey;
      /** Placeholders substituted into the template. */
      vars: Record<string, string>;
    }
);

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
 * Free-text manual sends (Task 16) flow through the same gate so
 * opt-out/idempotency/row-lifecycle cannot be bypassed.
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
  //
  // WhatsApp documented-opt-in (Meta requirement, plan.md §Messaging): when
  // the active provider can send WhatsApp, a patient WITHOUT `whatsappOptIn`
  // must never be messaged on WhatsApp — the send falls back to SMS instead
  // (SMS has its own opt-out above). The patient row is fetched once and
  // shared by both gates.
  const whatsappCapable = provider.name === "whatsapp" || provider.name === "whatsapp-first";
  let patient: { messagingOptOut: boolean; active: boolean; whatsappOptIn: boolean } | null = null;
  if (!isTransactional(input.type) || whatsappCapable) {
    patient = await prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { messagingOptOut: true, active: true, whatsappOptIn: true },
    });
  }
  if (!isTransactional(input.type)) {
    if (patient?.messagingOptOut || patient?.active === false) return null;
  }
  // Missing row or explicit false → SMS. Opt-in is explicit-true only: a
  // missing patient record must never produce a WhatsApp send.
  const effectiveProvider: MessageProvider =
    whatsappCapable && patient?.whatsappOptIn !== true ? twilioProvider : provider;

  // 2. Resolve the body: a free-text override (Task 16 manual sends) is used
  // verbatim — validated defensively even though the route's Zod schema
  // enforces the same bounds, because the dispatcher is a public function —
  // and persists templateId null; otherwise the (admin-editable) template is
  // rendered. The union on SendMessageInput makes mixing the two a compile
  // error, and the narrowing here keeps the branches honest.
  let body: string;
  let templateId: string | null;
  if (input.bodyOverride !== undefined) {
    const trimmed = input.bodyOverride.trim();
    if (trimmed.length === 0 || trimmed.length > 480) {
      throw new Error("bodyOverride invalide");
    }
    body = trimmed;
    templateId = null;
  } else {
    body = renderTemplate(
      await readMessageTemplate(input.templateKey),
      input.vars,
    );
    templateId = input.templateKey;
  }

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
        templateId,
        batchId: input.batchId,
        provider: effectiveProvider.name,
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
        const retryResult = await deliver(effectiveProvider, existing.to, existing.body);
        return prisma.smsMessage.update({
          where: { id: existing.id },
          data: {
            provider: retryResult.provider ?? effectiveProvider.name,
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
  // dangling row and never fails the caller's operation. When a delegating
  // provider (the whatsapp-first hybrid) reports the actual channel via
  // `result.provider`, the row records reality so WhatsApp coverage stays
  // measurable (plan.md §Messaging).
  const result = await deliver(effectiveProvider, message.to, message.body);
  if (!result.ok) {
    // Structured failure event (observability): stable name + bounded fields.
    // NEVER the recipient or body — telemetry must not carry patient PII.
    console.warn(
      JSON.stringify({
        event: "message_send_failed",
        provider: result.provider ?? effectiveProvider.name,
        code: result.code ?? "UNKNOWN",
        type: input.type,
      }),
    );
  }
  return prisma.smsMessage.update({
    where: { id: message.id },
    data: {
      provider: result.provider ?? effectiveProvider.name,
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