"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { Link } from "@/i18n/navigation";
import { ToothIcon, SparkleIcon, StarIcon } from "../icons";

// Decorative floating glyphs layered behind the hero copy. Positions are
// hand-tuned; each drifts on a slow loop and shifts with scroll for parallax.
type Floater = {
  Icon: (props: { width: number; height: number }) => React.ReactElement;
  size: number;
  delay: number;
  drift: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
};

const floaters: Floater[] = [
  { Icon: ToothIcon, top: "12%", left: "6%", size: 56, delay: 0, drift: 18 },
  { Icon: SparkleIcon, top: "20%", right: "8%", size: 40, delay: 1.2, drift: 24 },
  { Icon: ToothIcon, bottom: "16%", left: "12%", size: 72, delay: 0.6, drift: 14 },
  { Icon: SparkleIcon, bottom: "22%", right: "14%", size: 48, delay: 1.8, drift: 20 },
  { Icon: ToothIcon, top: "34%", right: "20%", size: 34, delay: 2.4, drift: 16 },
];

export default function HeroHome() {
  const t = useTranslations("Home");
  const ref = useRef<HTMLElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const yText = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-gradient-to-b from-teal-50 via-white to-white"
    >
      {/* Floating decorative icons */}
      {floaters.map(({ Icon, top, left, right, bottom, size, delay, drift }, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="absolute text-teal-300/70"
          style={{ top, left, right, bottom }}
          animate={shouldReduceMotion ? undefined : { y: [0, -drift, 0], rotate: [0, 8, 0] }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut",
            delay,
          }}
        >
          <Icon width={size} height={size} />
        </motion.div>
      ))}

      <motion.div
        style={{ y: shouldReduceMotion ? 0 : yText, opacity }}
        className="relative mx-auto flex max-w-5xl flex-col items-center px-4 py-24 text-center sm:px-6 md:py-36"
      >
        <span
          style={{ animationDelay: "0ms" }}
          className="hero-enter mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50/80 px-4 py-1.5 text-sm font-medium text-teal-700"
        >
          <SparkleIcon width={16} height={16} />
          {t("heroBadge")}
        </span>

        <h1
          style={{ animationDelay: "50ms" }}
          className="hero-enter max-w-4xl text-4xl font-bold tracking-tight text-zinc-900 sm:text-6xl md:text-7xl"
        >
          {t("heroTitle")}{" "}
          <span className="bg-gradient-to-r from-teal-600 to-emerald-500 bg-clip-text text-transparent">
            {t("heroTitleAccent")}
          </span>
        </h1>

        <p
          style={{ animationDelay: "150ms" }}
          className="hero-enter mt-6 max-w-2xl text-lg text-zinc-600 sm:text-xl"
        >
          {t("heroSubtitle")}
        </p>

        <div
          style={{ animationDelay: "250ms" }}
          className="hero-enter mt-10 flex flex-col gap-3 sm:flex-row"
        >
          <Link
            href="/book"
            className="rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {t("cta")}
          </Link>
          <Link
            href="/services"
            className="rounded-full border border-zinc-300 bg-white px-8 py-4 text-base font-semibold text-zinc-800 transition-all hover:-translate-y-0.5 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {t("secondaryCta")}
          </Link>
        </div>

        <div
          style={{ animationDelay: "400ms" }}
          className="hero-enter mt-10 flex items-center gap-2 text-sm text-zinc-500"
        >
          <span className="flex text-amber-400" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <StarIcon key={i} width={16} height={16} fill="currentColor" stroke="none" />
            ))}
          </span>
          <span>{t("heroRating")}</span>
        </div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        aria-hidden
        className="relative mx-auto flex w-max flex-col items-center gap-2 pb-10 text-teal-500"
        animate={shouldReduceMotion ? {} : { y: [0, 8, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="text-xs font-medium uppercase tracking-widest text-zinc-400">
          {t("scrollHint")}
        </span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
    </section>
  );
}
