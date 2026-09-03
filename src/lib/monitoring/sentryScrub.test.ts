import { describe, expect, it } from "vitest";
import { scrubEvent } from "./sentryScrub";

describe("sentryScrub", () => {
  it("strips request bodies and auth headers", () => {
    const out = scrubEvent({
      request: {
        url: "https://site/fr/book",
        data: { firstName: "Sara" },
        body: "secret",
        headers: { cookie: "session=abc", authorization: "Bearer x" },
      },
    });
    const req = out.request as Record<string, unknown>;
    expect("data" in req).toBe(false);
    expect("body" in req).toBe(false);
    expect((req.headers as Record<string, unknown>).cookie).toBe("[REDACTED]");
  });

  it("masks self-service tokens in urls, transactions and breadcrumbs", () => {
    const token = "abcDEF123";
    const out = scrubEvent({
      transaction: `/ar/appointment/${token}`,
      request: { url: `https://site/fr/appointment/${token}?x=1` },
      breadcrumbs: [{ message: `went to /fr/appointment/${token}` }],
    });
    expect(out.transaction).toBe("/ar/appointment/[REDACTED]");
    expect((out.request as Record<string, unknown>).url).toContain("/appointment/[REDACTED]");
    expect(JSON.stringify(out.breadcrumbs)).not.toContain(token);
  });

  it("redacts patient keys in extra/contexts/user but keeps shape", () => {
    const out = scrubEvent({
      extra: { firstName: "Sara", phone: "+213550", ok: true },
      user: { email: "s@example.com", id: "u1" },
    });
    expect((out.extra as Record<string, unknown>).firstName).toBe("[REDACTED]");
    expect((out.extra as Record<string, unknown>).ok).toBe(true);
    expect((out.user as Record<string, unknown>).email).toBe("[REDACTED]");
  });

  it("does not mutate the input", () => {
    const input = { request: { url: "/fr/appointment/abc", data: { x: 1 } } };
    scrubEvent(input);
    expect((input.request as Record<string, unknown>).data).toEqual({ x: 1 });
  });
});
