import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { logActionSafe } from "./logAction";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("logActionSafe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the audit row like logAction on the happy path", async () => {
    const staff = await getPrisma().user.create({
      data: {
        name: "Staff",
        email: "staff-safe@orthocare.com",
        passwordHash: "dummyhash",
        role: Role.RECEPTIONIST,
      },
    });
    await logActionSafe(
      { type: AuditActorType.STAFF, userId: staff.id },
      AuditAction.APPOINTMENT_CONFIRMED,
      "Appointment",
      "appt-1",
    );

    const rows = await getPrisma().auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(AuditAction.APPOINTMENT_CONFIRMED);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("never throws when the audit write fails, and reports to Sentry", async () => {
    const prisma = getPrisma();
    vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(
      new Error("db down"),
    );

    await expect(
      logActionSafe(
        { type: AuditActorType.SYSTEM },
        AuditAction.APPOINTMENT_AUTO_CANCELLED,
        "Appointment",
        "appt-2",
      ),
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    // Nothing was written — the caller's committed operation stands alone.
    expect(await getPrisma().auditLog.count()).toBe(0);
  });
});
