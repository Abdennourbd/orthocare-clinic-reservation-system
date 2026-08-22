import { parseLocale } from "@/lib/i18n/config";
import { getActiveServiceBySlug } from "@/lib/public/services";
import { ok, errorResponse } from "@/lib/api/http";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { slug } = await ctx.params;
  const url = new URL(request.url);
  const locale = parseLocale(url.searchParams.get("locale"));

  const service = await getActiveServiceBySlug(slug, locale);
  if (!service) {
    return errorResponse(404, "SERVICE_NOT_FOUND", "Service not found");
  }
  return ok({ service });
}