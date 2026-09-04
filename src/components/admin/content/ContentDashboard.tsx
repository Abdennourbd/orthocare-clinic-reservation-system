"use client";

import { useRef, useState } from "react";
import ServicesTab from "./ServicesTab";
import TestimonialsTab from "./TestimonialsTab";
import FaqsTab from "./FaqsTab";
import GalleryTab from "./GalleryTab";

// Task 21 — content dashboard shell (ADMIN): tabbed CRUD for services,
// testimonials, FAQs and gallery. FR-only, same visual language as the
// TeamDashboard (teal-700 primary, slate cards, focus rings).

const TABS = [
  { id: "services", label: "Services" },
  { id: "testimonials", label: "Témoignages" },
  { id: "faqs", label: "Questions fréquentes" },
  { id: "gallery", label: "Galerie" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ContentDashboard() {
  const [tab, setTab] = useState<TabId>("services");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // WAI-ARIA tab keyboard pattern: Left/Right (and Up/Down) move between
  // tabs and activate the focused one; focus follows the active tab.
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = (index + dir + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Contenu du site</h1>
        <p className="mt-1 text-sm text-slate-600">
          Services, témoignages, questions fréquentes et galerie. Les modifications sont visibles sur le site public.
        </p>
      </div>

      <div role="tablist" aria-label="Types de contenu" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`content-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`content-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${
              tab === t.id
                ? "bg-teal-700 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`content-panel-${tab}`}
        aria-labelledby={`content-tab-${tab}`}
      >
        {tab === "services" ? <ServicesTab /> : null}
        {tab === "testimonials" ? <TestimonialsTab /> : null}
        {tab === "faqs" ? <FaqsTab /> : null}
        {tab === "gallery" ? <GalleryTab /> : null}
      </div>
    </div>
  );
}
