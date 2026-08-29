---
name: repo-crlf-working-copy
description: git core.autocrlf=true here — rewriting a whole file with LF newlines produces a spurious full-file diff; preserve CRLF when editing via scripts
metadata:
  type: project
---

The working copy has `core.autocrlf=true`; checked-out files are CRLF while the
index stores LF.

**Why:** Windows checkout. A Python/Node script that rewrites a file with
`newline='\n'` silently converts the whole file to LF, which some tools then show
as a full-file modification even though `git diff --numstat` looks clean.

**How to apply:** when editing files with a script rather than the Edit tool,
read with `newline=''` and write back with CRLF preserved. Confirm the change is
surgical with `git diff --numstat <file>` (should show only the lines you added).

**Prisma-specific trap:** `prisma migrate dev` rewrites
`prisma/migrations/migration_lock.toml` with LF newlines, so it shows up as
modified with an *empty* `git diff` (line-ending-only change). Rewrite it back to
CRLF after migrating to leave a clean tree — `git checkout` is forbidden for this
agent.
