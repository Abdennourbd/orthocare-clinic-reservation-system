"use client";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

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
  const shouldReduceMotion = useReducedMotion();
  // WCAG 2.2.2: moving content must be pausable — pause on hover/focus so
  // keyboard and mouse users resting on a card stop the motion.
  const [paused, setPaused] = useState(false);
  const frozen = shouldReduceMotion || paused;

  // No `whitespace-nowrap` on the root: the row layout comes from `min-w-max`
  // on the track plus `shrink-0` on each item, so text inside an item is free
  // to wrap within that item's own width instead of overflowing it.
  return (
    <div
      className={`overflow-hidden flex ${className}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <motion.div
        className="flex min-w-max"
        animate={frozen ? { x: 0 } : { x: direction === "left" ? [0, "-50%"] : ["-50%", 0] }}
        transition={{
          duration: speed,
          repeat: frozen ? 0 : Infinity,
          ease: "linear",
        }}
      >
        {/* Render children twice to create a seamless loop effect. The second
            copy is aria-hidden so screen readers don't announce the content
            twice. Each copy carries its own trailing padding so the -50%
            translate wraps at exactly one copy width (no half-gap jump). */}
        <div className="flex gap-4 pr-4">{children}</div>
        <div className="flex gap-4 pr-4" aria-hidden="true">{children}</div>
      </motion.div>
    </div>
  );
}
