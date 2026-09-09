import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import HeroHome from "@/components/public/home/HeroHome";
import TrustStrip from "@/components/public/home/TrustStrip";
import SmileResults from "@/components/public/home/SmileResults";
import ComfortSection from "@/components/public/home/ComfortSection";
import DoctorSection from "@/components/public/home/DoctorSection";
import ServicesPreview from "@/components/public/home/ServicesPreview";
import ToothBrushGameSection from "@/components/public/home/ToothBrushGameSection";
import ClinicSection from "@/components/public/home/ClinicSection";
import FeaturesSection from "@/components/public/home/FeaturesSection";
import TestimonialsPreview from "@/components/public/home/TestimonialsPreview";
import FaqPreview from "@/components/public/home/FaqPreview";
import ReviewsSection from "@/components/public/ReviewsSection";
import LocationSection from "@/components/public/LocationSection";
import CtaBand from "@/components/public/home/CtaBand";
import StickyBookBar from "@/components/public/home/StickyBookBar";
import { getAppLocale } from "@/lib/i18n/getLocale";
import { listHomeSmileCases } from "@/lib/public/content";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata(locale, "/", t("title"), t("description"));
}

export default async function HomePage() {
  // H1 (home-cases): admin-pinned feed for the SmileResults chapter.
  // Featured first (admin order), fallback to latest active — encapsulated
  // in listHomeSmileCases (max 4, with extras for the strip).
  const locale = await getAppLocale();
  const homeCases = await listHomeSmileCases(locale);
  return (
    <>
      <HeroHome />
      <TrustStrip />
      <SmileResults cases={homeCases} />
      <ComfortSection />
      <DoctorSection />
      <ServicesPreview />
      <ToothBrushGameSection />
      <ClinicSection />
      <TestimonialsPreview />
      <FeaturesSection />
      <FaqPreview />
      <ReviewsSection />
      <LocationSection />
      <CtaBand />
      <StickyBookBar />
      {/* Spacer so the fixed mobile booking bar never covers the footer. */}
      <div aria-hidden className="h-20 bg-white sm:hidden" />
    </>
  );
}
