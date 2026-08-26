import { describe, it, expect, beforeEach } from "vitest";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { logAction } from "./logAction";

beforeEach(async () => {
  await getPrisma().user.create({
    data: {
      name: "Staff",
      email: "staff@orthocare.com",
      passwordHash: "dummyhash",
      role: Role.RECEPTIONIST,
    },
  });
});

describe("logAction", () => {
  it("writes a full audit row including JSON detail and ipAddress", async () => {
    await logAction(
      { type: AuditActorType.PATIENT },
      AuditAction.SELF_SERVICE_CANCELLED,
      "Appointment",
      "appt-1",
      { reason: "patient" },
      "1.2.3.4",
    );

    const rows = await getPrisma().auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe(AuditActorType.PATIENT);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].action).toBe(AuditAction.SELF_SERVICE_CANCELLED);
    expect(rows[0].entityType).toBe("Appointment");
    expect(rows[0].entityId).toBe("appt-1");
    expect(rows[0].detail).toEqual({ reason: "patient" });
    expect(rows[0].ipAddress).toBe("1.2.3.4");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("records the staff userId for STAFF actors", async () => {
    const staff = await getPrisma().user.findFirstOrThrow();

    await logAction(
      { type: AuditActorType.STAFF, userId: staff.id },
      AuditAction.APPOINTMENT_CONFIRMED,
      "Appointment",
      "appt-2",
    );

    const row = await getPrisma().auditLog.findFirstOrThrow();
    expect(row.userId).toBe(staff.id);
    expect(row.detail).toEqual({});
  });

  it("supports SYSTEM actors with no userId", async () => {
    await logAction(
      { type: AuditActorType.SYSTEM },
      AuditAction.APPOINTMENT_AUTO_CANCELLED,
      "Appointment",
      "appt-3",
      { pendingExpiryHours: 24 },
    );

    const row = await getPrisma().auditLog.findFirstOrThrow();
    expect(row.actorType).toBe(AuditActorType.SYSTEM);
    expect(row.userId).toBeNull();
  });
});