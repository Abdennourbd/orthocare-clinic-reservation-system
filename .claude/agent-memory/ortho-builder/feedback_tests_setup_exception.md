---
name: feedback-tests-setup-exception
description: tests/setup.ts is normally forbidden to edit, but user has granted a narrow precedent for message-only security fixes to it
metadata:
  type: feedback
---

CLAUDE.md's "never edit or bypass tests/setup.ts" rule is not absolute in the
user's eyes — on 2026-08-28 the user explicitly authorized editing only the
*error message text* of the non-local-DB guard in tests/setup.ts, to stop it
interpolating the raw `TEST_DATABASE_URL` (which leaks the DB password) into
an exception that ends up in CI logs. The guard condition, the `throw` site,
`beforeEach`, the `TRUNCATE` table list, and the localhost fallback default
stayed untouched — the authorization was scoped tightly to the message body.

**Why:** the user's reasoning: the ban exists to protect the guard itself
(the local-DB check and the TRUNCATE safety), not to protect a credential leak
in an error string. Fixing the message strengthens the guard's purpose rather
than weakening it.

**How to apply:** treat "never touch tests/setup.ts" as still the default for
any future task. If a future request asks to touch this file again, do NOT
assume this precedent covers it — require a fresh, explicit, narrowly-scoped
authorization from the user for that specific change, spelled out in the task
message the way this one was. Don't generalize "message-only fixes are fine"
to other guard files without the same explicit ask.
