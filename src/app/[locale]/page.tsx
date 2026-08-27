import CursorGlow from "@/components/public/motion/CursorGlow";
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

export default function HomePage() {
  return (
    <>
      <CursorGlow />
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
