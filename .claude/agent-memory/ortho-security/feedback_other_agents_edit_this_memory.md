---
name: feedback-other-agents-edit-this-memory
description: Other agents (ortho-builder) edit ortho-security memory files in place and mark items "Fixed" — re-verify every such claim against the code before relying on it
metadata:
  type: feedback
---

Files under `.claude/agent-memory/ortho-security/` are not written by ortho-security
alone. On task 13 étape 6 TOUR 2, `ortho-builder` edited
`guard_erasure_surface_inventory.md` and annotated three items as "Fixed", and recorded
having done so in the relay-file Journal.

**Why:** the annotations happened to be accurate that time (verified line by line against
`src/lib/privacy/anonymize.ts`), but a "Fixed" written by the agent whose work is under
audit is a self-attestation, not evidence. Treating it as evidence is exactly the
"approval by fatigue" the role forbids, and it would silently shrink the next audit's
scope.

**How to apply:** read these memory files as a *checklist of where to look*, never as a
statement of current state. Any line containing "Fixed", "closed" or "handled" must be
re-proved at a `file:line` in the current working tree before it is cited as conforming.
When the state has genuinely changed, prefer rewriting the line as a neutral inventory
item over recording who fixed what — the relay file Journal is where fix history belongs.

Related: [[guard-erasure-surface-inventory]]
