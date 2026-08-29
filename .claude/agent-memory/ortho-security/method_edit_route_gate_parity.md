---
name: method-edit-route-gate-parity
description: How to audit a PATCH/edit route against the POST/create route it mirrors — gate-by-gate parity, keyed on the resulting state rather than on which field changed
metadata:
  type: feedback
---

When a create route guards a write behind N independent acknowledgement gates,
audit the edit route by putting the two side by side and asking, for each gate:
**would a caller reaching the same end state through the edit route have to
supply the same acknowledgement set?**

**Why:** create-route gates are naturally written as "does the *result* collide
with anything?", while edit-route gates get written as "did *this field* change?".
Those two formulations diverge exactly when a single-field edit produces a
collision on a field the caller did not touch — and the divergence is invisible
in tests, because each gate has its own passing test. This produced a finding on
`/api/admin/patients/[id]` PATCH in task 13 étape 5.

**How to apply:** for every `if (xChanged && xMatches.length > 0 && !ackX)`
pattern, construct the case where `x` did not change but `xMatches` is non-empty
because of the *other* field's new value. Then check whether the create route
would have demanded `ackX` for that same end state. Related:
[[reference_patient_write_path_parity]], [[guard_upsert_patient_phone_name]].
