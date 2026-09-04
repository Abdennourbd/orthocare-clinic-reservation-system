import { describe, expect, it } from "vitest";
import { getPrisma } from "@/lib/db";
import { CLINIC_IDENTITY } from "./clinicIdentity";
import { DEFAULT_CLINIC_INFO, readClinicInfo } from "./clinicInfo";

describe("readClinicInfo", () => {
  it("returns the static identity when the Setting is missing", async () => {
    expect(await readClinicInfo()).toEqual(DEFAULT_CLINIC_INFO);
    expect(DEFAULT_CLINIC_INFO).toEqual({ ...CLINIC_IDENTITY });
  });

  it("merges partial Settings field-wise (never wipes a default)", async () => {
    await getPrisma().setting.create({
      data: { key: "clinicInfo", value: { phone: "+213 1 23 45 67" } },
    });
    expect(await readClinicInfo()).toEqual({
      ...DEFAULT_CLINIC_INFO,
      phone: "+213 1 23 45 67",
    });
  });

  it("ignores empty strings and wrong types", async () => {
    await getPrisma().setting.create({
      data: { key: "clinicInfo", value: { name: "  ", address: 42 } },
    });
    expect(await readClinicInfo()).toEqual(DEFAULT_CLINIC_INFO);
  });

  it("falls back on non-object values", async () => {
    await getPrisma().setting.create({
      data: { key: "clinicInfo", value: "oops" },
    });
    expect(await readClinicInfo()).toEqual(DEFAULT_CLINIC_INFO);
  });
});
