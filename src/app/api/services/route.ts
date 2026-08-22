import { parseLocale } from "@/lib/i18n/config";
import { listActiveServices } from "@/lib/public/services";
import { ok } from "@/lib/api/http";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const locale = parseLocale(url.searchParams.get("locale"));
  const services = await listActiveServices(locale);
  return ok({ services });
}