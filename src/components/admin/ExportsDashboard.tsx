"use client";

import { useMemo, useState, type FormEvent } from "react";

// Task 19 — exports dashboard (ADMIN only): monthly CSV/XLSX download +
// printable day sheet. FR-only, like every admin screen. The monthly export
// hits GET /api/admin/exports/appointments as a plain download link (the
// browser handles the attachment); the day sheet is fetched as JSON for the
// on-screen preview, and the Imprimer button prints only the sheet section
// (print CSS below keeps it to one page).

type DaySheetRow = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  source: string;
  patientFirstName: string;
  patientLastName: string;
  patientPhone: string;
  serviceName: string;
  serviceDurationMinutes: number;
};

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

const buttonPrimaryClass =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonSecondaryClass =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ExportsDashboard() {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [includeNotes, setIncludeNotes] = useState(false);

  const [sheetDate, setSheetDate] = useState(() => todayLocal());
  const [sheetRows, setSheetRows] = useState<DaySheetRow[] | null>(null);
  const [sheetLoadedFor, setSheetLoadedFor] = useState<string | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const downloadHref = useMemo(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const params = new URLSearchParams({ month, format });
    if (includeNotes) params.set("includeNotes", "true");
    return `/api/admin/exports/appointments?${params.toString()}`;
  }, [month, format, includeNotes]);

  async function loadDaySheet(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sheetDate)) {
      setSheetError("Date invalide.");
      return;
    }
    setSheetLoading(true);
    setSheetError(null);
    try {
      const response = await fetch(
        `/api/admin/exports/day-sheet?date=${encodeURIComponent(sheetDate)}`,
      );
      if (!response.ok) {
        setSheetError("Impossible de charger la fiche du jour.");
        setSheetRows(null);
        return;
      }
      const body = (await response.json()) as {
        appointments: DaySheetRow[];
      };
      setSheetRows(body.appointments);
      setSheetLoadedFor(sheetDate);
    } catch {
      setSheetError("Impossible de charger la fiche du jour.");
      setSheetRows(null);
    } finally {
      setSheetLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Exports</h1>
        <p className="text-sm text-slate-500">
          Rapport mensuel d&apos;activité et fiche du jour à imprimer. Chaque
          export est enregistré dans le journal d&apos;audit.
        </p>
      </header>

      <section
        aria-labelledby="exports-monthly-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2
          id="exports-monthly-heading"
          className="text-base font-semibold text-slate-900"
        >
          Rapport mensuel d&apos;activité
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Rendez-vous du mois choisi, en CSV ou Excel. Les notes cliniques
          sont exclues sauf demande explicite.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="exports-month"
              className="block text-sm font-medium text-slate-700"
            >
              Mois
            </label>
            <input
              id="exports-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-slate-700">
              Format
            </legend>
            <div className="mt-2 flex gap-4">
              {(["csv", "xlsx"] as const).map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="radio"
                    name="exports-format"
                    value={value}
                    checked={format === value}
                    onChange={() => setFormat(value)}
                    className="h-4 w-4 accent-teal-700"
                  />
                  {value === "csv" ? "CSV" : "Excel (.xlsx)"}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-end">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              <span>
                Inclure les notes cliniques
                <span className="block text-xs text-slate-500">
                  Réservé aux usages qui l&apos;exigent vraiment.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          {downloadHref ? (
            <a href={downloadHref} download className={buttonPrimaryClass}>
              Télécharger le rapport
            </a>
          ) : (
            <button type="button" disabled className={buttonPrimaryClass}>
              Télécharger le rapport
            </button>
          )}
          <p className="text-xs text-slate-500">
            Fichier audité (mois, format, nombre de lignes).
          </p>
        </div>
      </section>

      <section
        aria-labelledby="exports-daysheet-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2
          id="exports-daysheet-heading"
          className="text-base font-semibold text-slate-900"
        >
          Fiche du jour
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Programme du jour à garder sous la main si le site est
          momentanément injoignable. S&apos;imprime lisiblement sur une page.
        </p>

        <form onSubmit={loadDaySheet} className="mt-4 flex flex-wrap gap-3">
          <div>
            <label
              htmlFor="exports-sheet-date"
              className="block text-sm font-medium text-slate-700"
            >
              Date
            </label>
            <input
              id="exports-sheet-date"
              type="date"
              value={sheetDate}
              onChange={(e) => setSheetDate(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={sheetLoading}
              className={buttonSecondaryClass}
            >
              {sheetLoading ? "Chargement…" : "Afficher la fiche"}
            </button>
            <button
              type="button"
              disabled={!sheetRows || sheetRows.length === 0}
              onClick={() => window.print()}
              className={buttonSecondaryClass}
            >
              Imprimer
            </button>
          </div>
        </form>

        <div aria-live="polite" className="mt-4">
          {sheetError ? (
            <p role="alert" className="text-sm text-red-700">
              {sheetError}
            </p>
          ) : sheetRows === null ? (
            <p className="text-sm text-slate-500">
              Choisissez une date puis « Afficher la fiche ».
            </p>
          ) : sheetRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucun rendez-vous le{" "}
              {sheetLoadedFor ? formatDayLabel(sheetLoadedFor) : "—"}.
            </p>
          ) : (
            <div id="day-sheet-print-area">
              <p className="print-only text-sm font-semibold text-slate-900">
                Ortho&apos;Care — fiche du jour :{" "}
                {sheetLoadedFor ? formatDayLabel(sheetLoadedFor) : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="day-sheet-table mt-2 w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th scope="col" className="px-2 py-2">
                        Heure
                      </th>
                      <th scope="col" className="px-2 py-2">
                        Patient
                      </th>
                      <th scope="col" className="px-2 py-2">
                        Téléphone
                      </th>
                      <th scope="col" className="px-2 py-2">
                        Soin
                      </th>
                      <th scope="col" className="px-2 py-2">
                        Statut
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-900">
                          {formatTime(row.startTime)}
                        </td>
                        <td className="px-2 py-2 text-slate-900">
                          {row.patientFirstName} {row.patientLastName}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                          {row.patientPhone}
                        </td>
                        <td className="px-2 py-2 text-slate-700">
                          {row.serviceName}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                          {row.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {sheetRows.length} rendez-vous — imprimé le{" "}
                {new Date().toLocaleDateString("fr-FR")}.
              </p>
            </div>
          )}
        </div>
      </section>

      <style>{`
        .print-only { display: none; }
        @media print {
          body * { visibility: hidden; }
          #day-sheet-print-area, #day-sheet-print-area * { visibility: visible; }
          #day-sheet-print-area {
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            padding: 12mm;
          }
          #day-sheet-print-area .print-only { display: block; }
          #day-sheet-print-area .day-sheet-table { font-size: 11px; }
          #day-sheet-print-area .day-sheet-table th,
          #day-sheet-print-area .day-sheet-table td {
            padding: 3px 6px;
          }
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
