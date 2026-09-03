import { SmsStatus } from "@/generated/prisma/client";
import type {
  MessageProvider,
  SendMessageParams,
  SendMessageResult,
} from "./provider";
import { getTwilioConfig, type TwilioConfig } from "./config";

// Task 22 — real SMS via Twilio's REST API (no SDK: one POST, fewer
// dependencies in the supply chain).
//
// POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
// Basic auth (SID:token), form-encoded {To, From, Body}.
//
// Security notes:
// - Fixed URL (no user-supplied URLs → no SSRF surface).
// - 10s timeout so a hung provider call can never hang a cron job.
// - The third-party response is UNTRUSTED: its shape is validated before use.
// - Failures are returned, never thrown, and never carry secrets or PII.

const TWILIO_TIMEOUT_MS = 10_000;

function isE164(to: string): boolean {
  return /^\+\d{7,15}$/.test(to.trim());
}

export class TwilioProvider implements MessageProvider {
  readonly name = "twilio" as const;

  constructor(
    private readonly config?: TwilioConfig,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async send(params: SendMessageParams): Promise<SendMessageResult> {
    const to = params.to.trim();
    if (!isE164(to)) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: "INVALID_RECIPIENT",
        error: `Twilio send refused: recipient is not an E.164 number.`,
      };
    }

    const resolved = this.config ? { ok: true as const, config: this.config } : getTwilioConfig();
    if (!resolved.ok) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: "CONFIG_MISSING",
        error: resolved.error,
      };
    }
    const { accountSid, authToken, fromNumber } = resolved.config;

    const url =
      `https://api.twilio.com/2010-04-01/Accounts/` +
      `${encodeURIComponent(accountSid)}/Messages.json`;
    const credentials = Buffer.from(
      `${accountSid}:${authToken}`,
      "utf8",
    ).toString("base64");
    const form = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: params.body,
    });

    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
      try {
        response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return {
        ok: false,
        status: SmsStatus.FAILED,
        code: e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        error: `Twilio send failed: ${e instanceof Error ? e.message : "network error"}`,
      };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok && isTwilioSuccess(payload)) {
      return { ok: true, status: SmsStatus.SENT };
    }
    return {
      ok: false,
      status: SmsStatus.FAILED,
      code: "PROVIDER_ERROR",
      error: `Twilio send failed: ${twilioErrorDetail(response.status, payload)}`,
    };
  }
}

function isTwilioSuccess(payload: unknown): payload is { sid: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { sid?: unknown }).sid === "string" &&
    (payload as { sid: string }).sid.length > 0
  );
}

function twilioErrorDetail(status: number, payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    const p = payload as { code?: unknown; message: string };
    const code = typeof p.code === "number" ? ` (${p.code})` : "";
    return `HTTP ${status}${code}: ${p.message}`.slice(0, 300);
  }
  return `HTTP ${status}: unexpected response from Twilio.`;
}
