import { describe, it, expect } from "vitest";
import {
  AppointmentStatus,
  AuditAction,
  CancelReason,
} from "@/generated/prisma/client";
import { STATUS_TRANSITIONS, getAdminTransition } from "./adminTransitions";

// Pure unit test for the Task 14 status-transition map (the single source of
// truth shared by PATCH /api/admin/appointments/[id] and these tests). No DB,
// no mocks — the module is pure by design.

describe("STATUS_TRANSITIONS", () => {
  it("maps CONFIRM to CONFIRMED with confirmedAt, the right audit action, a confirmation SMS and no slot release", () => {
    expect(STATUS_TRANSITIONS.CONFIRM).toEqual({
      newStatus: AppointmentStatus.CONFIRMED,
      timestampField: "confirmedAt",
      auditAction: AuditAction.APPOINTMENT_CONFIRMED,
      cancelReason: null,
      smsSender: "sendAppointmentConfirmation",
      releasesSlot: false,
    });
  });

  it("maps CANCEL to CANCELLED with cancelledAt, the STAFF cancel reason, a cancellation SMS and a slot release", () => {
    expect(STATUS_TRANSITIONS.CANCEL).toEqual({
      newStatus: AppointmentStatus.CANCELLED,
      timestampField: "cancelledAt",
      auditAction: AuditAction.APPOINTMENT_CANCELLED,
      cancelReason: CancelReason.STAFF,
      smsSender: "sendAppointmentCancelled",
      releasesSlot: true,
    });
  });

  it("maps COMPLETE to COMPLETED with completedAt, no SMS and no slot release", () => {
    expect(STATUS_TRANSITIONS.COMPLETE).toEqual({
      newStatus: AppointmentStatus.COMPLETED,
      timestampField: "completedAt",
      auditAction: AuditAction.APPOINTMENT_COMPLETED,
      cancelReason: null,
      smsSender: null,
      releasesSlot: false,
    });
  });

  it("maps NO_SHOW to NO_SHOW with noShowAt, no SMS and no slot release", () => {
    expect(STATUS_TRANSITIONS.NO_SHOW).toEqual({
      newStatus: AppointmentStatus.NO_SHOW,
      timestampField: "noShowAt",
      auditAction: AuditAction.APPOINTMENT_NO_SHOW,
      cancelReason: null,
      smsSender: null,
      releasesSlot: false,
    });
  });

  it("defines exactly the four staff actions", () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([
      "CANCEL",
      "COMPLETE",
      "CONFIRM",
      "NO_SHOW",
    ]);
  });

  it("sets a distinct timestamp field per action (per-status timestamps acceptance criterion)", () => {
    const fields = Object.values(STATUS_TRANSITIONS).map((t) => t.timestampField);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("never sends an SMS for COMPLETE/NO_SHOW and never frees a slot for them", () => {
    for (const action of ["COMPLETE", "NO_SHOW"] as const) {
      expect(STATUS_TRANSITIONS[action].smsSender).toBeNull();
      expect(STATUS_TRANSITIONS[action].releasesSlot).toBe(false);
      expect(STATUS_TRANSITIONS[action].cancelReason).toBeNull();
    }
  });

  it("only CANCEL carries a cancel reason and frees the slot", () => {
    for (const [action, transition] of Object.entries(STATUS_TRANSITIONS)) {
      const isCancel = action === "CANCEL";
      expect(transition.releasesSlot).toBe(isCancel);
      if (isCancel) {
        expect(transition.cancelReason).toBe(CancelReason.STAFF);
      } else {
        expect(transition.cancelReason).toBeNull();
      }
    }
  });

  it("getAdminTransition returns the same object as the map (one source of truth)", () => {
    for (const action of Object.keys(STATUS_TRANSITIONS) as Array<
      keyof typeof STATUS_TRANSITIONS
    >) {
      expect(getAdminTransition(action)).toBe(STATUS_TRANSITIONS[action]);
    }
  });
});
