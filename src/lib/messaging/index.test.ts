import { describe, it, expect, vi, afterEach } from "vitest";
import { SmsMessageType } from "@/generated/prisma/client";
import { isTransactional, NON_TRANSACTIONAL_TYPES } from "./classify";
import { getProvider } from "./index";

describe("isTransactional", () => {
  it("classifies the plan's non-transactional types", () => {
    expect(NON_TRANSACTIONAL_TYPES).toEqual(
      new Set([SmsMessageType.NO_SHOW, SmsMessageType.DELAY, SmsMessageType.WAITLIST]),
    );
    for (const t of NON_TRANSACTIONAL_TYPES) {
      expect(isTransactional(t)).toBe(false);
    }
  });

  it("bookings/confirmations are transactional and always send", () => {
    expect(isTransactional(SmsMessageType.BOOKING_RECEIVED)).toBe(true);
    expect(isTransactional(SmsMessageType.CONFIRMATION)).toBe(true);
    expect(isTransactional(SmsMessageType.RESCHEDULE)).toBe(true);
    expect(isTransactional(SmsMessageType.CANCELLED)).toBe(true);
    expect(isTransactional(SmsMessageType.REMINDER)).toBe(true);
  });
});

describe("getProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to mock when MESSAGE_PROVIDER is unset", () => {
    vi.stubEnv("MESSAGE_PROVIDER", "");
    expect(getProvider().name).toBe("mock");
  });

  it("selects twilio and whatsapp by env", () => {
    vi.stubEnv("MESSAGE_PROVIDER", "twilio");
    expect(getProvider().name).toBe("twilio");
    vi.stubEnv("MESSAGE_PROVIDER", "whatsapp");
    expect(getProvider().name).toBe("whatsapp");
  });

  it("selects the whatsapp-first hybrid by env (production channel strategy)", () => {
    vi.stubEnv("MESSAGE_PROVIDER", "whatsapp-first");
    expect(getProvider().name).toBe("whatsapp-first");
  });

  it("falls back to mock for an unknown value (never breaks a booking)", () => {
    vi.stubEnv("MESSAGE_PROVIDER", "pigeon");
    expect(getProvider().name).toBe("mock");
  });

  it("treats the value case-insensitively", () => {
    vi.stubEnv("MESSAGE_PROVIDER", "Mock");
    expect(getProvider().name).toBe("mock");
  });
});