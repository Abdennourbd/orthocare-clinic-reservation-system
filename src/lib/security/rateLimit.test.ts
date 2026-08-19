import { describe, it, expect, vi } from "vitest";
import { checkRateLimit, RateLimitError } from "./rateLimit";

describe("checkRateLimit", () => {
  it("allows requests up to the limit", async () => {
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i++) {
      await expect(
        checkRateLimit("ip:203.0.113.1:appointments", opts),
      ).resolves.toBeUndefined();
    }
  });

  it("throws RateLimitError once the limit is exceeded", async () => {
    const opts = { limit: 2, windowMs: 60_000 };
    await checkRateLimit("ip:203.0.113.2:appointments", opts);
    await checkRateLimit("ip:203.0.113.2:appointments", opts);
    await expect(
      checkRateLimit("ip:203.0.113.2:appointments", opts),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("treats distinct keys independently", async () => {
    const opts = { limit: 1, windowMs: 60_000 };
    await checkRateLimit("ip:203.0.113.3:appointments", opts);
    await expect(
      checkRateLimit("phone:+213550123456:appointments", opts),
    ).resolves.toBeUndefined();
  });

  it("resets the counter once the window has expired", async () => {
    vi.useFakeTimers();
    try {
      const opts = { limit: 1, windowMs: 1_000 };
      await checkRateLimit("ip:203.0.113.4:appointments", opts);
      await expect(
        checkRateLimit("ip:203.0.113.4:appointments", opts),
      ).rejects.toBeInstanceOf(RateLimitError);

      // Advance past the window — the counter should reset.
      vi.advanceTimersByTime(1_500);
      await expect(
        checkRateLimit("ip:203.0.113.4:appointments", opts),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
