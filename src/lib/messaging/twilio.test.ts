import { describe, it, expect, vi, afterEach } from "vitest";
import { SmsStatus } from "@/generated/prisma/client";
import { TwilioProvider } from "./twilio";

// Task 22 (TDD RED): real Twilio REST wiring, tested against a stubbed
// fetch — no network, no credentials leave the test process.

const VALID_CONFIG = {
  accountSid: "AC1234567890abcdef1234567890abcdef",
  authToken: "s3cr3t-auth-token-value",
  fromNumber: "+12025550142",
};

function okFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("TwilioProvider (real)", () => {
  it("POSTs a form-encoded message and reports SENT on a sid response", async () => {
    const fetchFn = okFetch({ sid: "SM123", status: "queued" });
    const provider = new TwilioProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour, rappel de rendez-vous.",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(SmsStatus.SENT);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("api.twilio.com/2010-04-01/Accounts/AC123");
    expect(url).not.toContain("s3cr3t");
    expect((init.headers as Record<string, string>)["Authorization"]).toMatch(
      /^Basic /,
    );
    const params = new URLSearchParams(init.body as string);
    expect(params.get("To")).toBe("+213550123456");
    expect(params.get("From")).toBe("+12025550142");
    expect(params.get("Body")).toBe("Bonjour, rappel de rendez-vous.");
  });

  it("fails loudly when credentials are missing (never silently succeeds)", async () => {
    const fetchFn = vi.fn();
    const provider = new TwilioProvider(undefined, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.error).toContain("TWILIO_ACCOUNT_SID");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a non-E.164 recipient without calling the API", async () => {
    const fetchFn = vi.fn();
    const provider = new TwilioProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({ to: "0550123456", body: "Bonjour." });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("records FAILED with the provider message on a Twilio error response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 21211, message: "The 'To' number is invalid." }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new TwilioProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.error).toContain("21211");
    expect(result.error).not.toContain("s3cr3t");
  });

  it("records FAILED (no throw) when the network fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const provider = new TwilioProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.error).toBeTruthy();
  });
});
