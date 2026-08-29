---
name: project-task13-relay-file-is-authoritative
description: Task 13 relay file conventions — where user arbitrages override the step card, and how the Journal is structured per step
metadata:
  type: project
---

`.claude/tasks/task-13.md` is the sole channel between agents on Task 13
(patient CRUD + duplicate detection). Two things worth knowing before editing
it:

- **§"Arbitrages rendus par l'utilisateur" and §"Exigences ajoutées par
  l'utilisateur" near the top of the file are dated and OVERRIDE the older
  step cards below them when they conflict.** E.g. step 2's own "Vigilance
  sécurité" line said two scan-filter widenings were "out of scope, report
  don't fix" — but a later, dated user arbitrage (§Exigences point 7)
  explicitly repatriated them into step 2. The builder who hit this
  documented the override explicitly in the Journal rather than silently
  picking one. Do the same: if a step card and a dated arbitrage conflict,
  the arbitrage wins, but say so in your Journal entry.

- **Each step's Journal is append-only and chronological**, one entry per
  agent pass (`ortho-builder`, `ortho-tester`, `ortho-security`,
  `ortho-reviewer`), often across multiple "tours" (rounds) when a security
  audit finds MAJEUR issues that get fixed and re-audited. When adding a
  tour-N entry, read the prior tour's audit findings first (usually the
  section right above, "⚠️ À traiter dans les étapes suivantes") — that's
  where the concrete list of what to fix next tour lives, often with exact
  line numbers and a suggested fix already sketched out by ortho-security.

See also [[feedback-authz-matrix-hardening]] for what Task 13 step 2
specifically hardened.
