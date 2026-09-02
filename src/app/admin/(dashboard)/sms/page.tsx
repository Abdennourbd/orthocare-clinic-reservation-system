import { redirect } from "next/navigation";
import SmsCenter from "@/components/admin/SmsCenter";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 16 — SMS Center page. Both roles reach it: single sends are
// receptionist-allowed, so unlike audit/page.tsx there is no ADMIN-only
// redirect — only the Diffusion section is ADMIN-gated (the role is passed
// to the client shell, and the broadcast API routes enforce the same rule
// independently).

export default async function SmsPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");

  return <SmsCenter role={staff.role} />;
}
