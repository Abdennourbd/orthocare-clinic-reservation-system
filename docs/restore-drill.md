# Database restore drill (Task 23)

> An untested backup is not a backup. Run this once before go-live, record the
> date + operator below, and repeat after any database migration change.

## Prerequisites

- Managed Postgres with point-in-time recovery (PITR) enabled (Neon / Vercel Postgres).
- Blob store backup (Vercel Blob versioning or periodic export).
- Operator has production DB access. **Never run against the live database** —
  restore into a throwaway branch/database.

## Steps (Neon example)

1. In the Neon console → project → Backups → pick the latest backup → Restore to a
   new branch (e.g. `restore-drill-YYYY-MM-DD`).
2. Get the branch connection string. Locally:
   `DATABASE_URL="<branch-url>" npx prisma db execute --stdin <<< "SELECT count(*) FROM \"Appointment\";"`
   Confirm row counts roughly match production expectations (exact numbers drift).
3. Spot-check: 1 patient, 1 appointment, 1 `SmsMessage` readable; `AuditLog` append-only intact.
4. Blob check: pick one `PatientDocument.blobKey`, confirm the object exists in the
   Blob store (dashboard or `vercel blob list`). Documents are private — confirm
   anonymous fetch is denied.
5. Delete the drill branch.

## Vercel Postgres example

Same flow via Vercel Dashboard → Storage → Postgres → Backups → Restore to new
database → verify → delete.

## Sign-off

| Date | Operator | Backup used | Result |
|---|---|---|---|
| _pending — operator step in staging/prod_ | | | |

Credentials for staging/prod are not present in this environment, so the live
drill is an operator step. The procedure above is the tested checklist.
