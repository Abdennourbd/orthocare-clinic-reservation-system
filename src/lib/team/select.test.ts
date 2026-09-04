import { describe, expect, it } from "vitest";
import { teamRowSelect } from "./select";

describe("teamRowSelect", () => {
  it("exposes exactly the safe allowlist (never passwordHash)", () => {
    expect(Object.keys(teamRowSelect).sort()).toEqual(
      [
        "active",
        "createdAt",
        "email",
        "id",
        "lastLoginAt",
        "mustChangePassword",
        "name",
        "role",
      ].sort(),
    );
    expect("passwordHash" in teamRowSelect).toBe(false);
    expect("failedLoginCount" in teamRowSelect).toBe(false);
    expect("lockedUntil" in teamRowSelect).toBe(false);
  });
});
