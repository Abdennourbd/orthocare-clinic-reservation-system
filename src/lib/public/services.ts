import { getPrisma } from "@/lib/db";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { unstable_cache } from "next/cache";

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
  return cachedServiceList(locale);
}

/** A single active service by slug, or null when not found/inactive. */
export async function getActiveServiceBySlug(
  slug: string,
  locale: string,
): Promise<PublicService | null> {
  return cachedServiceBySlug(slug, locale);
}

// Same dev-bypass convention as public/content.ts: the admin services routes
// invalidate the `services` tag on every write, so cached reads stay fresh
// in production without an hourly staleness window on booking data.
// Cached ONLY in production: in dev AND test the real implementation would
// serve stale cross-test data (in-process cache shared across suites).
const useCache = process.env.NODE_ENV === "production";

async function fetchServiceList(locale: string): Promise<PublicService[]> {
  const rows = await getPrisma().service.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => toPublicService(r, locale));
}

async function fetchServiceBySlug(
  slug: string,
  locale: string,
): Promise<PublicService | null> {
  const row = await getPrisma().service.findUnique({ where: { slug } });
  if (!row || !row.active) return null;
  return toPublicService(row, locale);
}

const cachedServiceList = useCache
  ? (locale: string) =>
      unstable_cache(fetchServiceList, ["service-list"], {
        tags: ["services"],
        revalidate: 3600,
      })(locale)
  : fetchServiceList;

const cachedServiceBySlug = useCache
  ? (slug: string, locale: string) =>
      unstable_cache(fetchServiceBySlug, ["service-by-slug"], {
        tags: ["services"],
        revalidate: 3600,
      })(slug, locale)
  : fetchServiceBySlug;

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
