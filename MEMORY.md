# Memory Index

- [tests/setup.ts exception precedent](.claude/agent-memory/ortho-builder/feedback_tests_setup_exception.md) — narrow, one-off authorization to fix a credential-leaking error message; don't generalize to other edits of this file.
- [Task 13 relay file is authoritative](.claude/agent-memory/ortho-builder/project_task13_relay_file.md) — dated §Exigences arbitrages override stale step-card wording; say so explicitly when they conflict.
- [Relay file precedence: §Exigences wins](.claude/agent-memory/ortho-builder/feedback_relay_file_precedence.md) — always read the full §Exigences section before trusting a step's own "hors périmètre" line.
- [authz-matrix hardening feedback](.claude/agent-memory/ortho-builder/feedback_authz_matrix_hardening.md) — lessons from 3 tours of hardening tests/authz-matrix.test.ts.
- [authz-matrix dynamic routes](.claude/agent-memory/ortho-builder/project_authz_matrix_dynamic_routes.md) — how RouteRow/scanPath/requestPath/params work for testing `[id]` routes.
- [Gallery before/after pairing convention](.claude/agent-memory/ortho-builder/project_gallery_pairs_convention.md)
- [Public content cache](.claude/agent-memory/ortho-builder/project_public_content_cache.md)
- [Patient duplicate matching: accent trade-off](.claude/agent-memory/ortho-builder/project_patient_duplicates_accent_tradeoff.md) — ILIKE can't fold diacritics; NAME is a full TS-side normalized scan, PHONE is now its own indexed query (tour-2 fix), Arabic harakat/tatweel covered too.
- [Trap: Unicode escape vs literal glyph](.claude/agent-memory/ortho-builder/trap_unicode_escape_vs_literal_glyph.md) — retyping a regex char class to use \uXXXX escapes can silently insert real glyphs instead; verify with `od -c`.
- [Task 13 patients route conventions](.claude/agent-memory/ortho-builder/project_task13_patients_route_conventions.md) — CSRF code, rate-limit key, no-spread-into-Prisma, 422 phone, 409/GET audit — precedents for steps 5-6.
- [Trap: Edit tool long old_string mismatch](.claude/agent-memory/ortho-builder/trap_edit_tool_long_old_string_mismatch.md) — a long byte-identical old_string can still fail to match; use a short unique anchor + placeholder instead.
- [Trap: hardcoded test dates + clock drift](.claude/agent-memory/ortho-builder/trap_hardcoded_test_dates_clock_drift.md) — FIXED 2026-08-29 via tests/integration/helpers/testDates.ts; reuse it, don't re-hardcode.
- [Task 13 phone-sharing fix](.claude/agent-memory/ortho-builder/project_task13_phone_sharing_fix.md) — dual acknowledgement gates + upsertPatient() phone+name resolution, relevant to étape 5.
- [Trap: createdAt tie, no tiebreak](.claude/agent-memory/ortho-builder/trap_createdAt_tie_no_tiebreak.md) — orderBy createdAt desc alone ties ~5/6 of the time on back-to-back inserts; add id desc tiebreak, and give test fixtures explicit distinct createdAt.
- [Task 13 /[id] routes conventions](.claude/agent-memory/ortho-builder/project_task13_id_routes_conventions.md) — Next16 params typing vs authz-matrix, UncheckedUpdateInput, PATCH dual-gate replay, active:false messaging suppression.
