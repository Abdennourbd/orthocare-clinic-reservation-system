"use client";

import { useTranslations } from "next-intl";

type StepIndicatorProps = {
  /** Step labels in order. */
  steps: string[];
  /** Current step, 1-based. */
  current: number;
};

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <path
        d="M3 8.5l3.5 3.5L13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Progress stepper for the booking wizard. Display-only on purpose: step
 * navigation stays on the wizard's Back/Continue buttons, so the stepper
 * never suggests clickable steps that aren't. Only the current step's label
 * is shown inline (the wizard column is too narrow for all five); the rest
 * stay available to screen readers.
 */
export default function StepIndicator({ steps, current }: StepIndicatorProps) {
  const t = useTranslations("Booking");
  const total = steps.length;

  return (
    <nav aria-label={t("stepProgress", { current, total })}>
      {/* Compact progress for small screens */}
      <p className="text-sm text-zinc-600 sm:hidden">
        {t("stepProgress", { current, total })}
        {" — "}
        <span className="font-medium text-zinc-900">{steps[current - 1]}</span>
      </p>

      <ol className="hidden sm:flex sm:items-center">
        {steps.map((label, i) => {
          const n = i + 1;
          const state =
            n < current ? "done" : n === current ? "current" : "upcoming";
          return (
            <li
              key={label}
              className={`flex items-center ${n < total ? "min-w-0 flex-1" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-current={state === "current" ? "step" : undefined}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    state === "done"
                      ? "bg-teal-600 text-white"
                      : state === "current"
                        ? "bg-teal-600 text-white ring-4 ring-teal-100"
                        : "border border-zinc-300 bg-white text-zinc-400"
                  }`}
                >
                  {state === "done" ? <CheckIcon /> : n}
                </span>
                <span
                  className={`truncate text-sm ${
                    state === "current"
                      ? "font-semibold text-zinc-900"
                      : "sr-only"
                  }`}
                >
                  {label}
                </span>
              </div>
              {n < total && (
                <span
                  aria-hidden="true"
                  className={`mx-3 h-px min-w-4 flex-1 transition-colors ${
                    n < current ? "bg-teal-500" : "bg-zinc-200"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
