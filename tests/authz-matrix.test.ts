import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { GET as auditRoute } from "@/app/api/admin/audit/route";

// Task 12 — the authorization matrix (plan.md §Testing strategy):
//   one table-driven test walking EVERY /api/admin/* route ×
//   {anonymous, receptionist, admin, deactivated} and asserting the expected
//   status. Every later task that adds an admin route adds a row here — in an
//   RBAC system this is simultaneously the most likely and most damaging bug,
//   and it is usually introduced by an unrelated later task.

beforeAll(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
});

type ActorKind = "anonymous" | "receptionist" | "admin" | "deactivated";

interface RouteRow {
  method: string;
  path: string;
  /** Roles allowed through (403 for the others). */
  allowed: Role[];
  /** Status an ADMIN should get (200 by default, overridden for query errors). */
  adminStatus?: number;
  handler: (request: NextRequest) => Promise<Response>;
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
  const url = new URL(row.path, "http://localhost:3000");
  return row.handler(new NextRequest(url, { method: row.method, headers }));
}

const ROUTES: RouteRow[] = [
  {
    method: "GET",
    path: "/api/admin/audit",
    allowed: [Role.ADMIN],
    handler: (r) => auditRoute(r),
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
    for (const kind of ["anonymous", "deactivated", "receptionist", "admin"] as ActorKind[]) {
      it(`${row.method} ${row.path} as ${kind}`, async () => {
        const response = await requestAs(kind, row);
        const allowed =
          kind === "admin" ||
          (kind === "receptionist" && row.allowed.includes(Role.RECEPTIONIST));
        const expected = allowed ? EXPECTED[kind].ok : EXPECTED[kind].forbidden;
        expect([response.status, `${row.method} ${row.path} as ${kind}`]).toEqual([
          expected,
          `${row.method} ${row.path} as ${kind}`,
        ]);
      });
    }
  }

  it("matrix covers every exported HTTP method of every admin route file", async () => {
    // Guard against routes/methods being added without a matrix row. This is
    // METHOD-level, not file-level: adding a POST export to an existing
    // route.ts must fail here too. If this fails, add the new
    // (method, path) pair to ROUTES above.
    const { readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const adminDir = path.resolve("src/app/api/admin");
    const entries = await readdir(adminDir, { recursive: true });
    const routeFiles = entries.filter((e) => e.endsWith("route.ts"));
    expect(routeFiles.length).toBeGreaterThan(0);

    const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
    const matrixPairs = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    const missing: string[] = [];

    for (const file of routeFiles) {
      const absolute = path.join(adminDir, file);
      const routeModule = await import(pathToFileURL(absolute).href);
      // src/app/api/admin/audit/route.ts -> /api/admin/audit
      // On Windows, readdir(..., { recursive: true }) returns entries with
      // backslash separators (e.g. "audit\route.ts"), so the backslash-to-
      // slash normalization must run BEFORE stripping the "/route.ts"
      // suffix — otherwise the suffix regex (which expects a leading slash)
      // never matches and the segment is left dangling.
      const routePath = "/api/admin/" + file.replace(/\\/g, "/").replace(/\/route\.ts$/, "");
      for (const method of HTTP_METHODS) {
        if (typeof routeModule[method] === "function") {
          if (!matrixPairs.has(`${method} ${routePath}`)) {
            missing.push(`${method} ${routePath}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("admin root layout pins dir=ltr explicitly (RTL never leaks into the FR dashboard)", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/admin/layout.tsx", "utf8");
    expect(source).toContain('dir="ltr"');
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
