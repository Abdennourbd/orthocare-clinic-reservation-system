import AppointmentManager from "@/components/public/AppointmentManager/AppointmentManager";

// Self-service token page (plan.md §Self-service link). The page shell is
// minimal and renders a client component that fetches its own data, so there
// is nothing to prerender and no third-party script is ever loaded here —
// the `Referrer-Policy: no-referrer` header (applied in next.config.ts for
// `/:locale/appointment/:token`) protects the token in the URL from leaking
// in any `Referer` header.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; token: string }> };

export default async function AppointmentPage({ params }: Props) {
  const { token } = await params;
  return <AppointmentManager token={token} />;
}