"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Last-resort error boundary (security audit hardening). Production Next.js
// renders generic 500s without internals, but this boundary removes any
// reliance on framework-version behavior: users see a generic message while
// the real error goes to the already-scrubbed Sentry path — never the client.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      Sentry.captureException(error);
    } catch {
      // Reporting must never throw.
    }
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <div
          style={{
            maxWidth: 480,
            margin: "15vh auto",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
          }}
        >
          <h1>Une erreur est survenue</h1>
          <p>Veuillez réessayer. Si le problème persiste, contactez la clinique.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "10px 24px",
              borderRadius: 999,
              border: "none",
              background: "#0d9488",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
