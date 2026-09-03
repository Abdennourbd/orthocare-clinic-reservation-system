import { describe, it, expect, vi } from "vitest";
import { SmsStatus } from "@/generated/prisma/client";
import { WhatsAppFirstProvider } from "./hybrid";
import type { MessageProvider } from "./provider";

// Task 22 (TDD RED): WhatsApp-first + SMS fallback (plan.md channel strategy).
// The hybrid reports the ACTUAL channel via `result.provider` so the
// dispatcher's SmsMessage row records what was really used.

function ok(provider: "whatsapp" | "twilio"): MessageProvider {
  return {
    name: provider,
    async send() {
      return { ok: true, status: SmsStatus.SENT };
    },
  };
}

function fail(
  provider: "whatsapp" | "twilio",
  code?: string,
): MessageProvider {
  return {
    name: provider,
    async send() {
      return { ok: false, status: SmsStatus.FAILED, error: "boom", code };
    },
  };
}

describe("WhatsAppFirstProvider", () => {
  it("uses WhatsApp when the recipient is on WhatsApp", async () => {
    const provider = new WhatsAppFirstProvider({
      whatsapp: ok("whatsapp"),
      twilio: ok("twilio"),
    });

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("whatsapp");
  });

  it("falls back to SMS when the recipient is not on WhatsApp", async () => {
    const twilio = ok("twilio");
    const twilioSpy = vi.spyOn(twilio, "send");
    const provider = new WhatsAppFirstProvider({
      whatsapp: fail("whatsapp", "NOT_ON_WHATSAPP"),
      twilio,
    });

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(twilioSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("twilio");
  });

  it("falls back to SMS when WhatsApp is not configured", async () => {
    const provider = new WhatsAppFirstProvider({
      whatsapp: fail("whatsapp", "CONFIG_MISSING"),
      twilio: ok("twilio"),
    });

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("twilio");
  });

  it("reports FAILED with both errors when WhatsApp AND SMS fail", async () => {
    const provider = new WhatsAppFirstProvider({
      whatsapp: fail("whatsapp", "NETWORK_ERROR"),
      twilio: fail("twilio", "PROVIDER_ERROR"),
    });

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.error).toBeTruthy();
  });
});
