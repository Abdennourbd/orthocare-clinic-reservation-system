import { describe, it, expect, vi, afterEach } from "vitest";
import { SmsStatus } from "@/generated/prisma/client";
import { WhatsAppProvider } from "./whatsapp";

// Task 22 (TDD RED): real Meta Cloud API wiring, tested against a stubbed
// fetch — no network, no token leaves the test process.

const VALID_CONFIG = {
  accessToken: "EAAB-test-token-value-long-enough",
  phoneNumberId: "123456789012345",
};

function okFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("WhatsAppProvider (real)", () => {
  it("POSTs a text message and reports SENT on a messages[0].id response", async () => {
    const fetchFn = okFetch({ messages: [{ id: "wamid.123" }] });
    const provider = new WhatsAppProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour, rappel de rendez-vous.",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(SmsStatus.SENT);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("graph.facebook.com");
    expect(url).toContain("123456789012345");
    expect(url).not.toContain("EAAB");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer EAAB-test-token-value-long-enough",
    );
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload["messaging_product"]).toBe("whatsapp");
    expect(payload["to"]).toBe("+213550123456");
  });

  it("sends a template message when a template name is configured", async () => {
    const fetchFn = okFetch({ messages: [{ id: "wamid.456" }] });
    const provider = new WhatsAppProvider(
      { ...VALID_CONFIG, templateName: "appointment_update", templateLang: "fr" },
      fetchFn,
    );

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour, rappel.",
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(payload["type"]).toBe("template");
    expect(JSON.stringify(payload)).toContain("appointment_update");
  });

  it("fails loudly when credentials are missing (never silently succeeds)", async () => {
    const fetchFn = vi.fn();
    const provider = new WhatsAppProvider(undefined, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.error).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("tags the not-on-WhatsApp error so the hybrid provider can fall back to SMS", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 131030,
            message: "Recipient is not on WhatsApp",
            error_subcode: 2388010,
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new WhatsAppProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.code).toBe("NOT_ON_WHATSAPP");
  });

  it("records FAILED (no throw) when the network fails", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const provider = new WhatsAppProvider(VALID_CONFIG, fetchFn);

    const result = await provider.send({
      to: "+213550123456",
      body: "Bonjour.",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(SmsStatus.FAILED);
  });
});
