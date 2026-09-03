import { describe, it, expect } from "vitest";
import { getTwilioConfig, getWhatsAppConfig } from "./config";

// Task 22 (TDD RED): env-boundary validation for the real providers.
// Providers never read process.env inside send() — they take the validated
// config from here, so missing/placeholder credentials fail loudly as a
// recorded FAILED message instead of a silent non-delivery.

describe("getTwilioConfig", () => {
  it("accepts a complete, valid Twilio config", () => {
    const result = getTwilioConfig({
      TWILIO_ACCOUNT_SID: "AC1234567890abcdef1234567890abcdef",
      TWILIO_AUTH_TOKEN: "s3cr3t-auth-token-value",
      TWILIO_FROM_NUMBER: "+12025550142",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.accountSid).toBe(
        "AC1234567890abcdef1234567890abcdef",
      );
      expect(result.config.fromNumber).toBe("+12025550142");
    }
  });

  it("rejects missing credentials without echoing any secret value", () => {
    const result = getTwilioConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("TWILIO_ACCOUNT_SID");
      expect(result.error).not.toContain("s3cr3t");
    }
  });

  it("rejects Vercel [SENSITIVE] placeholders and malformed values", () => {
    for (const bad of [
      {
        TWILIO_ACCOUNT_SID: "[SENSITIVE]",
        TWILIO_AUTH_TOKEN: "[SENSITIVE]",
        TWILIO_FROM_NUMBER: "[SENSITIVE]",
      },
      {
        TWILIO_ACCOUNT_SID: "not-a-sid",
        TWILIO_AUTH_TOKEN: "short",
        TWILIO_FROM_NUMBER: "0550123456",
      },
    ]) {
      const result = getTwilioConfig(bad);
      expect(result.ok).toBe(false);
    }
  });
});

describe("getWhatsAppConfig", () => {
  it("accepts a complete, valid WhatsApp config", () => {
    const result = getWhatsAppConfig({
      WHATSAPP_ACCESS_TOKEN: "EAAB-test-token-value-long-enough",
      WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.phoneNumberId).toBe("123456789012345");
    }
  });

  it("rejects missing credentials without echoing the token", () => {
    const result = getWhatsAppConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("WHATSAPP_ACCESS_TOKEN");
      expect(result.error).not.toContain("EAAB");
    }
  });

  it("rejects [SENSITIVE] placeholders", () => {
    const result = getWhatsAppConfig({
      WHATSAPP_ACCESS_TOKEN: "[SENSITIVE]",
      WHATSAPP_PHONE_NUMBER_ID: "[SENSITIVE]",
    });
    expect(result.ok).toBe(false);
  });

  it("passes through the optional template name/lang seam", () => {
    const result = getWhatsAppConfig({
      WHATSAPP_ACCESS_TOKEN: "EAAB-test-token-value-long-enough",
      WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
      WHATSAPP_TEMPLATE_NAME: "appointment_update",
      WHATSAPP_TEMPLATE_LANG: "fr",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.templateName).toBe("appointment_update");
      expect(result.config.templateLang).toBe("fr");
    }
  });
});
