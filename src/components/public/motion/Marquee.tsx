"use client";

// Infinite marquee WITHOUT framer-motion: pure CSS keyframes (see
// `.marquee-track` in globals.css), no JS rAF loop keeping the main thread
// busy. WCAG 2.2.2 pause behavior is CSS too (`:hover` / `:focus-within` →
// `animation-play-state: paused`), and the global reduced-motion guard stops
// the animation entirely. Same props (`speed`, `direction`, `className`).
export default function Marquee({
  children,
  speed = 20,
  direction = "left",
  className = "",
}: {
  children: React.ReactNode;
  speed?: number;
  direction?: "left" | "right";
  className?: string;
}) {
  // No `whitespace-nowrap` on the root: the row layout comes from `min-w-max`
  // on the track plus `shrink-0` on each item, so text inside an item is free
  // to wrap within that item's own width instead of overflowing it.
  return (
    <div className={`marquee overflow-hidden flex ${className}`}>
      <div
        className="marquee-track flex min-w-max"
        style={
          {
            "--marquee-duration": `${speed}s`,
            animationDirection: direction === "left" ? "normal" : "reverse",
          } as React.CSSProperties
        }
      >
        {/* Render children twice to create a seamless loop effect. The second
            copy is aria-hidden so screen readers don't announce the content
            twice. Each copy carries its own trailing padding so the -50%
            translate wraps at exactly one copy width (no half-gap jump). */}
        <div className="flex gap-4 pr-4">{children}</div>
        <div className="flex gap-4 pr-4" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}
