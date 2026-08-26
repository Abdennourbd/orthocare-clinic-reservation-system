/**
 * Typed errors for the self-service token domain. Distinct classes so route
 * handlers can map each rejection to a status without string-matching, and so
 * the negative-test matrix (not found / used / revoked / expired / inactive
 * appointment) has a stable handle.
 */

/** The raw token does not match any stored token hash. Maps to HTTP 404. */
export class SelfServiceTokenNotFoundError extends Error {
  constructor() {
    super("Ce lien n'est pas valide.");
    this.name = "SelfServiceTokenNotFoundError";
  }
}

/** The token was already consumed by a cancel/reschedule. Maps to HTTP 410. */
export class SelfServiceTokenUsedError extends Error {
  constructor() {
    super("Ce lien a déjà été utilisé.");
    this.name = "SelfServiceTokenUsedError";
  }
}

/** The token was revoked (e.g. rotated after a reschedule). Maps to HTTP 410. */
export class SelfServiceTokenRevokedError extends Error {
  constructor() {
    super("Ce lien a été révoqué.");
    this.name = "SelfServiceTokenRevokedError";
  }
}

/** The token has passed its expiry. Maps to HTTP 410. */
export class SelfServiceTokenExpiredError extends Error {
  constructor() {
    super("Ce lien a expiré.");
    this.name = "SelfServiceTokenExpiredError";
  }
}

/** The appointment is no longer PENDING/CONFIRMED (cancelled, completed…). */
export class AppointmentNotActiveError extends Error {
  constructor() {
    super("Ce rendez-vous ne peut plus être modifié.");
    this.name = "AppointmentNotActiveError";
  }
}

/** A token may only be issued for a CONFIRMED appointment (it lives in the
 * confirmation SMS). */
export class AppointmentNotConfirmedError extends Error {
  constructor() {
    super("Seuls les rendez-vous confirmés reçoivent un lien de gestion.");
    this.name = "AppointmentNotConfirmedError";
  }
}