---
name: invariant-audit-detail-no-patient-identity
description: GET /api/admin/audit echoes the AuditLog.detail JSON blob verbatim — minimum disclosure therefore depends on every logAction() call site, not on the route
metadata:
  type: project
---

`src/app/api/admin/audit/route.ts` whitelists the columns it returns, but one
of them is `detail`, passed through as raw JSON. So the route's minimum-
disclosure guarantee is only as good as what every `logAction()` caller puts
into `detail`.

**Why:** as of the 2026-08-28 review, all call sites (cron expirePending /
noShow / reminders, selfservice actions, auth login / logout /
change-password, the audit read itself) store only ids, enum reasons, ISO
timestamps, counters and a localized service name — no patient name, phone,
email, birthDate or `visitNotes`. That is what keeps the audit viewer
compliant, and it is an invariant maintained by convention, not by a type.

**How to apply:** any diff that adds or edits a `logAction(...)` call is in
scope for a minimum-disclosure check even when it does not touch an API route
— grep the new `detail` object for patient identity fields. Same for
`ipAddress`, which the route also returns.

Related: [[guard-authz-matrix-file-scan]]
