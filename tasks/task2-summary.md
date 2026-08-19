# Task 2 — i18n foundation + site shell + `localized()` helper (summary)

What was done in Task 2: trilingual public site (FR/AR/EN), Arabic RTL, site
shell (header/footer/hero/nav/locale switcher), and the `localized()` DB
helper. See `tasks/todo.md` → Task 2 and `tasks/plan.md` for the spec.

## Done + verified (all green)

- **next-intl 4.13.7** wired for Next.js 16:
  - `src/i18n/routing.ts` — locales `fr, ar, en`, default `fr`.
  - `src/proxy.ts` — locale-negotiation middleware (Next 16 renamed
    `middleware.ts` → `proxy.ts`). Excludes `/api`, `/admin`, static assets.
  - `src/i18n/request.ts` — loads the locale's `messages/*.json` via
    `next/root-params`.
  - `src/i18n/navigation.ts` — locale-aware `Link`, `useRouter`, etc.
  - `next.config.ts` — `createNextIntlPlugin`.
- **3 locales render** (`/fr`, `/ar`, `/en`), statically prerendered
  (`generateStaticParams`). `/` redirects to `/fr`.
- **Arabic RTL** — `dir="rtl"` on `/ar`, `dir="ltr"` elsewhere.
- **Locale switcher** (`src/components/public/LocaleSwitcher.tsx`) — persists
  the locale via the `next-intl` cookie through `router.replace`.
- **Site shell** — `Header` (logo, Nav, LocaleSwitcher, book CTA), `Footer`,
  `Hero` (home page), `Nav`. Branding uses a clean medical teal palette; exact
  clinic brand colors/logo still to be confirmed.
- **`messages/{fr,ar,en}.json`** — chrome strings (nav, hero, header, footer,
  locale switcher, common).
- **`localized()` helper** — `src/lib/i18n/localized.ts` + config
  (`src/lib/i18n/config.ts`). Returns the requested locale or falls back to FR
  (default), empty string on null. **6 unit tests** cover missing locale, null
  field, empty value, custom fallback.
- **Arabic font subsetted** — `Noto_Sans_Arabic` via `next/font/google` with
  `subsets: ["arabic"]`. Payload below.

## Arabic font payload (measured)

`Noto_Sans_Arabic` (variable) is split into 5 unicode-range subsets by
`next/font`; the browser only downloads the subsets it needs.

| Subset file | Size |
|---|---|
| `3fd1b3eda...` (main Arabic, preloadable) | 162 KB |
| `0bcb14a77...` | 22 KB |
| `14a9d8930...` | 31 KB |
| `6ae070eaf...` | 16 KB |
| `cacc97457...` | 14 KB |
| **Total (all subsets)** | **~245 KB** |

For comparison, the Latin (Geist) fonts are ~6–30 KB each. The 162 KB Arabic
block is the dominant payload and is preloaded; if needed, a later performance
pass (Task 23) can swap to a lighter Arabic font or subset to fewer weights.

## Verification

- `npm run lint` — pass
- `npm run typecheck` — pass
- `npm test` — 10/10 pass (4 rate-limit + 6 localized) against test DB
- `npm run build` — pass; routes `/fr`, `/ar`, `/en` static
- Manual: `/fr` ltr, `/ar` rtl, `/en` ltr; hero text renders per locale;
  locale switcher lists all 3 languages.

## Notes

- Next.js 16 renamed `middleware.ts` → `proxy.ts`; the plan's code structure
  said `src/middleware.ts`, so the actual file is `src/proxy.ts`. The `/admin`
  auth guard (Task 12) will be added to this same proxy file.
- `next/font/google` downloads fonts at build time (needs network; fine on
  Vercel).
- Site shell uses placeholder branding colors/logo pending the clinic's real
  assets.
- Not committed/pushed (pending the user's go-ahead).
