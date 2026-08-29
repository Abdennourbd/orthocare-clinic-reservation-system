---
name: pattern-removed-field-survives-in-tests
description: When a field is removed from a payload for privacy reasons, grep tests/ too — the schema round-trip tests write raw Prisma payloads and keep the removed shape alive as the exemplar the next dev copies
metadata:
  type: project
---

Removing an identifying field from a typed payload only removes it from the paths that
go through the type. `tests/schema.test.ts` exercises the data model with **raw
`prisma.*.create()` calls and inline object literals**, so it bypasses every application
type and keeps writing the old shape long after production code stopped.

**Why:** this already produced a finding on task 13 étape 6. `patientName` was removed
from the four `Notification` payload types and from all four producers, `npm test` went
green — and `tests/schema.test.ts` was still creating a `Notification` whose `payload`
contained a patient name and asserting it round-trips. Synthetic data, so no disclosure,
but it is the first thing a developer finds when they grep for "how do I write a
Notification payload", and it re-teaches the exact anti-pattern that was just removed.

**How to apply:** when a diff removes a field for privacy reasons, the completeness grep
is `grep -rn "<field>" src/ tests/ messages/ | grep -v src/generated` — never `src/`
alone. Any surviving hit in a raw-Prisma test is at minimum a stale exemplar. The same
reasoning applies to `Setting.value`, `AuditLog.detail` and any other `Json` column: a
type guards only the callers who use it.

Related: [[guard-erasure-surface-inventory]],
[[invariant-audit-detail-no-patient-identity]]
