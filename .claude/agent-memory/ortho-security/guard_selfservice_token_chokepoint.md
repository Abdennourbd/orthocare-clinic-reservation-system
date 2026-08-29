---
name: guard-selfservice-token-chokepoint
description: verifySelfServiceToken (src/lib/selfservice/tokens.ts) is the single place used/revoked/expired are enforced — stamping revokedAt closes all three self-service routes at once
metadata:
  type: project
---

`verifySelfServiceToken()` in `src/lib/selfservice/tokens.ts` checks, in order,
`usedAt` → `revokedAt` → `expiresAt` and throws a typed error for each. It is the
**only** place those three states are enforced, and all three self-service routes go
through it: `GET /api/appointments/[token]`, `.../cancel`, `.../reschedule`.

**Why:** this matters when auditing whether a revocation actually revokes. A test that
only proves `GET` returns 410 looks like partial coverage, but because the check lives
in the shared verifier rather than in each route, one `revokedAt` stamp closes the
lookup **and** both state-changing actions. Conversely, if a future route ever resolves
a token by querying `selfServiceToken` directly instead of calling this verifier, it
silently opts out of all three checks at once — that is the shape to look for.

**How to apply:** for any diff that revokes, rotates or expires tokens, confirm the
consuming path calls `verifySelfServiceToken` rather than its own `findUnique` on
`tokenHash`. `grep -rn "selfServiceToken\." src/ --include=*.ts | grep -v test` is the
whole surface; anything outside `tokens.ts` and `privacy/anonymize.ts` deserves a read.

Related: [[guard-erasure-surface-inventory]]
