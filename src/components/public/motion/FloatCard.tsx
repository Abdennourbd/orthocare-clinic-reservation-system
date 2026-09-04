"use client";

import { useEffect, useState } from "react";

// Hover-lift card WITHOUT framer-motion: pure CSS transition (see
// `.float-card` in globals.css). The old infinite JS-driven bob is dropped —
// it kept the main thread busy on every page for decoration. `children` and
// `className` props unchanged, so call sites keep working.
export default function FloatCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-once preference read
      setReducedMotion(true);
    }
  }, []);

  return (
    <div className={`${reducedMotion ? "" : "float-card "}${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
