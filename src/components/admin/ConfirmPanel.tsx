"use client";

import { useEffect, useRef } from "react";

// Inline two-step confirmation panel — the single pattern for every
// destructive/admin action in the dashboard (no `window.confirm`, no modal,
// no `<dialog>`). Keyboard- and screen-reader-safe: the question is
// `role="alert"`, focus moves to the confirm button on open, Escape cancels.
export default function ConfirmPanel({
  message,
  confirmLabel,
  cancelLabel = "Annuler",
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) onCancel();
      }}
    >
      <p role="alert" className="text-sm text-red-800">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white
            hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800
            hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
