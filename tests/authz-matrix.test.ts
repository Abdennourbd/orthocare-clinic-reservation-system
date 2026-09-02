import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { requireStaff } from "@/lib/auth/guard";
import { ok, errorResponse } from "@/lib/api/http";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import {
  GET as patientsListRoute,
  POST as patientsCreateRoute,
} from "@/app/api/admin/patients/route";
import {
  GET as patientRecordRoute,
  PATCH as patientPatchRoute,
} from "@/app/api/admin/patients/[id]/route";
import { GET as patientHistoryRoute } from "@/app/api/admin/patients/[id]/history/route";
import { POST as patientVisitsRoute } from "@/app/api/admin/patients/[id]/visits/route";
import { POST as patientAnonymizeRoute } from "@/app/api/admin/patients/[id]/anonymize/route";
import {
  GET as patientDocumentsRoute,
  POST as patientDocumentsCreateRoute,
} from "@/app/api/admin/patients/[id]/documents/route";
import {
  GET as documentDownloadRoute,
  DELETE as documentDeleteRoute,
} from "@/app/api/admin/documents/[id]/route";
import {
  GET as appointmentsListRoute,
  POST as appointmentsCreateRoute,
} from "@/app/api/admin/appointments/route";
import {
  GET as appointmentRecordRoute,
  PATCH as appointmentPatchRoute,
} from "@/app/api/admin/appointments/[id]/route";
import { POST as appointmentRescheduleRoute } from "@/app/api/admin/appointments/[id]/reschedule/route";
import { GET as appointmentsPendingRoute } from "@/app/api/admin/appointments/pending/route";
import { GET as appointmentsSearchRoute } from "@/app/api/admin/appointments/search/route";
import { POST as smsSingleRoute } from "@/app/api/admin/sms/single/route";
import { GET as smsHistoryRoute } from "@/app/api/admin/sms/route";
import { GET as smsBatchesRoute } from "@/app/api/admin/sms/batches/route";
import { POST as smsBroadcastPreviewRoute } from "@/app/api/admin/sms/broadcast/preview/route";
import { POST as smsBroadcastRoute } from "@/app/api/admin/sms/broadcast/route";

// Task 12 — the authorization matrix (plan.md §Testing strategy):
//   one table-driven test walking EVERY /api/admin/* route ×
//   {anonymous, receptionist, admin, deactivated} and asserting the expected
//   status. Every later task that adds an admin route adds a row here — in an
//   RBAC system this is simultaneously the most likely and most damaging bug,
//   and it is usually introduced by an unrelated later task.
//
// Task 13 step 2 — this file is the ONLY automatic safety net against
// unauthorized access to patient data. Whoever edits this file next: it is
// forbidden to (a) narrow the route-file scan filter below, (b) remove a
// method from HTTP_METHODS, (c) weaken or remove
// `expect(missing).toEqual([])`, or (d) touch tests/setup.ts. Only WIDENING
// the detection (more extensions, more methods) is allowed — see the
// route.tsx/.js/.jsx and OPTIONS additions below, both deliberate widenings,
// never narrowings.
//
// Task 13 step 2, tour 2 — also forbidden: (e) setting `okStatus` to 401 or
// 403, which collapses an "authorized" row onto the "forbidden" row and
// makes it prove nothing (see AuthorizedOkStatus and the runtime invariant
// test below — both exist specifically to catch this).
//
// Task 13 step 2, tour 3 — also forbidden: (f) shrinking the actor list a
// row/test is run against. The coverage loop below iterates
// `Object.keys(EXPECTED) as ActorKind[]`, never a hand-written array literal
// — removing an actor from `EXPECTED` (a `Record<ActorKind, …>`) fails
// `npm run typecheck`, and removing it from `ActorKind` itself breaks every
// `kind === "..."` comparison. Do not reintroduce a literal actor array here.
// Also forbidden: (g) a `RouteRow.handler` that is not provably the function
// the route file actually exports for that method — see the
// `row.handler !== routeModule[method]` check in the coverage test below. A
// row can satisfy scanPath coverage while silently running a different
// route's handler (e.g. a copy-pasted row whose `handler:` was never
// updated); that check exists specifically to catch that.

