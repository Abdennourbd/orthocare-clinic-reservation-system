"use client";
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

  // No `whitespace-nowrap` on the root: the row layout comes from `min-w-max`
  // on the track plus `shrink-0` on each item, so text inside an item is free
  // to wrap within that item's own width instead of overflowing it.
  return (
    <div className={`overflow-hidden flex ${className}`}>
      <motion.div
        className="flex min-w-max"
        animate={
          shouldReduceMotion
            ? undefined
            : { x: direction === "left" ? [0, "-50%"] : ["-50%", 0] }
        }
        transition={{
          duration: speed,
          repeat: Infinity,
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
