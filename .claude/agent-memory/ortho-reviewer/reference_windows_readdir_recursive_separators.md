---
name: reference-windows-readdir-recursive-separators
description: node's fs.readdir(dir, { recursive: true }) returns backslash-separated entries on Windows only — CI (Linux) never exercises that branch
metadata:
  type: reference
---

Any test in this repo that walks a directory with
`readdir(dir, { recursive: true })` and then builds a route/URL path from the
entry string is exposed to a platform-only bug: on Windows, entries look like
`"sub\route.ts"`; on Linux (CI) they're always `"sub/route.ts"`. A transform
that does `.replace(/\/route\.ts$/, "").replace(/\\/g, "/")` (suffix-strip
before backslash-normalize) silently fails to strip the suffix on Windows,
while looking correct and staying green on Linux CI forever.

**Why**: hit in `tests/authz-matrix.test.ts` (fixed by reordering the two
`.replace()` calls, then reviewed 2026-08-28). The safer fix — not yet
applied, only recommended — is to make the suffix regex separator-agnostic,
e.g. `file.replace(/[\\/]route\.ts$/, "").replace(/\\/g, "/")`, which removes
the ordering dependency entirely instead of just documenting it.

**How to apply**: when reviewing any diff that manipulates `readdir`
`recursive: true` entries as strings, check whether the transform is tested
(or at least reasoned about) with a literal backslash-containing string, not
just "works on my Windows machine" / "green on Linux CI" — CI alone cannot
catch this class of regression.
