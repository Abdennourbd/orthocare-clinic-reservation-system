import { describe, it, expect, vi } from "vitest";
import {
  SlotConflictError,
  AppointmentNotFoundError,
  AppointmentAlreadyReleasedError,
} from "./errors";
import { onSlotFreed, emitSlotFreed } from "./events";

describe("booking errors", () => {
  it("SlotConflictError carries its name for status mapping", () => {
    const err = new SlotConflictError("Slot just taken");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SlotConflictError");
    expect(err.message).toBe("Slot just taken");
  });

  it("AppointmentNotFoundError carries its name", () => {
    const err = new AppointmentNotFoundError("appt_123");
    expect(err.name).toBe("AppointmentNotFoundError");
    expect(err.message).toContain("appt_123");
  });

  it("AppointmentAlreadyReleasedError carries its name", () => {
    const err = new AppointmentAlreadyReleasedError("appt_123");
    expect(err.name).toBe("AppointmentAlreadyReleasedError");
  });
});

describe("slot-freed event emitter", () => {
  it("invokes subscribed handlers with the event payload", () => {
    const handler = vi.fn();
    const off = onSlotFreed(handler);

    const event = {
      appointmentId: "appt_1",
      resourceId: null,
      startTime: new Date("2026-08-25T10:00:00Z"),
      endTime: new Date("2026-08-25T10:30:00Z"),
    };
    emitSlotFreed(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
    off();
  });

  it("does not invoke a handler after it unsubscribes", () => {
    const handler = vi.fn();
    const off = onSlotFreed(handler);
    off();

    emitSlotFreed({
      appointmentId: "appt_1",
      resourceId: null,
      startTime: new Date("2026-08-25T10:00:00Z"),
      endTime: new Date("2026-08-25T10:30:00Z"),
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
