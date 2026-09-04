import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { requireCronSecret } from "./cronAuth";

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/cron/reminders", { headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("requireCronSecret", () => {
  it("accepts Authorization: Bearer and x-cron-secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(requireCronSecret(req({ authorization: "Bearer s3cret" }))).toBeNull();
    expect(requireCronSecret(req({ "x-cron-secret": "s3cret" }))).toBeNull();
  });

  it("rejects missing, wrong, and malformed secrets (unequal lengths included)", () => {
    vi.stubEnv("CRON_SECRET", "s3cret-long-value");
    expect(requireCronSecret(req({}))!.status).toBe(401);
    expect(requireCronSecret(req({ authorization: "Bearer wrong" }))!.status).toBe(401);
    expect(requireCronSecret(req({ authorization: "Token s3cret-long-value" }))!.status).toBe(
      401,
    );
    expect(requireCronSecret(req({ "x-cron-secret": "x" }))!.status).toBe(401);
  });

  it("rejects everything when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(requireCronSecret(req({ authorization: "Bearer s3cret" }))!.status).toBe(401);
  });
});
