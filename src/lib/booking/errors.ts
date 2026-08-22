/**
 * Typed errors for the booking domain. Each carries a stable `name` so route
 * handlers can map it to a status code (409 conflict, 404 not found, …)
 * without string-matching, mirroring `SlotConfigError` / `RateLimitError`.
 */

/** The requested slot was already taken (or violates policy) when the
 * transaction re-checked it. Maps to HTTP 409. */
export class SlotConflictError extends Error {
  constructor(message = "This time slot is no longer available.") {
    super(message);
    this.name = "SlotConflictError";
  }
}

/** The appointment does not exist. Maps to HTTP 404. */
export class AppointmentNotFoundError extends Error {
  constructor(appointmentId: string) {
    super(`Appointment not found: ${appointmentId}`);
    this.name = "AppointmentNotFoundError";
  }
}

/** The appointment is already cancelled/rescheduled/completed, so releasing
 * it again would be a no-op/conflict. Maps to HTTP 409. */
export class AppointmentAlreadyReleasedError extends Error {
  constructor(appointmentId: string) {
    super(`Appointment ${appointmentId} has already been released.`);
    this.name = "AppointmentAlreadyReleasedError";
  }
}

/** The phone already holds the maximum number of active PENDING bookings.
 * Maps to HTTP 429. Thrown inside the booking transaction, after a per-phone
 * advisory lock, so concurrent requests cannot all pass the cap. */
export class PendingLimitError extends Error {
  constructor(limit: number) {
    super(`Maximum ${limit} active pending bookings per phone.`);
    this.name = "PendingLimitError";
  }
}

/** The requested service does not exist. Maps to HTTP 404. */
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`Service not found: ${serviceId}`);
    this.name = "ServiceNotFoundError";
  }
}
