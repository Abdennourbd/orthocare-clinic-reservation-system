import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import HeroHome from "@/components/public/home/HeroHome";
import TrustStrip from "@/components/public/home/TrustStrip";
import ServicesPreview from "@/components/public/home/ServicesPreview";
import ToothBrushGameSection from "@/components/public/home/ToothBrushGameSection";
import FeaturesSection from "@/components/public/home/FeaturesSection";
import TestimonialsPreview from "@/components/public/home/TestimonialsPreview";
import GalleryPreview from "@/components/public/home/GalleryPreview";
import FaqPreview from "@/components/public/home/FaqPreview";
import ReviewsSection from "@/components/public/ReviewsSection";
import LocationSection from "@/components/public/LocationSection";
import CtaBand from "@/components/public/home/CtaBand";

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
      <ServicesPreview />
      <ToothBrushGameSection />
      <FeaturesSection />
      <TestimonialsPreview />
      <GalleryPreview />
      <FaqPreview />
      <ReviewsSection />
      <LocationSection />
      <CtaBand />
    </>
  );
}
