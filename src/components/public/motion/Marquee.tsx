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

  // If reduced motion is enabled, we just show the content without animation,
  // possibly wrapping it in a scrollable container
  if (shouldReduceMotion) {
    return (
      <div className={`overflow-x-auto whitespace-nowrap flex gap-4 ${className}`}>
        {children}
      </div>
    );
  }

  return (
    <div className={`overflow-hidden flex whitespace-nowrap ${className}`}>
      <motion.div
        className="flex gap-4 min-w-max"
        animate={{
          x: direction === "left" ? [0, "-50%"] : ["-50%", 0],
        }}
        transition={{
          duration: speed,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        {/* Render children twice to create a seamless loop effect */}
        <div className="flex gap-4">{children}</div>
        <div className="flex gap-4">{children}</div>
      </motion.div>
    </div>
  );
}
