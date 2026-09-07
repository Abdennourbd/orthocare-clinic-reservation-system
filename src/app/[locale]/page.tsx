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

export default function HomePage() {
  return (
    <>
      <HeroHome />
      <TrustStrip />
      <SmileResults />
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
