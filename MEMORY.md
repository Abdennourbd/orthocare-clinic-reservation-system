# Memory Index

- [Relay file precedence](.claude/agent-memory/ortho-builder/feedback_relay_file_precedence.md) — task-<N>.md overrides todo.md when they conflict; ask, don't decide alone
- [tests/setup.ts exception](.claude/agent-memory/ortho-builder/feedback_tests_setup_exception.md) — never edit it, even to "fix" something
- [authz-matrix hardening](.claude/agent-memory/ortho-builder/feedback_authz_matrix_hardening.md) — why `okStatus` is type-restricted, don't loosen the scan filter
- [authz-matrix dynamic routes](.claude/agent-memory/ortho-builder/project_authz_matrix_dynamic_routes.md) — how `[id]` routes got matrix coverage (task 13 step 2)
- [Gallery before/after pairing](.claude/agent-memory/ortho-builder/project_gallery_pairs_convention.md)
- [Public content cache](.claude/agent-memory/ortho-builder/project_public_content_cache.md)
- [Patient duplicate matching accent tradeoff](.claude/agent-memory/ortho-builder/project_patient_duplicates_accent_tradeoff.md) — TS-side normalize, no `unaccent`
- [Task 13 relay file is authoritative](.claude/agent-memory/ortho-builder/project_task13_relay_file.md) — user rulings there override stale step-card text
- [Task 13 id-routes conventions](.claude/agent-memory/ortho-builder/project_task13_id_routes_conventions.md) — steps 5-6 patterns for `/[id]*`
- [Task 13 patients route conventions](.claude/agent-memory/ortho-builder/project_task13_patients_route_conventions.md) — step 4 precedents (CSRF code, field enumeration, audit rules)
- [Task 13 phone-sharing fix](.claude/agent-memory/ortho-builder/project_task13_phone_sharing_fix.md) — two-gate duplicate ack split; corrected: `INDISTINGUISHABLE_RECORDS` is PATCH-only, not POST
- [Task 13 anonymize conventions](.claude/agent-memory/ortho-builder/project_task13_anonymize_conventions.md) — erasure surface, atomicity via conditional `updateMany`
- [Task 13 step 7 patient form UI](.claude/agent-memory/ortho-builder/project_task13_step7_patient_form_ui.md) — inline-only duplicate banner, `dir="auto"` scope, ack-flag reset on edit
- [createdAt tie, no tiebreak](.claude/agent-memory/ortho-builder/trap_createdAt_tie_no_tiebreak.md) — always add `id` as secondary sort key
- [Edit tool long old_string mismatch](.claude/agent-memory/ortho-builder/trap_edit_tool_long_old_string_mismatch.md)
- [Hardcoded test dates / clock drift](.claude/agent-memory/ortho-builder/trap_hardcoded_test_dates_clock_drift.md)
- [Unicode escape vs literal glyph](.claude/agent-memory/ortho-builder/trap_unicode_escape_vs_literal_glyph.md) — combining marks must be `\uXXXX` escapes, not literal chars
