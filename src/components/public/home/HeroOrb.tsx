"use client";

import { useEffect, useRef, useState } from "react";
import FluidOrb from "@/components/ui/fluid-orb";

// Ambient backdrop for the doctor hero: one teal fluid orb, decorative only.
// The canvas unmounts when scrolled offscreen (rAF would otherwise run
// forever); the static blurred poster underneath keeps an identical footprint
// when WebGL is missing, JS is disabled, or reduced motion is on (FluidOrb
// itself renders a single static frame in that case).
export default function HeroOrb({
  size = 320,
  color = "#5eead4",
  className = "",
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute ${className}`}>
      <div className="absolute inset-0 rounded-full bg-teal-200/60 blur-2xl" />
      {inView ? (
        <FluidOrb size={size} color={color} className="relative opacity-70" />
      ) : null}
    </div>
  );
}
