---
name: trap-unicode-escape-vs-literal-glyph
description: When a code review asks for a regex character class to use \uXXXX escapes instead of literal combining/Arabic characters, typing the class directly in an Edit/Write tool call tends to insert the real glyphs, not escape text — verify with od -c before trusting it.
metadata:
  type: feedback
---

**The trap**: asked to rewrite a regex character class like
`/[̀-ͯ]/g` (literal combining marks) as `\uXXXX` escapes
(`/[̀-ͯ]/g`), simply retyping/copy-composing the class in an
`Edit`/`Write` tool call is unreliable — it's very easy to end up writing the
actual Unicode characters again (visually indistinguishable in most
renderers from the escape text once combined with adjacent glyphs), silently
failing to fix the exact fragility the review flagged.

**Why**: as the model, "typing `̀`" and "typing the character U+0300"
look the same in my own generation stream unless I'm deliberate. A tool's
`old_string`/`new_string` diffing can also report no-op ("old and new are
identical") when both are actually the same literal glyph, masking the bug.

**How to apply**: when a fix requires literal ASCII escape text
(`\`, `u`, hex digits) rather than the character it denotes, build the file
content out-of-band — e.g. a heredoc (`cat > file << 'EOF' ... EOF`, single
quotes so nothing gets shell-interpreted) or a script that concatenates
`chr(92)` for the backslash rather than typing `\uXXXX` inline — then verify
with `od -c` (not just a `cat`/`Read`, which will happily rerender escapes as
glyphs) that the bytes are `\`, `u`, `0`, `3`, `0`, `0`, etc., not a
multi-byte UTF-8 sequence. Don't trust a visual re-read as proof.

Also worth knowing: a tool call's string parameters seem to pass through
without JSON-style backslash-eating in this environment — a single literal
`\` typed in a heredoc body reliably lands as a single `\` byte on disk (confirmed
empirically here), so the "double the backslashes" instinct from other JSON-string
contexts is unnecessary and will over-escape.

Encountered while fixing [[project-patient-duplicates-accent-tradeoff]]
(task-13 step 3 tour 2, [MINEUR-4] — combining-mark class had to become
`\uXXXX` escapes for both the existing Latin range and new Arabic ranges).
