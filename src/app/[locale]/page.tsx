import HeroHome from "@/components/public/home/HeroHome";
import ToothBrushGameSection from "@/components/public/home/ToothBrushGameSection";
import ReviewsSection from "@/components/public/ReviewsSection";
import LocationSection from "@/components/public/LocationSection";

export const revalidate = 3600;

export default function HomePage() {
  return (
    <>
      <HeroHome />
      <ToothBrushGameSection />
      <ReviewsSection />
      <LocationSection />
    </>
  );
}
