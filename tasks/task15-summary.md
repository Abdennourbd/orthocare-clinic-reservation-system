# Task 15 — Patient Documents (Radiographies)

**Status:** ✅ Complete (5 steps, reviewed by code-reviewer + security-auditor + test-engineer in a loop until clean; verified end-to-end on production)

**Delivery timeline:** Steps 1–2 (schemas + storage adapter) Sept 1–2; Step 3 (upload + list routes) Sept 2 (`4cf3b52`); Step 4 (download + delete routes) Sept 2 (`87763e1`); Step 5 (admin UI) Sept 2 (`fe0c6e1`, polish `07849d0`); manual storage verification + production E2E test Sept 2.

## What was delivered

### Foundation (Steps 1–2)
- **`src/schemas/document.ts`** — `documentUploadSchema` (document name must include the extension; declared MIME type) with FR validation messages.
- **`src/lib/documents/mime.ts`** — `MAX_DOCUMENT_BYTES` (4 Mo) and `validateDocumentBytes`: type → extension → content → size, in that exact order, all must agree (magic-byte sniffing for JPEG/PNG/PDF/DICOM). One flat 415 on any disagreement — never a "best guess" correction.
- **`src/lib/documents/errors.ts`** — typed domain errors (`BlobNotConfiguredError`, `BlobOperationError`, `DocumentTooLargeError`, `DocumentTypeNotAllowedError`) with FR messages that never echo the file name.
- **`src/lib/documents/blobStorage.ts`** — the ONLY module in the repo allowed to import `@vercel/blob`. Exposes `buildBlobKey` / `putDocument` / `getDocumentStream` / `deleteDocument`. Invariants: `access: "private"` on every call (non-negotiable — the SDK's public default would make any leaked URL a permanent leak); token read lazily inside each function (never at module load, so importing routes never throws); blob key is `patients/<patientId>/<uuid>.<ext>`, never derived from the user-supplied file name; failure logs name only the operation and error class — never the SDK message (may echo the pathname), never the token.

### Routes (Step 3 — `4cf3b52`)
- `POST /api/admin/patients/[id]/documents` — multipart upload. Order is load-bearing and pinned by tests: `requireStaff(ADMIN|RECEPTIONIST)` → CSRF strict same-origin → rate limit (`patients-write`, 30/5min) → formData (400) → Zod metadata (400) → 404 patient → 409 anonymized → **size gate from the declared part size BEFORE `arrayBuffer()`** (an oversized upload is rejected without ever being fully buffered in memory) → byte-level validation (415/413) → blob put → DB row → audit `PATIENT_DOCUMENT_UPLOADED` (detail: ids + size only). A rejected upload never leaves an orphan blob: nothing touches storage until every validation has passed.
- `GET /api/admin/patients/[id]/documents` — metadata list (name, mimeType, sizeBytes, uploadedAt, uploadedBy → name only), newest first with `id` tiebreak (millisecond-precision `uploadedAt` must not fall back to arbitrary order), excludes soft-deleted, `total` for future pagination. 409 on anonymized charts (write side mirrors it: an anonymized chart can never receive a fresh document — that would re-attach PHI to a supposedly erased identity).
- `blobKey` never appears in any response, log, or audit detail.

### Routes (Step 4 — `87763e1`)
- `GET /api/admin/documents/[id]` — streams the private blob through the API (staff session re-checked on every request; the browser never receives a storage URL). RFC 5987 `Content-Disposition` carries the original file name in both `filename=` and `filename*=` forms.
- `DELETE /api/admin/documents/[id]` — soft delete (`deletedAt`), DB row first, blob deletion second: if blob deletion fails, the result is an unreachable orphan, never a live leak. Deleting documents of an anonymized patient and deleting/reading a nonexistent id return the **same indistinguishable 404** (no existence oracle on erased charts).

### Admin UI (Step 5 — `fe0c6e1`, polish `07849d0`)
- `src/components/admin/PatientDocuments.tsx` — FR, mounted in the patient detail page behind `!isAnonymized` (the Documents section disappears entirely on erased charts). Upload form (name + file picker with allowed-types/size hint), list with size/date/uploader, download link, two-step destructive delete confirm (`role="alert"` error surface, accessible skeleton markup), success/error banners.

### Tests
- **`tests/integration/patient-documents.test.ts`** — mocks `blobStorage` with an in-memory Map (the real SDK is never exercised in CI — deliberate gap, covered by the manual verification below): happy-path upload → row + audit, every validation failure path, orphan-blob invariant (invalid bytes → no blob written), ordering, soft-delete semantics.
- **`tests/authz-matrix.test.ts`** — new rows for all document routes × {anonymous, receptionist, admin, deactivated}, coverage scan green.

## Review loop (code-reviewer + security-auditor + test-engineer, until clean)

| Round | Findings | Resolution |
|---|---|---|
| Step 3 review | Missing `anonymizedAt` guard on upload/list — an erased chart could receive new documents | Fix: 409 `PATIENT_ANONYMIZED` on both verbs (`4cf3b52` final state) |
| Step 4 review | Existence oracle: anonymized patients' documents distinguishable via 404 vs other errors | Fix: one indistinguishable 404 for both cases (`87763e1`) |
| Step 5 review | Test-engineer gaps + 3 minors (route comment, `role="alert"`, skeleton `<li>` markup) | Test fixes + polish commit `07849d0` |
| Final whole-branch review | **APPROVE — merge-ready**, no Critical/Important; 15 minors triaged | All deferred (recorded below) |

## Storage verification (2026-09-02, real Vercel Blob)
- Private store **`orthocare-radiographies`** created via CLI (`--access private`), connected to the project; token + `BLOB_STORE_ID` wired into `.env` (see `.env.example` quick start — note: `vercel env pull` cannot decrypt "Sensitive" vars, it writes a `[SENSITIVE]` placeholder).
- **Unauthenticated `GET` of a private blob → HTTP 403.** Authenticated fetch → 200 with the exact bytes. This is the proof the tests cannot give: `access: "private"` is real.

## Production E2E (2026-09-02, browser, admin account)
Upload 2 PNGs → both `201`, list shows name/size/date/uploader → download returns 200, `image/png`, correct attachment filename, byte-identical → delete (inline confirm) → list updates, deleted id → 404. Patient record left clean.

**Incident & root cause:** first production attempts returned **503 BLOB_NOT_CONFIGURED**. The route is the one returning it — Vercel **freezes env vars at build time**, and the blob token was connected to the project *after* the live deployment was built. Fixed by `vercel redeploy` (no code change). Ops lesson: any new env var requires a redeploy to take effect.

## Verification (2026-09-02)
```
npm test          → 645/645 green (56 files), 0 failures
npm run typecheck → OK
npm run lint      → OK
```
CI red on `npm audit` (mysql2 via prisma 7.9.1) is pre-existing — do not `audit fix --force`.

## Decisions / rulings
1. **No `blobDeletedAt` column** — soft delete uses `deletedAt`; blob cleanliness is audited by `blobDeleted: false` instead of a new column (no migration).
2. **Worked directly on `main`** (single-developer repo, task history is linear).
3. **Upload/list roles `["ADMIN","RECEPTIONIST"]`** — explicit per-route role list, never a bare `requireStaff`, so a role added later fails closed (same convention as sibling routes).
4. **Anonymized-patient documents → indistinguishable 404** on by-id GET/DELETE (not 409) — no existence oracle on erased charts. Upload/list keep 409 (the caller already sees the chart).
5. **`src/lib/privacy/anonymize.ts` untouched** (frozen module from task 13).
6. **List read budget** shares the `patients-read` pool (60/5min) — listing documents is a patient read like any other.

## Deferred (non-blocking, recorded)
- List pagination (`total` already returned for it).
- Orphan-blob cleanup sweep (deleted rows whose blob delete failed) — a periodic job scanning `blobDeleted: false`.
- Double-delete race: two concurrent DELETEs can both pass the pre-check (state stays consistent; one blob delete no-ops). `updateMany`-style hardening available if ever needed.
- No `Content-Length` on the download response (streaming).
- List-view audit would need a new audit enum — skipped to keep the enum frozen.
- Multipart `formData()` buffers in memory — bounded in practice by Vercel's ~4.5 MB request cap, below our 4 Mo gate.
- 5 UI/a11y polish minors from the final review (skeleton semantics, confirm focus, etc.).
- **No edit/rename for documents** — out of Task 15 scope (upload/list/download/delete only); new feature if wanted.
