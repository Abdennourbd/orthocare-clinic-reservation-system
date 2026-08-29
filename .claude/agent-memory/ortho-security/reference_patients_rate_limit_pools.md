---
name: reference-patients-rate-limit-pools
description: The two rate-limit pools guarding /api/admin/patients* — their keys, budgets, and which routes actually join each pool
metadata:
  type: project
---

Two Postgres-backed pools guard the patient API, both keyed on the staff
session's `userId` (never the IP — one clinic sits behind one public IP, so an
IP key would either do nothing or lock out the whole front desk):

- `staff:<userId>:patients-read` — 60 / 5 min. Declared identically in
  `src/app/api/admin/patients/route.ts`, `[id]/route.ts` and
  `[id]/history/route.ts`. One shared budget, not one per endpoint.
- `staff:<userId>:patients-write` — 30 / 5 min. Declared in
  `src/app/api/admin/patients/route.ts` only.

**Why:** the 409 duplicate-check branches are free, side-effect-free reads of
other patients' `{id, firstName, lastName, phone}` — an oracle whose only cap is
the write pool. Membership of that pool is therefore load-bearing, and it is not
enforced by any shared helper: each route re-declares its own constant.

**How to apply:** for every new `/api/admin/patients*` route, grep for the two
key literals and confirm the route joins the right pool before signing off. The
budget constants being duplicated per file means "the pool exists" never implies
"this route is in it". Related: [[guard_rate_limit_read_surfaces]].