beforeAll(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

type ActorKind = "anonymous" | "receptionist" | "admin" | "deactivated";

/**
 * Task 13 step 2, tour 2 (MAJEUR-1) — the closed set of statuses an
 * AUTHORIZED actor may legitimately receive from `RouteRow.okStatus`,
 * deliberately excluding 401 and 403 (see the comment on `okStatus` below).
 * Add a concrete status here when a future step needs one; never replace
 * this union with `number`.
 */
type AuthorizedOkStatus = 200 | 201 | 204 | 400 | 404 | 409 | 422;

interface RouteRow {
  method: string;
  /**
   * The literal path as produced by the filesystem scan below (e.g.
   * `/api/admin/patients/[id]`). This is the key compared against
   * `matrixPairs` in the coverage test — it is NOT necessarily a requestable
   * URL for dynamic routes.
   */
  scanPath: string;
  /**
   * The URL actually requested (e.g. `/api/admin/patients/does-not-exist`).
   * Defaults to `scanPath` for static routes, where the two coincide.
   */
  requestPath?: string;
  /** Route params for dynamic routes (Next 16 passes `params` as a Promise). */
  params?: Record<string, string>;
  /** Roles allowed through (403 for the others). */
  allowed: Role[];
  /**
   * Status an authorized actor should get (200 by default). Overridden when
   * the guard passes but a later step legitimately 4xx's (query validation,
   * missing body, id not found) — this still proves the guard runs first.
   *
   * Task 13 step 2, tour 2 (MAJEUR-1, ortho-security) — this is restricted to
   * `AuthorizedOkStatus`, NOT `number`. 401 and 403 are exactly the two
   * statuses `EXPECTED[kind].forbidden` can produce (see EXPECTED below). If
   * `okStatus` could hold either value, an `allowed:[ADMIN]` row with
   * `okStatus: 403` would make EVERY cell of that row green — admin "passes"
   * by being refused same as everyone else — and the row would silently stop
   * proving anything about that route's authorization. Do not widen this
   * union to `number` to make a new value fit; add the concrete status here
   * instead. The runtime invariant test below (`okStatus may never equal a
   * forbidden-branch status`) is the second, unbypassable layer — it is what
   * catches an `as any`/`as AuthorizedOkStatus` cast around this type.
   */
  okStatus?: AuthorizedOkStatus;
  handler: (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ) => Promise<Response>;
}

async function makeUser(kind: ActorKind): Promise<{ id: string; role: Role; tokenVersion: number; active: boolean } | null> {
  const prisma = getPrisma();
  if (kind === "anonymous") return null;
  const user = await prisma.user.create({
    data: {
      name: kind,
      email: `matrix-${kind}-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role: kind === "admin" ? Role.ADMIN : Role.RECEPTIONIST,
      active: kind !== "deactivated",
    },
  });
  return { id: user.id, role: user.role, tokenVersion: 0, active: user.active };
}

async function requestAs(kind: ActorKind, row: RouteRow): Promise<Response> {
  const user = await makeUser(kind);
  const headers: Record<string, string> = {};
  if (user) {
    const token = await createSessionToken({
      userId: user.id,
      role: user.role as "ADMIN" | "RECEPTIONIST",
      tokenVersion: user.tokenVersion,
    });
    headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  }
  const url = new URL(row.requestPath ?? row.scanPath, "http://localhost:3000");
  return row.handler(new NextRequest(url, { method: row.method, headers }), {
    params: Promise.resolve(row.params ?? {}),
  });
}

const ROUTES: RouteRow[] = [
  {
    method: "GET",
    scanPath: "/api/admin/audit",
    allowed: [Role.ADMIN],
    // Not dynamic — the handler ignores the second (context) argument, and
    // its behavior must stay byte-for-byte identical to before this step.
    //
    // Task 13 step 2, tour 3 (MAJEUR-1) — the exported function itself, NOT
    // an arrow-wrapped `(r) => auditRoute(r)`. TypeScript accepts this
    // directly (a 1-parameter function is assignable to the 2-parameter
    // RouteRow.handler type), and using the export as-is is what lets the
    // coverage test below assert `row.handler === routeModule[method]` — a
    // wrapper closure would never be `===` the module's export, so this row
    // would fail that assertion even though it is correct. Every future row
    // must reference its route module's export the same way, never a
    // wrapper.
    handler: auditRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/patients",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    handler: patientsListRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/patients",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — an authorized actor's request fails Zod
    // validation (empty body), proving the guard runs BEFORE parsing, not
    // that the route is otherwise broken.
    okStatus: 400,
    handler: patientsCreateRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/patients/[id]",
    requestPath: "/api/admin/patients/does-not-exist",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // An authorized actor requesting an unknown id gets 404 — proves the
    // guard runs before the DB lookup, not that the route is broken.
    okStatus: 404,
    handler: patientRecordRoute,
  },
  {
    method: "PATCH",
    scanPath: "/api/admin/patients/[id]",
    requestPath: "/api/admin/patients/does-not-exist",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — Zod fails after the guard, same reasoning
    // as POST /api/admin/patients.
    okStatus: 400,
    handler: patientPatchRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/patients/[id]/history",
    requestPath: "/api/admin/patients/does-not-exist/history",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    okStatus: 404,
    handler: patientHistoryRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/patients/[id]/visits",
    requestPath: "/api/admin/patients/does-not-exist/visits",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    okStatus: 400,
    handler: patientVisitsRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/patients/[id]/anonymize",
    requestPath: "/api/admin/patients/does-not-exist/anonymize",
    params: { id: "does-not-exist" },
    // task-13.md étape 6 spec — ADMIN only, the receptionist must get 403.
    allowed: [Role.ADMIN],
    // requestAs() sends no body — Zod fails after the guard, same reasoning
    // as POST /api/admin/patients.
    okStatus: 400,
    handler: patientAnonymizeRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/patients/[id]/documents",
    requestPath: "/api/admin/patients/does-not-exist/documents",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // An authorized actor requesting an unknown id gets 404 — proves the
    // guard runs before the DB lookup, not that the route is broken.
    okStatus: 404,
    handler: patientDocumentsRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/patients/[id]/documents",
    requestPath: "/api/admin/patients/does-not-exist/documents",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — formData parsing fails after the guard
    // (400), before any patient lookup.
    okStatus: 400,
    handler: patientDocumentsCreateRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/documents/[id]",
    requestPath: "/api/admin/documents/does-not-exist",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // Task 15 step 4 — an authorized actor requesting an unknown/deleted
    // document id gets the indistinguishable 404 (proves the guard runs
    // before the DB lookup, not that the route is broken).
    okStatus: 404,
    handler: documentDownloadRoute,
  },
  {
    method: "DELETE",
    scanPath: "/api/admin/documents/[id]",
    requestPath: "/api/admin/documents/does-not-exist",
    params: { id: "does-not-exist" },
    // Task 15 step 4 — ADMIN only: the receptionist must get 403 on DELETE.
    allowed: [Role.ADMIN],
    okStatus: 404,
    handler: documentDeleteRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/appointments",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // No query — the route defaults `date` to today's clinic-local date, so
    // an authorized actor gets 200 with the (empty) day view. Proves the
    // guard runs before the read.
    handler: appointmentsListRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/appointments",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — Zod fails after the guard (same reasoning
    // as POST /api/admin/patients). No Origin header passes
    // assertSameOriginStrict (non-browser request), so the 400 comes from
    // Zod, never the CSRF branch.
    okStatus: 400,
    handler: appointmentsCreateRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/appointments/[id]",
    requestPath: "/api/admin/appointments/does-not-exist",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    okStatus: 404,
    handler: appointmentRecordRoute,
  },
  {
    method: "PATCH",
    scanPath: "/api/admin/appointments/[id]",
    requestPath: "/api/admin/appointments/does-not-exist",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — Zod fails after the guard, before any DB
    // lookup of the id.
    okStatus: 400,
    handler: appointmentPatchRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/appointments/[id]/reschedule",
    requestPath: "/api/admin/appointments/does-not-exist/reschedule",
    params: { id: "does-not-exist" },
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    okStatus: 400,
    handler: appointmentRescheduleRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/appointments/pending",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    handler: appointmentsPendingRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/appointments/search",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // No `q` in the query — Zod fails after the guard (q is required).
    okStatus: 400,
    handler: appointmentsSearchRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/sms/single",
    // Task 16 — the front desk (both roles) sends manual SMS.
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // requestAs() sends no body — Zod fails after the guard, before any
    // patient lookup.
    okStatus: 400,
    handler: smsSingleRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/sms/broadcast/preview",
    // Task 16 — only ADMIN sees the broadcast audience / triggers the send.
    allowed: [Role.ADMIN],
    okStatus: 400,
    handler: smsBroadcastPreviewRoute,
  },
  {
    method: "POST",
    scanPath: "/api/admin/sms/broadcast",
    allowed: [Role.ADMIN],
    okStatus: 400,
    handler: smsBroadcastRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/sms",
    // Task 16 — the front desk (both roles) reads the SMS history.
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // No query — every filter is optional, so an authorized actor gets 200
    // with the (empty) first history page. Proves the guard runs before the
    // read.
    handler: smsHistoryRoute,
  },
  {
    method: "GET",
    scanPath: "/api/admin/sms/batches",
    allowed: [Role.ADMIN, Role.RECEPTIONIST],
    // No query — optional limit only, so an authorized actor gets 200 with
    // the (empty) batch list.
    handler: smsBatchesRoute,
  },
];

const EXPECTED: Record<ActorKind, { ok: number; forbidden: number }> = {
  anonymous: { ok: 200, forbidden: 401 },
  deactivated: { ok: 200, forbidden: 401 },
  receptionist: { ok: 200, forbidden: 403 },
  admin: { ok: 200, forbidden: 403 },
};

describe("Authorization matrix — every /api/admin/* route × every actor", () => {
  for (const row of ROUTES) {
    // Task 13 step 2, tour 3 (MAJEUR-2, ortho-security) — iterate the keys of
    // EXPECTED (a Record<ActorKind, …>), never a hand-written literal array.
    // A literal array can be silently shortened by one diff line, switching
    // off that actor's whole column on every row with nothing to catch it.
    // Dropping a key from EXPECTED fails `npm run typecheck`; dropping the
    // member from ActorKind itself breaks the `kind === "..."` comparisons
    // below — the guarantee is compile-time, not a convention.
    for (const kind of Object.keys(EXPECTED) as ActorKind[]) {
      const label = `${row.method} ${row.requestPath ?? row.scanPath} as ${kind}`;
      it(label, async () => {
        const response = await requestAs(kind, row);
        const allowed =
          kind === "admin" ||
          (kind === "receptionist" && row.allowed.includes(Role.RECEPTIONIST));
        const expected = allowed ? (row.okStatus ?? EXPECTED[kind].ok) : EXPECTED[kind].forbidden;
        expect([response.status, label]).toEqual([expected, label]);
      });
    }
  }

  it("matrix covers every exported HTTP method of every admin route file", async () => {
    // Guard against routes/methods being added without a matrix row. This is
    // METHOD-level, not file-level: adding a POST export to an existing
    // route.ts must fail here too. If `missing` fails, add the new
    // (method, scanPath) pair to ROUTES above. If `mismatched` fails, the
    // row's `handler` points at the wrong route's exported function — fix
    // `handler:` to reference this file's own export (see MAJEUR-1 comments
    // below).
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const adminDir = path.resolve("src/app/api/admin");
    const entries = await readdir(adminDir, { recursive: true });
    // Widened (never narrowed — see header comment) to also catch
    // route.tsx/.js/.jsx: `pageExtensions` is not restricted in
    // next.config.ts, so a route.tsx would be a real, Next-served admin
    // route that this guard would otherwise never see. Anchored on the path
    // separator (not a bare endsWith) so "myroute.ts" cannot false-match.
    const routeFiles = entries.filter((e) => /(^|[\\/])route\.(ts|tsx|js|jsx)$/.test(e));
    expect(routeFiles.length).toBeGreaterThan(0);

    // Widened (never narrowed) to include OPTIONS, previously missing.
    const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
    // Task 13 step 2, tour 3 (MAJEUR-1, ortho-security) — a Map keyed by
    // "method scanPath" pointing at the actual ROUTES row, not just a Set of
    // strings. `matrixPairs.has(...)` alone only proves a row with the right
    // (method, scanPath) LABEL exists; it says nothing about whether that
    // row's `handler` is really the function this file exports for that
    // method. See the `row.handler !== routeModule[method]` check below.
    const routeByPair = new Map(ROUTES.map((r) => [`${r.method} ${r.scanPath}`, r]));
    const missing: string[] = [];
    const mismatched: string[] = [];

    for (const file of routeFiles) {
      const absolute = path.join(adminDir, file);
      const routeModule = await import(pathToFileURL(absolute).href);
      // src/app/api/admin/audit/route.ts -> /api/admin/audit
      // On Windows, readdir(..., { recursive: true }) returns entries with
      // backslash separators (e.g. "audit\route.ts"), so the backslash-to-
      // slash normalization must run BEFORE stripping the "/route.(ts|tsx|js|jsx)"
      // suffix — otherwise the suffix regex (which expects a leading slash)
      // never matches and the segment is left dangling.
      const routePath =
        "/api/admin/" + file.replace(/\\/g, "/").replace(/\/route\.(ts|tsx|js|jsx)$/, "");
      for (const method of HTTP_METHODS) {
        if (typeof routeModule[method] === "function") {
          const pair = `${method} ${routePath}`;
          const row = routeByPair.get(pair);
          if (!row) {
            missing.push(pair);
            continue;
          }
          // Task 13 step 2, tour 3 (MAJEUR-1) — the row exists for this
          // (method, scanPath), but does its `handler` actually run THIS
          // file's exported function, or a copy-pasted handler from a
          // different route? A row that satisfies the label check above
          // while running e.g. the `audit` handler on a patients-only row
          // would still produce 401/401/403/200 for an ADMIN-only row —
          // exactly what the matrix loop expects — and the row would go
          // green having never executed the real route at all. Route
          // modules must export their handler function directly (see the
          // comment on the `audit` row's `handler: auditRoute` above) for
          // this `===` comparison to mean anything.
          if (row.handler !== routeModule[method]) {
            mismatched.push(
              `${pair} — this row's handler is not the ${method} exported by ` +
                `${file}; it is testing a different route than the one it ` +
                `claims to cover (e.g. a copy-pasted row whose handler: was ` +
                `never updated to the real route's export)`,
            );
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it("admin root layout pins dir=ltr explicitly (RTL never leaks into the FR dashboard)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/admin/layout.tsx", "utf8");
    expect(source).toContain('dir="ltr"');
  });

  // Task 13 step 2, tour 2 (MAJEUR-1, ortho-security) — the runtime half of
  // the okStatus protection. AuthorizedOkStatus (the type) stops a literal
  // `okStatus: 403` at compile time, but does nothing against `okStatus: 403
  // as AuthorizedOkStatus` or `as any` — a shortcut a future agent racing to
  // make a red row go green might reach for. This test makes that shortcut
  // fail anyway, with a message that explains why it is forbidden rather than
  // just that it is. It sweeps every row actually registered in ROUTES, so it
  // grows automatically as steps 4-8 add rows.
  it("invariant: no ROUTES row's okStatus equals a forbidden-branch status (401 or 403)", () => {
    const forbiddenBranchStatuses = new Set([401, 403]);
    const offenders = ROUTES.filter(
      (r) => r.okStatus !== undefined && forbiddenBranchStatuses.has(r.okStatus),
    ).map((r) => `${r.method} ${r.scanPath} (okStatus: ${r.okStatus})`);
    expect(
      offenders,
      "okStatus must never be 401 or 403 — those are the only two statuses the " +
        "forbidden branch of the matrix ternary can produce. Setting okStatus to " +
        "one of them makes an authorized actor's expected status collide with an " +
        "unauthorized actor's expected status, so the row passes whether or not " +
        "the route actually checks the role — it stops proving anything. Fix the " +
        "route (or the row's real okStatus), do not silence this check.",
    ).toEqual([]);
  });
});

