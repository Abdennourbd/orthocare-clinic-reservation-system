/**
 * Sentry PII scrubbing (Task 23).
 *
 * Pure helper — no Sentry import so it stays unit-testable and never pulls
 * patient data into bundles. Wired into `beforeSend` in all three Sentry
 * configs (client/server/edge).
 *
 * Rules:
 * - request bodies / data stripped (may contain names, phones, notes)
 * - self-service tokens in URLs masked: /appointment/<token> -> [REDACTED]
 * - known patient keys removed from extra/contexts/user
 */

type LooseRecord = Record<string, unknown>;

function maskTokenUrls(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\/appointment\/[^/?#\s]+/g, "/appointment/[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(maskTokenUrls);
  if (value && typeof value === "object") {
    const out: LooseRecord = {};
    for (const [k, v] of Object.entries(value as LooseRecord)) {
      out[k] = maskTokenUrls(v);
    }
    return out;
  }
  return value;
}

const PATIENT_KEYS = new Set([
  "patient",
  "patientId",
  "firstName",
  "lastName",
  "phone",
  "phoneE164",
  "email",
  "birthDate",
  "notes",
  "treatment",
  "body",
]);

function stripPatientKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripPatientKeys);
  if (obj && typeof obj === "object") {
    const out: LooseRecord = {};
    for (const [k, v] of Object.entries(obj as LooseRecord)) {
      if (PATIENT_KEYS.has(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = stripPatientKeys(v);
      }
    }
    return out;
  }
  return obj;
}

export type ScrubbedEvent = LooseRecord;

/** Mutates nothing — returns a scrubbed copy safe to send to Sentry. */
export function scrubEvent(event: LooseRecord): ScrubbedEvent {
  const copy = JSON.parse(JSON.stringify(event ?? {})) as LooseRecord;

  // Strip request bodies (may contain patient form data).
  if (copy.request && typeof copy.request === "object") {
    const req = copy.request as LooseRecord;
    if ("data" in req) delete req.data;
    if ("body" in req) delete req.body;
    if (typeof req.url === "string") req.url = maskTokenUrls(req.url) as string;
    if (typeof req.headers === "object" && req.headers !== null) {
      const headers = req.headers as LooseRecord;
      for (const hk of ["cookie", "authorization", "x-cron-secret"]) {
        if (hk in headers) headers[hk] = "[REDACTED]";
      }
    }
  }

  if (typeof copy.transaction === "string") {
    copy.transaction = maskTokenUrls(copy.transaction) as string;
  }

  if (Array.isArray(copy.breadcrumbs)) {
    copy.breadcrumbs = maskTokenUrls(copy.breadcrumbs) as ScrubbedEvent["breadcrumbs"];
  }

  // Exception values may embed patient names from template strings.
  // We keep the message shape but mask token-like URL fragments inside it.
  if (copy.exception && typeof copy.exception === "object") {
    copy.exception = maskTokenUrls(copy.exception) as LooseRecord;
  }

  if (copy.extra && typeof copy.extra === "object") {
    copy.extra = stripPatientKeys(copy.extra) as LooseRecord;
  }
  if (copy.contexts && typeof copy.contexts === "object") {
    copy.contexts = stripPatientKeys(copy.contexts) as LooseRecord;
  }
  if (copy.user && typeof copy.user === "object") {
    copy.user = stripPatientKeys(copy.user) as LooseRecord;
  }

  return copy;
}
