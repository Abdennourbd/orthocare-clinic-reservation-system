import { getPrisma } from "@/lib/db";
import { CLINIC_IDENTITY } from "./clinicIdentity";

// Clinic identity shown on the self-service token page (minimum disclosure)
// and later on the contact page (Task 10/11). Stored as the `clinicInfo`
// Setting (admin-editable, Task 21); defaults keep the token page usable even
// before the Setting is seeded.

export type ClinicInfo = {
  name: string;
  address: string;
  phone: string;
};

// Single source of truth for the identity values: `CLINIC_IDENTITY`.
export const DEFAULT_CLINIC_INFO: ClinicInfo = { ...CLINIC_IDENTITY };

/** Read the clinic identity, falling back to documented defaults field by
 * field (a partially-filled Setting must not wipe a default). */
export async function readClinicInfo(): Promise<ClinicInfo> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: "clinicInfo" },
  });
  const value = setting?.value;
  if (!value || typeof value !== "object") return DEFAULT_CLINIC_INFO;

  const v = value as Partial<ClinicInfo>;
  const str = (k: keyof ClinicInfo): string =>
    typeof v[k] === "string" && (v[k] as string).trim().length > 0
      ? (v[k] as string).trim()
      : DEFAULT_CLINIC_INFO[k];

  return { name: str("name"), address: str("address"), phone: str("phone") };
}