// Task 13 step 2 — harness non-regression: the two-argument handler
// signature and the scanPath/requestPath split must not change the observed
// behavior of the one static route that existed before this step.
describe("harness non-regression — GET /api/admin/audit is unaffected by the dynamic-route changes", () => {
  const auditRow = ROUTES.find((r) => r.scanPath === "/api/admin/audit")!;

  it("anonymous -> 401, receptionist -> 403, admin -> 200, same as before this step", async () => {
    expect((await requestAs("anonymous", auditRow)).status).toBe(401);
    expect((await requestAs("receptionist", auditRow)).status).toBe(403);
    expect((await requestAs("admin", auditRow)).status).toBe(200);
  });
});

// Task 13 step 2 — anti-IDOR / non-disclosure proof for dynamic routes.
// This handler is FICTITIOUS, defined only in this test file: it stands in
// for the shape a future /api/admin/patients/[id] handler will take
// (params is a Promise, per Next 16), so the harness's dynamic-route support
// can be proven before any real dynamic route exists. It is deliberately not
// added to ROUTES — it is not a real file the coverage scan would find.
async function fakeDynamicPatientRoute(
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  const guard = await requireStaff(request, { roles: ["ADMIN", "RECEPTIONIST"] });
  if (!guard.ok) return guard.response;
  // A real handler would look the patient up here. The point of the test
  // below is that an anonymous caller never reaches this line.
  const { id } = await context.params;
  return ok({ id });
}

