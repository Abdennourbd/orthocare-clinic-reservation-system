/**
 * Dentist JSON-LD for local SEO (Task 23).
 * Server component — renders a single application/ld+json script.
 * NAP (name/address/phone) comes from CLINIC_IDENTITY so it can never drift
 * from the footer, contact page and token page.
 */

import { CLINIC_IDENTITY } from "@/lib/settings/clinicIdentity";
import { CLINIC_LOCATION } from "@/lib/settings/clinicLocation";
import { getCanonicalUrl } from "@/lib/seo/canonical";

export default function LocalBusinessJsonLd({ locale }: { locale: string }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: CLINIC_IDENTITY.name,
    url: getCanonicalUrl("fr", "/"),
    telephone: CLINIC_IDENTITY.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: "10, rue Larbi Abdelsalem",
      addressLocality: "Rouiba",
      addressRegion: "Alger",
      addressCountry: "DZ",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: CLINIC_LOCATION.latitude,
      longitude: CLINIC_LOCATION.longitude,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
        opens: "10:00",
        closes: "17:00",
      },
    ],
    priceRange: "DZD",
    inLanguage: locale,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
