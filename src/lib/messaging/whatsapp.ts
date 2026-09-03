import { SmsStatus } from "@/generated/prisma/client";
import type {
  MessageProvider,
  SendMessageParams,
  SendMessageResult,
} from "./provider";
import { getWhatsAppConfig, type WhatsAppConfig } from "./config";

// Task 22 — WhatsApp Business messages via Meta's Cloud API (no BSP markup).
//
// POST https://graph.facebook.com/v21.0/{phone-number-id}/messages
// Bearer token, JSON body. Two shapes:
// - No template configured (dev / inside the 24h customer-service window or
//   sandbox): free-text `{type: "text", text: {body}}`.
// - `WHATSAPP_TEMPLATE_NAME` set (production business-initiated): a template
//   message carrying the rendered body as its single body parameter. Meta
//   requires pre-approved templates for business-initiated messages —
//   approval is a scheduling dependency, see docs/messaging-production.md.
//
// The "recipient not on WhatsApp" failure is tagged with code
// `NOT_ON_WHATSAPP` so the hybrid provider can fall back to SMS. Meta
// signals it with error codes 131026 / 131030 / 133010 (plus a message
// substring fallback, since subcodes drift).
//
// Security notes: fixed URL, 10s timeout, untrusted-response validation,
// returned (never thrown) failures without secrets or PII.

const WHATSAPP_TIMEOUT_MS = 10_000;
const GRAPH_VERSION = "v21.0";

/** Meta error codes meaning "this number is not on WhatsApp". */
const NOT_ON_WHATSAPP_CODES = new Set([131026, 131030, 133010]);

function isE164(to: string): boolean {
  return /^\+\d{7,15}$/.test(to.trim());
}

export class WhatsAppProvider implements MessageProvider {
  readonly name = "whatsapp" as const;

  constructor(
    private readonly config?: WhatsAppConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async send(params: SendMessageParams): Promise<SendMessageResult> {
    const to = params.to.trim();
    if (!isE164(to)) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: "INVALID_RECIPIENT",
        error: `WhatsApp send refused: recipient is not an E.164 number.`,
      };
    }

    const resolved = this.config
      ? { ok: true as const, config: this.config }
      : getWhatsAppConfig();
    if (!resolved.ok) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: "CONFIG_MISSING",
        error: resolved.error,
      };
    }
    const { accessToken, phoneNumberId, templateName, templateLang } =
      resolved.config;

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/` +
      `${encodeURIComponent(phoneNumberId)}/messages`;
    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLang ?? "fr" },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: params.body }],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: false, body: params.body },
        };

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WHATSAPP_TIMEOUT_MS);
      try {
        response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code:
          e instanceof Error && e.name === "AbortError"
            ? "TIMEOUT"
            : "NETWORK_ERROR",
        error: `WhatsApp send failed: ${e instanceof Error ? e.message : "network error"}`,
      };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.ok && isWhatsAppSuccess(body)) {
      return { ok: true, status: SmsStatus.SENT };
    }
    if (isNotOnWhatsApp(body)) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: "NOT_ON_WHATSAPP",
        error: `WhatsApp send failed: recipient is not on WhatsApp (${whatsappErrorDetail(response.status, body)}).`,
      };
    }
    return {
      ok: false,
      status: SmsStatus.FAILED,
      code: "PROVIDER_ERROR",
      error: `WhatsApp send failed: ${whatsappErrorDetail(response.status, body)}`,
    };
  }
}

function isWhatsAppSuccess(
  body: unknown,
): body is { messages: Array<{ id: string }> } {
  if (typeof body !== "object" || body === null) return false;
  const messages = (body as { messages?: unknown }).messages;
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    typeof (messages[0] as { id?: unknown }).id === "string" &&
    ((messages[0] as { id: string }).id.length > 0)
  );
}

function whatsappErrorObject(body: unknown): {
  code?: unknown;
  message?: unknown;
} | null {
  if (typeof body !== "object" || body === null) return null;
  const err = (body as { error?: unknown }).error;
  return typeof err === "object" && err !== null
    ? (err as { code?: unknown; message?: unknown })
    : null;
}

function isNotOnWhatsApp(body: unknown): boolean {
  const err = whatsappErrorObject(body);
  if (!err) return false;
  if (typeof err.code === "number" && NOT_ON_WHATSAPP_CODES.has(err.code)) {
    return true;
  }
  if (typeof err.message === "string") {
    return /not .*whatsapp|whatsapp.*not|non-whatsapp user/i.test(err.message);
  }
  return false;
}

function whatsappErrorDetail(status: number, body: unknown): string {
  const err = whatsappErrorObject(body);
  if (err && typeof err.message === "string") {
    const code = typeof err.code === "number" ? ` (${err.code})` : "";
    return `HTTP ${status}${code}: ${err.message}`.slice(0, 300);
  }
  return `HTTP ${status}: unexpected response from WhatsApp.`;
}