describe("anti-IDOR — dynamic route rejects anonymous callers before any DB read", () => {
  it("401s on an arbitrary params.id, with no leak of the id or of existence", async () => {
    const arbitraryId = "cljxyz-arbitrary-patient-id-does-not-exist";
    const url = new URL(`/api/admin/patients/${arbitraryId}`, "http://localhost:3000");
    const response = await fakeDynamicPatientRoute(new NextRequest(url, { method: "GET" }), {
      params: Promise.resolve({ id: arbitraryId }),
    });
    expect(response.status).toBe(401);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(arbitraryId);
    expect(JSON.parse(bodyText)).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Session invalide ou expirée." },
    });
  });
});

// Task 13 step 2 — okStatus must never leak past the guard. okStatus lets an
// AUTHORIZED actor legitimately get a non-200 (e.g. 404 when a future
// /api/admin/patients/[id] can't find the id, or 400 on a missing body).
// The risk this row exists to disprove: if the ternary in the matrix loop
// (`allowed ? (row.okStatus ?? ...) : EXPECTED[kind].forbidden`) were ever
// inverted or short-circuited, an UNAUTHORIZED caller could receive that same
// 404 instead of 401/403 — which leaks "this id exists" to someone who was
// never let in. This row is FICTITIOUS (not in ROUTES, invisible to the
// coverage scan) and reuses requireStaff, exercised directly via requestAs()
// exactly as a real matrix row would be.
describe("okStatus never overrides the forbidden branch for an unauthorized actor", () => {
  const okStatusProbe: RouteRow = {
    method: "GET",
    scanPath: "/api/admin/__fictitious-ok-status-probe",
    allowed: [Role.ADMIN],
    okStatus: 404, // simulates "authorized admin, resource not found"
    handler: async (request) => {
      const guard = await requireStaff(request, { roles: ["ADMIN"] });
      if (!guard.ok) return guard.response;
      return errorResponse(404, "NOT_FOUND", "Ressource introuvable.");
    },
  };

  it("admin (allowed) gets okStatus 404, but anonymous/receptionist never see 404 — only 401/403", async () => {
    expect((await requestAs("admin", okStatusProbe)).status).toBe(404);
    expect((await requestAs("anonymous", okStatusProbe)).status).toBe(401);
    expect((await requestAs("receptionist", okStatusProbe)).status).toBe(403);
    expect((await requestAs("deactivated", okStatusProbe)).status).toBe(401);
  });
});

