---
name: pattern-unaudited-read-on-rejection-path
description: Error/rejection responses that carry patient identity are reads too — they must be audited, and they are the easiest audit hole to miss
metadata:
  type: project
---

A response that **fails** the write can still disclose patient identity, and
that path routinely escapes `logAction()` because the audit call sits at the end
of the happy path.

**Why:** the duplicate-detection flow of Task 13 is the archetype — a `POST`
that returns `409 DUPLICATE_CANDIDATES` with `{ id, firstName, lastName, phone }`
of existing patients writes nothing, so a `logAction(…, PATIENT_CREATED, …)`
placed after a successful `create` never fires. The caller can repeat the probe
indefinitely and leave no trace, while the list route `GET /api/admin/patients`
covering the *same* data is journalised by explicit user arbitrage. The
asymmetry, not the disclosure itself, is the defect: the audit trail is the only
detective control over a staff member acting inside their role.

**How to apply:** for every route, enumerate the response codes that carry
patient fields (not just `200`) and check each has an audit call.
`PATIENT_RECORD_VIEWED` already exists in `AuditAction` for exactly this. The
`detail` must stay counts/ids/enums only — never the probed name, phone or the
search string (see [[invariant-audit-detail-no-patient-identity]]). Second
reflex: such a probe returns a valid `id`, which is a key into the full-record
route — so an id-disclosing rejection path is also an id-discovery oracle and
needs rate limiting keyed on the session `userId`, not the IP.
