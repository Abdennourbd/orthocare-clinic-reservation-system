import { errorResponse } from "@/lib/api/http";
import {
  AppointmentNotActiveError,
  SelfServiceTokenExpiredError,
  SelfServiceTokenNotFoundError,
  SelfServiceTokenRevokedError,
  SelfServiceTokenUsedError,
} from "./errors";

// Maps the typed self-service errors to HTTP responses. An unknown/invalid
// link is 404; a link that was valid but is no longer usable (expired, used,
// revoked, appointment no longer active) is 410 Gone. Distinct codes so the
// client can tailor the message.
export function selfServiceTokenErrorResponse(
  e: unknown,
): Response | null {
  if (e instanceof SelfServiceTokenNotFoundError) {
    return errorResponse(404, "TOKEN_NOT_FOUND", e.message);
  }
  if (e instanceof SelfServiceTokenUsedError) {
    return errorResponse(410, "TOKEN_USED", e.message);
  }
  if (e instanceof SelfServiceTokenRevokedError) {
    return errorResponse(410, "TOKEN_REVOKED", e.message);
  }
  if (e instanceof SelfServiceTokenExpiredError) {
    return errorResponse(410, "TOKEN_EXPIRED", e.message);
  }
  if (e instanceof AppointmentNotActiveError) {
    return errorResponse(410, "APPOINTMENT_UNAVAILABLE", e.message);
  }
  return null;
}