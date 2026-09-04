import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { reportError } from "./reportError";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("reportError", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("never throws, even for circular errors", () => {
    const circular = { phone: "+213550" } as Record<string, unknown>;
    circular.self = circular;
    expect(() => reportError("test_event", circular)).not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("never ships patient data — only the error class name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportError("test_event", new Error("failed for Sara +213550"));
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).not.toContain("Sara");
    expect(logged).not.toContain("+213550");
    expect(logged).toContain("test_event");
    expect(logged).toContain("Error");
    const captured = vi.mocked(Sentry.captureException).mock.calls[0][0] as Error;
    expect(captured.message).not.toContain("Sara");
  });
});
