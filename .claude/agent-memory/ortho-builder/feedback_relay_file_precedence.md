---
name: feedback-relay-file-precedence
description: when the task relay file's per-step card contradicts the top §Exigences section, §Exigences wins — it captures later user arbitrage
metadata:
  type: feedback
---

`.claude/tasks/task-<N>.md` step cards are written once by the planner and can
go stale when the user makes a later decision. In Task 13, the step-2 card's
"Vigilance sécurité" line said two known scan blind spots (route.tsx,
missing OPTIONS) were "hors périmètre — signal without fixing." The
top-of-file `§Exigences ajoutées par l'utilisateur, point 7` (dated the same
day, explicitly marked as arbitrage overriding the plan) reclaimed both into
step 2.

**Why**: the orchestrator/user edits `§Exigences` to record decisions made
after planning; the per-step "Hors périmètre" wording is not re-synced
automatically. Trusting the stale per-step line here would have shipped an
avoidable known gap in the only automated RBAC guard file, right before the
first dynamic patient route needed it.

**How to apply**: always read the full `§Exigences ajoutées par
l'utilisateur` section (usually near the top of the relay file) before
trusting a specific step's "hors périmètre" or "vigilance" wording — a later,
dated arbitrage entry always wins over the original step card. When acting on
this kind of override, say so explicitly and loudly in both the response and
the step's own Journal entry (don't just silently do the newer thing).
