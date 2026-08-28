import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  ARGON2_OPTIONS,
  DUMMY_HASH,
} from "./password";

// Task 12 — password handling (plan.md §Auth/RBAC):
//   argon2id hashing, minimum 12 characters, blocked against a
//   common-password list.

describe("ARGON2_OPTIONS / DUMMY_HASH", () => {
  it("DUMMY_HASH shares the exact cost parameters of hashPassword (timing equalization must not drift)", () => {
    // DUMMY_HASH format: $argon2id$v=19$m=<memory>,p=<parallelism>,t=<time>$...
    expect(DUMMY_HASH.startsWith("$argon2id$")).toBe(true);
    const params = DUMMY_HASH.split("$")[3]; // "m=65536,p=4,t=3"
    const memory = Number(params.match(/m=(\d+)/)![1]);
    const parallelism = Number(params.match(/p=(\d+)/)![1]);
    const time = Number(params.match(/t=(\d+)/)![1]);
    expect(memory).toBe(ARGON2_OPTIONS.memoryCost);
    expect(parallelism).toBe(ARGON2_OPTIONS.parallelism);
    expect(time).toBe(ARGON2_OPTIONS.timeCost);
  });

  it("DUMMY_HASH is a verifiable argon2id hash", async () => {
    expect(await verifyPassword(DUMMY_HASH, "anything")).toBe(false);
  });
});

describe("validatePasswordPolicy", () => {
  it("accepts a strong 12+ character password", () => {
    expect(validatePasswordPolicy("correct horse battery").ok).toBe(true);
  });

  it("rejects passwords shorter than 12 characters", () => {
    const result = validatePasswordPolicy("Sh0rt!pass");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/12/);
  });

  it("rejects common passwords even when long enough", () => {
    const result = validatePasswordPolicy("123456789012");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/courant/i);
  });

  it("rejects a common password with trivial mutations", () => {
    expect(validatePasswordPolicy("password123456").ok).toBe(false);
    expect(validatePasswordPolicy("Password123456").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validatePasswordPolicy("").ok).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("produces a verifiable argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
  });

  it("does not verify the wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword(hash, "wrong password!")).toBe(false);
  });

  it("produces a different hash each time (unique salt)", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
  });
});
