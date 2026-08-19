import { describe, it, expect, vi } from "vitest";
import {
  checkRateLimit,
  cleanupRateLimitCounters,
  RateLimitError,
} from "./rateLimit";

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

  it("reports the actual time remaining when the limit is exceeded", async () => {
    vi.useFakeTimers();
    try {
      const opts = { limit: 1, windowMs: 60_000 };
      const key = "ip:203.0.113.5:appointments";
      await checkRateLimit(key, opts); // window starts at T0
      vi.advanceTimersByTime(25_000); // now = T0 + 25s

      await expect(checkRateLimit(key, opts)).rejects.toMatchObject({
        // remaining = windowStart + windowMs - now = 0 + 60s - 25s = 35s
        retryAfterMs: 35_000,
      });
    } finally {
      vi.useRealTimers();
    }
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

  it("cleanupRateLimitCounters deletes expired rows but keeps recent ones", async () => {
    vi.useFakeTimers();
    try {
      const { getPrisma } = await import("@/lib/db");
      const prisma = getPrisma();

      // Insert one old row (window started long ago) and one recent row.
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const recentDate = new Date(); // now
      await prisma.rateLimitCounter.createMany({
        data: [
          { key: "ip:old:appointments", windowStart: oldDate, count: 5 },
          { key: "ip:recent:appointments", windowStart: recentDate, count: 1 },
        ],
      });

      const deleted = await cleanupRateLimitCounters(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(1);

      const remaining = await prisma.rateLimitCounter.findMany({
        select: { key: true },
      });
      const keys = remaining.map((r) => r.key);
      expect(keys).not.toContain("ip:old:appointments");
      expect(keys).toContain("ip:recent:appointments");
    } finally {
      vi.useRealTimers();
    }
  });
});
