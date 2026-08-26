import { useTranslations } from "next-intl";
import { buildDirectionsUrl } from "@/lib/maps/embed";

// One-click "Open in Google Maps" directions link (Task 10). No API key: the
// `maps/dir` URL opens the Maps app on mobile and Google Maps on desktop.
type Props = {
  className?: string;
};

export default function DirectionsButton({ className }: Props) {
  const t = useTranslations("Location");
  return (
    <a
      href={buildDirectionsUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex items-center gap-2 rounded-full bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      }
    >
      {t("directions")}
    </a>
  );
}