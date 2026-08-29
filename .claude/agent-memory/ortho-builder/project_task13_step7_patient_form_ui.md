---
name: task13-step7-patient-form-ui
description: Task 13 step 7 (first admin dashboard screen with real forms) — conventions for the inline duplicate-warning banner and the admin dashboard's first client form, useful for step 8's edit screen and any future admin CRUD screen.
metadata:
  type: project
---

**No modal, ever, for a duplicate/conflict warning** — tasks/todo.md's
acceptance criterion is explicit and literal: "duplicate warning renders
inline with an explicit save-anyway acknowledgment (never a dead-end blocking
modal)". Concretely this means: no `window.confirm`, no `<dialog>`, no
`role="dialog"`, no overlay, and — the easy one to miss — **never disable the
save/submit button just because the warning banner is visible**. It's fine to
disable it transiently during the in-flight fetch itself (standard
double-submit guard), but that must be tied to network-pending state, not to
"a duplicate warning is currently shown". See `src/components/admin/
DuplicateWarning.tsx` + `src/components/admin/PatientForm.tsx`.

**The banner receives focus on mount AND every time its `code` changes**
(`useEffect(() => ref.current?.focus(), [code])` on a `tabIndex={-1}`
container with `role="alert"`) — a homonym warning can resolve into a
phone-sharing warning on the next submit, and each is a distinct thing that
needs its own announcement, not a silent DOM swap.

**A single boolean acknowledgement flag is NOT scoped to a specific
candidate** — `duplicateAcknowledged`/`phoneSharingAcknowledged`
(`src/schemas/patient.ts`) are just booleans on the request, not tied to any
candidate id. If the UI keeps them `true` in local state across an edit to
the name/phone fields, a stale acknowledgment could silently wave through a
check against a *different* now-current value. Fix used here: any edit to
firstName/lastName/phone resets both acknowledgement flags to `false` and
clears the currently-shown banner (see `handleDuplicateFieldChange` in
`PatientForm.tsx`) — other fields (email/notes/birthDate/checkboxes) leave it
alone since `findDuplicateCandidates` never looks at them.

**`dir="auto"` is not just for RTL locales.** The admin dashboard is FR-only
(no next-intl, no `dir="rtl"` anywhere), but a *patient's own name* can still
be in Arabic script — `dir="auto"` goes on every table cell/input/banner
field that shows a name, phone, or note **typed by staff or read from a
patient record**, in an otherwise permanently `dir="ltr"` page. This is a
task-13.md-specific instruction (not a general CLAUDE.md rule) that also
explicitly includes phone numbers, not just names — don't assume phone
fields are exempt just because they're ASCII digits.

**`?limit=` empty-string trap**: `patientListQuerySchema` (z.coerce.number)
rejects an empty-string `limit` param with 400. Cheapest fix observed here:
don't build a "limit" input at all if the UI doesn't need one — just never
append the param and let the server's own default apply. Simpler than
conditionally appending `URLSearchParams`, which is also correct but is one
more thing to get right per optional query param (`if (value) params.set(...)`
pattern, same as `q` and `active` here and in `AuditViewer.tsx`).

**Reference component for chrome/state structure**: `AuditViewer.tsx` is the
one precedent for a client-side admin list screen in this repo (loading /
empty / error, `focus-visible:ring-teal-600`, `inputClass` string constant,
Précédent/Suivant pagination). Copy its shape rather than inventing a new one
— task-13.md explicitly says to.

See [[project-task13-phone-sharing-fix]] for why the split
`duplicateAcknowledged`/`phoneSharingAcknowledged` exists at the API layer,
and [[project-task13-patients-route-conventions]] for the route-side
contract this form's `fetch` calls depend on.
