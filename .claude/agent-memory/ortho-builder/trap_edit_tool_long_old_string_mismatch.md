---
name: trap-edit-tool-long-old-string-mismatch
description: The Edit tool can report "String to replace not found" for a long multi-line old_string that is byte-identical to the file (verified with od/python) — shrink to a short unique anchor instead of debugging encoding
metadata:
  type: feedback
---

Hit while appending a long Journal entry to `.claude/tasks/task-13.md`
(2026-08-29): an `Edit` call with a ~5-line `old_string` copied verbatim from
a prior `Read` (including accented French text and em-dashes) failed with
"String to replace not found in file", even though `od -c` / a Python
`in`-check on the surrounding lines showed byte-for-byte identical UTF-8
content (the apparent mismatch in a quick `python3 -c "..."` check was itself
a red herring — the terminal's non-UTF-8 locale mangled the *display* of the
comparison, not the actual file bytes; `od -An -tx1` on the raw line showed
correct UTF-8 `c3 89` for `É`).

**Why:** not fully diagnosed — possibly the Edit tool's internal matcher has
a length/complexity limit or is sensitive to something not visible in a
`Read` dump (e.g. a stray invisible character introduced when composing the
`old_string` by hand from a Read transcript, or a fuzzy-match model losing
confidence on a long literal French passage full of punctuation).

**How to apply:** when a long, visually-correct `old_string` fails to match,
don't spend time proving the bytes are identical — instead, shrink the
`old_string` to a short, definitely-unique anchor near the insertion point
(e.g. a single line or two), insert a placeholder there, and then do a
**second** `Edit` using the placeholder itself as the (now trivially unique)
`old_string` to swap in the full content. This worked on the first try both
times. Cheaper than debugging encoding when the file is confirmed correct by
`od`.
