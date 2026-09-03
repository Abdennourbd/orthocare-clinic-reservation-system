import { describe, expect, it } from "vitest";
import { scrubEvent } from "./sentryScrub";

describe("sentryScrub", () => {
  it("strips request bodies and redacts all sensitive headers (any case)", () => {
    const out = scrubEvent({
      request: {
        url: "https://site/fr/book",
        data: { firstName: "Sara" },
        body: "secret",
        headers: {
          cookie: "session=abc",
          authorization: "Bearer x",
          "X-Cron-Secret": "s3cret",
          "content-type": "application/json",
        },
      },
    });
    const req = out.request as Record<string, unknown>;
    expect("data" in req).toBe(false);
    expect("body" in req).toBe(false);
    const headers = req.headers as Record<string, unknown>;
    expect(headers.cookie).toBe("[REDACTED]");
    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers["X-Cron-Secret"]).toBe("[REDACTED]");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("masks self-service tokens in page AND api urls, transactions and breadcrumbs", () => {
    const token = "abcDEF123";
    const out = scrubEvent({
      transaction: `/ar/appointment/${token}`,
      request: { url: `https://site/api/appointments/${token}?locale=fr` },
      breadcrumbs: [
        { message: `went to /fr/appointment/${token}` },
        { data: { url: `/api/appointments/${token}?locale=fr` } },
      ],
    });
    expect(out.transaction).toBe("/ar/appointment/[REDACTED]");
    expect((out.request as Record<string, unknown>).url).toContain("/api/appointments/[REDACTED]");
    expect(JSON.stringify(out.breadcrumbs)).not.toContain(token);
  });

  it("masks tokens inside exception values and spans", () => {
    const token = "tokXYZ789";
    const out = scrubEvent({
      exception: { values: [{ value: `fetch /api/appointments/${token} failed` }] },
      spans: [{ description: `GET /api/appointments/${token}` }],
    });
    expect(JSON.stringify(out.exception)).not.toContain(token);
    expect(JSON.stringify(out.spans)).not.toContain(token);
  });

  it("redacts patient keys in extra/contexts/user incl. nested structures", () => {
    const out = scrubEvent({
      extra: { firstName: "Sara", phone: "+213550", ok: true, nested: { notes: "x" } },
      contexts: { profile: { phone: "+213", token: "abc" } },
      user: { email: "s@example.com", id: "u1" },
      breadcrumbs: [{ message: "hi", data: { lastName: "Benali" } }],
      message: "oops",
    });
    expect((out.extra as Record<string, unknown>).firstName).toBe("[REDACTED]");
    expect((out.extra as Record<string, unknown>).ok).toBe(true);
    expect(
      ((out.contexts as Record<string, unknown>).profile as Record<string, unknown>).phone
    ).toBe("[REDACTED]");
    expect((out.user as Record<string, unknown>).email).toBe("[REDACTED]");
  });

  it("leaves non-appointment urls untouched", () => {
    const out = scrubEvent({ transaction: "/fr/services", request: { url: "https://site/fr/book" } });
    expect(out.transaction).toBe("/fr/services");
  });

  it("never throws on circular structures", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => scrubEvent(circular)).not.toThrow();
  });

  it("does not mutate the input", () => {
    const input = { request: { url: "/fr/appointment/abc", data: { x: 1 } } };
    scrubEvent(input);
    expect((input.request as Record<string, unknown>).data).toEqual({ x: 1 });
  });
});