// Task 13 step 2, tour 2 (MAJEUR-2, ortho-security + ortho-reviewer) — the
// two other Task 13 step 2 tests that exercise a dynamic-route shape each
// take a shortcut around one part of the chain the step was actually meant to
// deliver:
//   - the anti-IDOR test above calls fakeDynamicPatientRoute() directly,
//     bypassing requestAs() entirely;
//   - the okStatus test's row has a scanPath with no brackets and the default
//     (empty) params.
// Neither one proves that requestAs() correctly substitutes requestPath for a
// bracketed scanPath, or correctly threads a non-empty params map through to
// the handler's `context.params` Promise — which is the actual new plumbing
// this step added to RouteRow/requestAs(). This row is FICTITIOUS (not in
// ROUTES, invisible to the coverage scan) and is requested exclusively
// through requestAs(), exactly like a real matrix row would be.
async function fakeDynamicIdEchoRoute(
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
): Promise<Response> {
  const guard = await requireStaff(request, { roles: ["ADMIN"] });
  if (!guard.ok) return guard.response;
  const params = await context.params;
  return ok({ requestedPathname: new URL(request.url).pathname, params });
}

describe("requestAs() end-to-end: bracketed scanPath + substituted requestPath + non-empty params", () => {
  const echoProbe: RouteRow = {
    method: "GET",
    scanPath: "/api/admin/__fictitious/[id]",
    requestPath: "/api/admin/__fictitious/abc123",
    params: { id: "abc123" },
    allowed: [Role.ADMIN],
    handler: fakeDynamicIdEchoRoute,
  };

  it("requests requestPath (not the literal [id] scanPath) and delivers params to the handler's context.params", async () => {
    const response = await requestAs("admin", echoProbe);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { requestedPathname: string; params: Record<string, string> };
    // Proves requestAs() built the request against requestPath, never the
    // bracketed scanPath literal (which is not a requestable URL).
    expect(body.requestedPathname).toBe("/api/admin/__fictitious/abc123");
    // Proves params was threaded through to `context.params` (a Promise, per
    // Next 16) untouched.
    expect(body.params).toEqual({ id: "abc123" });
  });
});

