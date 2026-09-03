/**
 * Task 22 — provider credential boundary.
 *
 * Every real provider reads its credentials through here, never via
 * `process.env` inside `send()`. Validation happens at this edge (the
 * api-and-interface-design rule: validate at boundaries, trust internal
 * code), so a missing or placeholder credential fails loudly as a recorded
 * `FAILED` message instead of a silent non-delivery.
 *
 * Security rules (security-and-hardening):
 * - Error strings name the VARIABLE, never its value — a `TWILIO_AUTH_TOKEN`
 *   must never appear in a log, an error message, or the `SmsMessage.error`
 *   column.
 * - Vercel writes `[SENSITIVE]` when it cannot decrypt a secret (e.g. `vercel
 *   env pull` on a token marked Sensitive). A literal `[…]` value is a
 *   placeholder, not a credential — reject it like a missing one.
 */

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
};

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  /** Optional approved-template seam: business-initiated messages outside the
   * 24h customer-service window must use a pre-approved template (Meta
   * requirement — see docs/messaging-production.md). When set, the provider
   * sends a template message carrying the body as its single parameter. */
  templateName?: string;
  templateLang?: string;
};

export type ConfigResult<T> =
  | { ok: true; config: T }
  | { ok: false; error: string };

type Env = Record<string, string | undefined>;

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return v.length === 0 || (v.startsWith("[") && v.endsWith("]"));
}

function isE164(value: string): boolean {
  return /^\+\d{7,15}$/.test(value.trim());
}

export function getTwilioConfig(
  env: Env = process.env,
): ConfigResult<TwilioConfig> {
  const accountSid = (env["TWILIO_ACCOUNT_SID"] ?? "").trim();
  const authToken = (env["TWILIO_AUTH_TOKEN"] ?? "").trim();
  const fromNumber = (env["TWILIO_FROM_NUMBER"] ?? "").trim();

  if (
    isPlaceholder(accountSid) ||
    !accountSid.startsWith("AC") ||
    accountSid.length < 10
  ) {
    return {
      ok: false,
      error:
        "Twilio is not configured: TWILIO_ACCOUNT_SID is missing or invalid.",
    };
  }
  if (isPlaceholder(authToken) || authToken.length < 8) {
    return {
      ok: false,
      error:
        "Twilio is not configured: TWILIO_AUTH_TOKEN is missing or invalid.",
    };
  }
  if (isPlaceholder(fromNumber) || !isE164(fromNumber)) {
    return {
      ok: false,
      error:
        "Twilio is not configured: TWILIO_FROM_NUMBER must be an E.164 number (e.g. +12025550142).",
    };
  }
  return { ok: true, config: { accountSid, authToken, fromNumber } };
}

export function getWhatsAppConfig(
  env: Env = process.env,
): ConfigResult<WhatsAppConfig> {
  const accessToken = (env["WHATSAPP_ACCESS_TOKEN"] ?? "").trim();
  const phoneNumberId = (env["WHATSAPP_PHONE_NUMBER_ID"] ?? "").trim();
  const templateName = (env["WHATSAPP_TEMPLATE_NAME"] ?? "").trim();
  const templateLang = (env["WHATSAPP_TEMPLATE_LANG"] ?? "").trim() || "fr";

  if (isPlaceholder(accessToken) || accessToken.length < 8) {
    return {
      ok: false,
      error:
        "WhatsApp is not configured: WHATSAPP_ACCESS_TOKEN is missing or invalid.",
    };
  }
  if (isPlaceholder(phoneNumberId) || !/^\d{4,}$/.test(phoneNumberId)) {
    return {
      ok: false,
      error:
        "WhatsApp is not configured: WHATSAPP_PHONE_NUMBER_ID is missing or invalid.",
    };
  }
  return {
    ok: true,
    config: {
      accessToken,
      phoneNumberId,
      ...(templateName ? { templateName, templateLang } : {}),
    },
  };
}
