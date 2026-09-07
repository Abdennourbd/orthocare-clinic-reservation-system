# Security Pass: Home UI (2026-09-07, Task 5)

Scope: everything added by the home-ui pass (5 commits, `2fabed2..HEAD` at time
of writing). Threat model: this pass adds zero API routes, zero user input,
zero auth changes — static public UI + one WebGL canvas + vendored images.
The boundaries that matter: supply chain (2 new npm packages, 1 vendored
component, 8 vendored images) and response headers (CSP must still hold).

## Checks performed (all green unless noted)

- [x] Full suite: 111 files / 1177 tests green, incl. `headers.test.ts`,
      `authz-matrix.test.ts`, CSP regression tests.
- [x] `typecheck` + `lint` (only 2 pre-existing warnings) + `next build` clean.
- [x] SSR smoke: `/fr /en /ar` render name, portrait (next/image optimized),
      logo; zero slop remnants; `/ar` is `dir="rtl"`.
- [x] No secrets in tracked files (`.env` untracked; no keys/tokens in diff).
- [x] No WP hotlinks in `src/` (all 8 images vendored under `public/images/`,
      served via `next/image`; WP URLs live only in `tasks/` docs).
- [x] New UI code makes zero network requests (grep for
      `fetch/XMLHttpRequest/WebSocket/new Image` in
      `fluid-orb/HeroOrb/HeroHome/TrustStrip` — none; canvas-only WebGL).
- [x] `fluid-orb` source verified: raw WebGL1, no deps beyond local `cn`,
      no CDN, honors `prefers-reduced-motion`, cleans up GL resources.
- [x] `npm audit`: 4 findings, none introduced by this pass (see below).

## `npm audit` dispositions (per reachability triage)

| Finding | Severity | Reachability | Disposition |
|---|---|---|---|
| `fast-uri` host confusion (via sentry webpack plugin → ajv) | moderate | Build-time only, never production runtime, never user input | Fix in next networked session: `npm audit fix` (non-breaking). Blocked here: registry tarball fetch refused (`EALLOWREMOTE`/IPv6). |
| `mysql2` ×2 (via `prisma` CLI) | high | Unreachable: no MySQL anywhere (Postgres via `pg`); CLI-only dep | Accepted risk: fix requires breaking Prisma major (`6.19.3`). Revisit on Prisma upgrade. |
| `xlsx` pollution + ReDoS (no fix available) | high | Low: server-side generation from DB data on ADMIN-only export route; exploiting needs admin rights already | Accepted risk, review 2026-12-07. Never parse user-uploaded workbooks with it. |
| `clsx`, `tailwind-merge` (added by this pass) | — | Clean: zero advisories, zero deps, no install scripts | No action. Pinned via `vendor/npm/*.tgz` (see `vendor/npm/README.md`). |

## Notes for next session

- Re-run `npm audit fix` (non-force) with working registry for `fast-uri`.
- Manual checks not done here (no browser tooling in this session): mobile
  Lighthouse spot-check + keyboard-only pass + desktop/mobile/AR screenshots.
  Required before merge per `tasks/todo-home-ui.md` definition of done.
