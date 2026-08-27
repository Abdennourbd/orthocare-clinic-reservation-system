import { getPrisma } from "@/lib/db";
import { localized, type LocalizedField } from "@/lib/i18n/localized";

// Public, localized service listing — the data layer behind `GET /api/services`
// and the booking wizard's service step. Task 11's services pages reuse it.

export type PublicService = {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number | null;
  currency: string;
};

function toPublicService(
  row: {
    id: string;
    slug: string;
    name: unknown;
    description: unknown;
    durationMinutes: number;
    price: number | null;
    currency: string;
  },
  locale: string,
): PublicService {
  return {
    id: row.id,
    slug: row.slug,
    name: localized(row.name as LocalizedField, locale),
    description: localized(row.description as LocalizedField, locale),
    durationMinutes: row.durationMinutes,
    price: row.price,
    currency: row.currency,
  };
}

/** All active services, ordered by creation (the order the clinic seeded). */
export async function listActiveServices(locale: string): Promise<PublicService[]> {
  const rows = await getPrisma().service.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => toPublicService(r, locale));
}

/** A single active service by slug, or null when not found/inactive. */
export async function getActiveServiceBySlug(
  slug: string,
  locale: string,
): Promise<PublicService | null> {
  const row = await getPrisma().service.findUnique({ where: { slug } });
  if (!row || !row.active) return null;
  return toPublicService(row, locale);
}

/** Format a service price in the requested locale; free/unspecified → freeLabel. */
export function formatPrice(
  price: number | null,
  currency: string,
  freeLabel: string,
  locale: string,
): string {
  if (price === null || price === 0) return freeLabel;
  return `${price.toLocaleString(locale)} ${currency}`;
}
