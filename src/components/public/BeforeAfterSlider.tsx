"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";

// G4 — interactive before/after comparison slider. The AFTER image fills the
// frame; the BEFORE image is clipped to the left of the handle position.
// Drag (mouse + touch via Pointer Events), click-to-jump, and full keyboard
// support (role="slider", arrows ±4 / Shift ±10, Home/End).
//
// The mechanics container is isolated with dir="ltr": a spatial divider has
// one consistent gesture in every locale (drag right reveals more "before").
// Only the badge labels are localized. Visual language follows the gallery
// page (teal accents, zinc neutrals, rounded-2xl).

const STEP = 4;
const STEP_BIG = 10;

function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

export default function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel,
  afterLabel,
  sliderLabel,
  sizes,
}: {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel: string;
  afterLabel: string;
  sliderLabel: string;
  sizes?: string;
}) {
  const [position, setPosition] = useState(50);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? STEP_BIG : STEP;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setPosition((p) => clamp(p + big));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPosition((p) => clamp(p - big));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPosition(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPosition(100);
    }
  };

  return (
    <div
      ref={trackRef}
      dir="ltr"
      className="relative aspect-[4/3] touch-none select-none overflow-hidden rounded-2xl bg-zinc-100"
      onPointerDown={(e) => {
        draggingRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) setFromClientX(e.clientX);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
    >
      <Image
        src={afterSrc}
        alt={afterAlt}
        fill
        loading="lazy"
        draggable={false}
        sizes={sizes ?? "(max-width: 640px) 100vw, 50vw"}
        className="pointer-events-none object-cover"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        <Image
          src={beforeSrc}
          alt={beforeAlt}
          fill
          loading="lazy"
          draggable={false}
          sizes={sizes ?? "(max-width: 640px) 100vw, 50vw"}
          className="object-cover"
        />
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-sm">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
        {afterLabel}
      </span>

      <div
        className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_8px_rgba(0,0,0,0.4)]"
        style={{ left: `${position}%` }}
        aria-hidden="true"
      />
      <button
        type="button"
        role="slider"
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${Math.round(position)}%`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-teal-700 shadow-md outline-none transition-transform focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        style={{ left: `${position}%` }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M7 4 3 10l4 6M13 4l4 6-4 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
