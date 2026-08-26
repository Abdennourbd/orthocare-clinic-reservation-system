"use client";
import { motion, useReducedMotion } from "framer-motion";

export default function FloatCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      animate={shouldReduceMotion ? {} : { y: [0, -10, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      whileHover={
        shouldReduceMotion 
          ? { boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)" } 
          : { y: -5, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)" }
      }
    >
      {children}
    </motion.div>
  );
}
