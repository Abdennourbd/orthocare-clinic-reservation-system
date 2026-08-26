"use client";

// Shared client helpers for the self-service appointment manager. Kept in one
// small module so the two client components (`AppointmentManager`,
// `RescheduleStep`) don't duplicate the fetch wrapper or the button styles.

export type ApiError = Error & { code?: string; status?: number };

/** Fetch + parse a JSON API response, throwing a typed `ApiError` on non-OK
 * statuses (the server always returns `{ error: { code, message } }`). */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      (body as { error?: { message?: string } }).error?.message ??
        `HTTP ${res.status}`,
    ) as ApiError;
    err.code = (body as { error?: { code?: string } }).error?.code;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/** Map an API error code to an i18n key. Unknown/unmapped errors get the
 * generic message. */
export function errorKey(code?: string): string {
  switch (code) {
    case "TOKEN_NOT_FOUND":
      return "errTokenNotFound";
    case "TOKEN_EXPIRED":
      return "errTokenExpired";
    case "TOKEN_USED":
      return "errTokenUsed";
    case "TOKEN_REVOKED":
      return "errTokenRevoked";
    case "APPOINTMENT_UNAVAILABLE":
      return "errAppointmentUnavailable";
    case "RATE_LIMITED":
      return "errRateLimited";
    case "SLOT_CONFLICT":
      return "errConflict";
    default:
      return "errGeneric";
  }
}

export const cardClass =
  "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";

export const dangerButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60";