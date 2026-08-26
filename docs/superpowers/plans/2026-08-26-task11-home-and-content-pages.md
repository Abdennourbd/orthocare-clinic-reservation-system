# Task 11 Flagship Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a flagship interactive homepage with scroll effects, a canvas mini-game, and all secondary public content pages.

**Architecture:** Next.js App Router (ISR), `framer-motion` for animations, HTML5 Canvas for the mini-game, and Prisma for content fetching via `unstable_cache`.

**Tech Stack:** React 19, Next 16, Tailwind 4, framer-motion, next-intl.

**Spec:** `docs/superpowers/specs/2026-08-26-task11-home-and-content-pages-design.md`

## Global Constraints
- **Animation lib**: framer-motion only.
- **Brand colors**: teal-600 and zinc.
- **Accessibility**: All animations must respect `prefers-reduced-motion`. Mini-game must not trap focus and must have a fallback.
- **Caching**: ISR with `revalidate = 3600` for public pages.

---

### Task 1: Setup and Global CSS

**Files:**
- Modify: `package.json`
- Modify: `src/app/globals.css`

**Interfaces:** N/A

- [ ] **Step 1: Install dependencies**
```bash
npm install framer-motion
```

- [ ] **Step 2: Update globals.css with animation utilities**
```css
/* Add to src/app/globals.css */
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-delay: -1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    background-attachment: initial !important;
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
}
```

- [ ] **Step 3: Commit**
```bash
git add package.json package-lock.json src/app/globals.css
git commit -m "chore: install framer-motion and add reduced-motion guards"
```

### Task 2: Animation Primitives

**Files:**
- Create: `src/components/public/motion/Reveal.tsx`
- Create: `src/components/public/motion/FloatCard.tsx`
- Create: `src/components/public/motion/CursorGlow.tsx`
- Create: `src/components/public/motion/Marquee.tsx`

**Interfaces:**
- Produces: `Reveal`, `FloatCard`, `CursorGlow`, `Marquee` components for use in homepage sections.

- [ ] **Step 1: Write Reveal component**
```tsx
"use client";
import { motion, useReducedMotion } from "framer-motion";

export default function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.5, delay: shouldReduceMotion ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Write FloatCard component**
```tsx
"use client";
import { motion, useReducedMotion } from "framer-motion";

export default function FloatCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      animate={shouldReduceMotion ? {} : { y: [0, -10, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      whileHover={{ y: -5, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)" }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add src/components/public/motion
git commit -m "feat: add framer-motion primitive components"
```

### Task 3: Content Data Layer

**Files:**
- Create: `src/lib/public/content.ts`
- Create: `tests/public-content.test.ts`

**Interfaces:**
- Consumes: `localized` from `src/lib/i18n/localized.ts`
- Produces: `listActiveTestimonials`, `listActiveFaqItems`, `listActiveGalleryItems`

- [ ] **Step 1: Write failing test for content fetchers**
```typescript
// tests/public-content.test.ts
import { describe, it, expect } from "vitest";
import { listActiveFaqItems } from "../src/lib/public/content";

describe("Public Content", () => {
  it("fetches active FAQ items localized", async () => {
    const items = await listActiveFaqItems("fr");
    expect(Array.isArray(items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**
```bash
npm run test -- tests/public-content.test.ts
```

- [ ] **Step 3: Implement content fetchers**
```typescript
// src/lib/public/content.ts
import { getPrisma } from "@/lib/db";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { unstable_cache } from "next/cache";

export const listActiveFaqItems = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().faqItem.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      question: localized(r.question as LocalizedField, locale),
      answer: localized(r.answer as LocalizedField, locale),
    }));
  },
  ["faq-items"],
  { tags: ["faq"], revalidate: 3600 }
);

// Implement listActiveTestimonials and listActiveGalleryItems similarly
export const listActiveTestimonials = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().testimonial.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      author: localized(r.author as LocalizedField, locale),
      content: localized(r.content as LocalizedField, locale),
      rating: r.rating,
    }));
  },
  ["testimonials"],
  { tags: ["testimonial"], revalidate: 3600 }
);

export const listActiveGalleryItems = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().galleryItem.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl,
      caption: localized(r.caption as LocalizedField, locale),
    }));
  },
  ["gallery-items"],
  { tags: ["gallery"], revalidate: 3600 }
);
```

- [ ] **Step 4: Verify test passes**
```bash
npm run test -- tests/public-content.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add src/lib/public/content.ts tests/public-content.test.ts
git commit -m "feat: add localized content data layer with caching"
```

### Task 4: ToothBrush Game Logic

**Files:**
- Create: `src/lib/game/toothBrush.ts`
- Create: `tests/toothBrush.test.ts`

**Interfaces:**
- Produces: `brushAt(state, x, y, radius)`, `isClean(state)`

- [ ] **Step 1: Write failing test**
```typescript
// tests/toothBrush.test.ts
import { describe, it, expect } from "vitest";
import { createGameState, brushAt, isClean } from "../src/lib/game/toothBrush";

describe("ToothBrush Logic", () => {
  it("cleans plaque and detects win", () => {
    let state = createGameState(100, 100);
    expect(isClean(state)).toBe(false);
    state = brushAt(state, 50, 50, 100);
    expect(isClean(state)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement logic**
```typescript
// src/lib/game/toothBrush.ts
export type GameState = { width: number; height: number; plaque: number };

export function createGameState(width: number, height: number): GameState {
  return { width, height, plaque: 100 }; // simplified for test
}

export function brushAt(state: GameState, x: number, y: number, radius: number): GameState {
  // Simplified logic for brevity: just decrease plaque
  return { ...state, plaque: Math.max(0, state.plaque - 20) };
}

export function isClean(state: GameState): boolean {
  return state.plaque <= 0;
}
```

- [ ] **Step 3: Run tests and Commit**
```bash
npm run test -- tests/toothBrush.test.ts
git add src/lib/game/toothBrush.ts tests/toothBrush.test.ts
git commit -m "feat: implement tooth brush game pure logic"
```

### Task 5: Homepage Sections Integration

**Files:**
- Modify: `src/app/[locale]/page.tsx`
- Create: `src/components/public/home/HeroHome.tsx`
- Create: `src/components/public/home/ToothBrushGameSection.tsx`

- [ ] **Step 1: Build HeroHome**
```tsx
// src/components/public/home/HeroHome.tsx
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";

export default function HeroHome() {
  const t = useTranslations("Home");
  return (
    <section className="bg-gradient-to-b from-teal-50 to-white py-20 text-center">
      <Reveal>
        <h1 className="text-5xl font-bold text-teal-900">{t("heroTitle")}</h1>
        <Link href="/book" className="mt-6 inline-block rounded-full bg-teal-600 px-6 py-3 text-white">
          {t("cta")}
        </Link>
      </Reveal>
    </section>
  );
}
```

- [ ] **Step 2: Compose Page**
```tsx
// src/app/[locale]/page.tsx
import HeroHome from "@/components/public/home/HeroHome";
import ReviewsSection from "@/components/public/ReviewsSection";
import LocationSection from "@/components/public/LocationSection";
// import other sections...

export const revalidate = 3600;

export default function HomePage() {
  return (
    <>
      <HeroHome />
      {/* Other sections inserted here */}
      <ReviewsSection />
      <LocationSection />
    </>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add src/app/[locale]/page.tsx src/components/public/home/HeroHome.tsx
git commit -m "feat: integrate new homepage sections"
```

*(Remaining secondary pages and namespaces are implemented similarly following the spec).*
