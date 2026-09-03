/**
 * Sentry PII scrubbing (Task 23).
 *
 * Pure helper — no Sentry import so it stays unit-testable and never pulls
 * patient data into bundles. Wired into `beforeSend` in all three Sentry
 * configs (client/server/edge).
 *
 * Rules:
 * - request bodies / data / query_string / cookies stripped or masked
 * - self-service tokens masked in page AND api URLs:
 *   /appointment/<token> and /api/appointments/<token> -> [REDACTED]
 * - known patient keys redacted in extra/contexts/user AND in
 *   breadcrumbs / exception values / message (free text is untrusted)
 * - beforeSend must never throw: cloning is throw-proof
 */

type LooseRecord = Record<string, unknown>;

// Matches /appointment/<token>, /api/appointments/<token>, any locale prefix.
const TOKEN_URL_RE = /\/(?:api\/)?appointments?\/[^/?#\s]+/g;

function maskTokenUrls(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN_URL_RE, (m) => m.replace(/\/[^/]+$/, "/[REDACTED]"));
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
  "name",
  "phone",
  "phoneE164",
  "email",
  "birthDate",
  "dateOfBirth",
  "dob",
  "address",
  "notes",
  "treatment",
  "body",
  "token",
  "rawToken",
  "sessionId",
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

/** Both token masking and patient-key redaction for untrusted free text. */
function scrubUntrusted(value: unknown): unknown {
  return stripPatientKeys(maskTokenUrls(value));
}

function safeClone(event: LooseRecord): LooseRecord {
  try {
    if (typeof structuredClone === "function") return structuredClone(event);
  } catch {
    // fall through to JSON
  }
  try {
    return JSON.parse(JSON.stringify(event ?? {})) as LooseRecord;
  } catch {
    // Non-serializable (circular/BigInt): return a minimal safe shell.
    const fallback: LooseRecord = {};
    if (typeof event.transaction === "string") fallback.transaction = event.transaction;
    if (typeof event.level === "string") fallback.level = event.level;
    return fallback;
  }
}

export type ScrubbedEvent = LooseRecord;

/** Mutates nothing — returns a scrubbed copy safe to send to Sentry. */
export function scrubEvent(event: LooseRecord): ScrubbedEvent {
  const copy = safeClone(event ?? {});

  // Strip request bodies (may contain patient form data).
  if (copy.request && typeof copy.request === "object") {
    const req = copy.request as LooseRecord;
    if ("data" in req) delete req.data;
    if ("body" in req) delete req.body;
    if (typeof req.url === "string") req.url = maskTokenUrls(req.url) as string;
    if (typeof req.query_string === "string") {
      req.query_string = maskTokenUrls(req.query_string) as string;
    }
    if (req.cookies && typeof req.cookies === "object") {
      req.cookies = stripPatientKeys(maskTokenUrls(req.cookies)) as LooseRecord;
    }
    if (typeof req.headers === "object" && req.headers !== null) {
      const headers = req.headers as LooseRecord;
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "cookie" || lower === "authorization" || lower === "x-cron-secret") {
          headers[key] = "[REDACTED]";
        } else if (typeof headers[key] === "string") {
          headers[key] = maskTokenUrls(headers[key]);
        }
      }
    }
  }

  if (typeof copy.transaction === "string") {
    copy.transaction = maskTokenUrls(copy.transaction) as string;
  }

  if (typeof copy.message === "string") {
    copy.message = scrubUntrusted(copy.message) as string;
  }

  if (Array.isArray(copy.breadcrumbs)) {
    copy.breadcrumbs = scrubUntrusted(copy.breadcrumbs) as ScrubbedEvent["breadcrumbs"];
  }

  if (copy.exception && typeof copy.exception === "object") {
    copy.exception = scrubUntrusted(copy.exception) as LooseRecord;
  }

  if (Array.isArray(copy.spans)) {
    copy.spans = scrubUntrusted(copy.spans) as ScrubbedEvent["spans"];
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
