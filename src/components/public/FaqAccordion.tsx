"use client";

import { useEffect, useState } from "react";

export type FaqEntry = { id: string; question: string; answer: string };

// Accessible accordion (native <button> + aria-expanded + aria-controls)
// WITHOUT framer-motion: the panel expands via the CSS grid-rows trick
// (0fr → 1fr transition) and the plus icon rotates via CSS. Instant when
// the user prefers reduced motion (global guard collapses transitions).
export default function FaqAccordion({ items }: { items: FaqEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
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
    <div className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              aria-expanded={open}
              aria-controls={`faq-panel-${item.id}`}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start"
            >
              <span className="text-base font-semibold text-zinc-900">
                {item.question}
              </span>
              <span
                aria-hidden
                className={`text-teal-600 transition-transform duration-200 ${
                  open ? "rotate-45" : ""
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </span>
            </button>
            <div
              id={`faq-panel-${item.id}`}
              className={`grid transition-all duration-200 ease-in-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
              style={reducedMotion ? { transitionDuration: "0s" } : undefined}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-sm text-zinc-600">{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
