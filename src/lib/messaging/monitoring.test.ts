import { describe, it, expect } from "vitest";
import {
  smsSegments,
  estimateCostUsd,
  DEFAULT_VOLUME_THRESHOLD_PER_HOUR,
} from "./monitoring";

// Task 22 (TDD RED): cost awareness + volume guard (observability skill).
// Costs are documented estimates for DZ numbers (plan.md §Messaging); the
// volume guard is the in-code tripwire — the external alert is documented in
// docs/messaging-production.md.

describe("smsSegments", () => {
  it("counts a short ASCII message as one segment", () => {
    expect(smsSegments("Bonjour, rappel.")).toBe(1);
  });

  it("splits long ASCII messages at 153 chars per concatenated segment", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
  });

  it("counts non-ASCII (Arabic) messages at 70/67 chars per segment", () => {
    expect(smsSegments("مرحبا")).toBe(1);
    expect(smsSegments("م".repeat(70))).toBe(1);
    expect(smsSegments("م".repeat(71))).toBe(2);
  });
});

describe("estimateCostUsd", () => {
  it("prices WhatsApp far below Twilio SMS for a DZ number", () => {
    const body = "Bonjour, rappel de rendez-vous.";
    expect(estimateCostUsd(body, "twilio")).toBeGreaterThan(
      estimateCostUsd(body, "whatsapp"),
    );
  });

  it("scales SMS cost with the segment count", () => {
    expect(estimateCostUsd("a".repeat(161), "twilio")).toBeGreaterThan(
      estimateCostUsd("a".repeat(10), "twilio"),
    );
  });
});

describe("volume threshold", () => {
  it("documents a sane default hourly tripwire", () => {
    // ~600–800 msgs/month ≈ 30/day — 200/hour is a generous spike guard.
    expect(DEFAULT_VOLUME_THRESHOLD_PER_HOUR).toBe(200);
  });
});