describe("GET /api/admin/audit", () => {
  async function adminRequest(params = "") {
    const user = await makeUser("admin");
    const token = await createSessionToken({
      userId: user!.id,
      role: "ADMIN",
      tokenVersion: 0,
    });
    return {
      response: await auditRoute(
        new NextRequest(`http://localhost:3000/api/admin/audit${params}`, {
          headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
        }),
      ),
      userId: user!.id,
    };
  }

  it("returns audit entries newest-first", async () => {
    await getPrisma().auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.APPOINTMENT_AUTO_CANCELLED,
        entityType: "Appointment",
        entityId: "a1",
        detail: {},
      },
    });
    await getPrisma().auditLog.create({
      data: {
        actorType: AuditActorType.STAFF,
        action: AuditAction.LOGIN_SUCCESS,
        entityType: "User",
        entityId: "u1",
        detail: {},
      },
    });

    const { response } = await adminRequest();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: Array<{ action: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].action).toBe("LOGIN_SUCCESS");
  });

  it("filters by action and entityType", async () => {
    await getPrisma().auditLog.create({
      data: {
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.APPOINTMENT_AUTO_CANCELLED,
        entityType: "Appointment",
        entityId: "a1",
        detail: {},
      },
    });
    const { response } = await adminRequest("?action=APPOINTMENT_AUTO_CANCELLED&entityType=Appointment");
    const body = (await response.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it("audits the read itself (AUDIT_VIEWED, actor STAFF)", async () => {
    const { userId } = await adminRequest();
    const viewed = await getPrisma().auditLog.findFirst({
      where: { action: AuditAction.AUDIT_VIEWED },
      orderBy: { createdAt: "desc" },
    });
    expect(viewed?.actorType).toBe(AuditActorType.STAFF);
    expect(viewed?.userId).toBe(userId);
  });

  it("paginates with limit/take and never exposes more than asked", async () => {
    for (let i = 0; i < 5; i++) {
      await getPrisma().auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: AuditAction.APPOINTMENT_AUTO_CANCELLED,
          entityType: "Appointment",
          entityId: `a${i}`,
          detail: {},
        },
      });
    }
    const { response } = await adminRequest("?limit=2&page=1");
    const body = (await response.json()) as { entries: unknown[]; total: number };
    expect(body.entries).toHaveLength(2);
    expect(body.total).toBe(5);
  });
});
