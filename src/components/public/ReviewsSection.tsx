import { getTranslations } from "next-intl/server";
import GoogleReviews from "./GoogleReviews";

export default async function ReviewsSection() {
  const t = await getTranslations("Reviews");
  return (
    <section className="bg-white" aria-labelledby="reviews-title">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <h2
          id="reviews-title"
          className="text-center text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
        >
          {t("title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-zinc-600">
          {t("subtitle")}
        </p>
        <div className="mx-auto mt-8 max-w-3xl">
          <GoogleReviews />
        </div>
      </div>
    </section>
  );
}