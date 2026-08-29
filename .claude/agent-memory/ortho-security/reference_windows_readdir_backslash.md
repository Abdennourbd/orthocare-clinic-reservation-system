---
name: reference-windows-readdir-backslash
description: On this Windows dev box readdir(dir, {recursive:true}) returns backslash-separated entries — verified cause of a CI-green/local-red divergence in path-derived security guards
metadata:
  type: reference
---

Verified on this machine: `readdir("src/app/api/admin", { recursive: true })`
returns `["audit", "audit\\route.ts"]` — backslash separators, and directory
entries alongside file entries. On CI (Linux) the same call returns forward
slashes.

**Why it matters for security review:** any guard that derives a URL path from
a readdir entry must normalize backslashes to slashes *before* applying a
regex that expects a leading `/`. Getting the order wrong makes the guard
behave differently on Windows and on Linux — which is itself a defect, because
a guard you cannot run locally stops being run.

**How to apply:** when auditing path-derivation code, run the readdir call
yourself with `node -e` rather than reasoning from the comment, and check both
separator forms through the transformation. Cross-platform equivalence of the
derived string is part of the audit, not a cosmetic detail.

Related: [[guard-authz-matrix-file-scan]]
