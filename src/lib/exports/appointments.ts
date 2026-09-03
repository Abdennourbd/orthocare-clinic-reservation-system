import * as XLSX from "xlsx";
import {
  formatClinicLocalTime,
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { localized } from "@/lib/i18n/localized";

// Task 19 — pure monthly-export builders (no DB, no Next.js imports). The
// routes load the rows, this module shapes + serializes them. All date maths
// goes through lib/time/clinicTime.ts: ranges are clinic-local YYYY-MM-DD,
// instants are UTC.

export type ExportAppointmentInput = {
  id: string;
  startTime: Date;
  endTime: Date;
  status: string;
  source: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  visitNotes: string | null;
  patient: {
    firstName: string;
    lastName: string;
    phone: string;
    phoneE164: string;
  };
  service: {
    name: unknown;
    durationMinutes: number;
  };
};

export type ExportRow = Record<string, string>;

// FR-only headers: the admin dashboard is French-only (plan.md).
export const EXPORT_HEADERS_BASE = [
  "Date",
  "Heure",
  "Patient",
  "Téléphone",
  "Service",
  "Durée (min)",
  "Statut",
  "Source",
  "Créé le",
  "Confirmé le",
  "Motif d'annulation",
] as const;

export const EXPORT_NOTES_HEADER = "Notes cliniques";

export function exportHeaders(includeNotes: boolean): string[] {
  return includeNotes
    ? [...EXPORT_HEADERS_BASE, EXPORT_NOTES_HEADER]
    : [...EXPORT_HEADERS_BASE];
}

function formatClinicLocalDateTime(utcDate: Date): string {
  return `${toClinicLocalDateString(utcDate)} ${formatClinicLocalTime(utcDate)}`;
}

/** UTC bounds of a clinic-local month (YYYY-MM). */
export function getClinicMonthBoundsUTC(month: string): {
  startUTC: Date;
  endUTC: Date;
  from: string;
  to: string;
} {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const { startUTC } = getClinicDayBoundsUTC(from);
  const { endUTC } = getClinicDayBoundsUTC(to);
  return { startUTC, endUTC, from, to };
}

export function buildExportRows(
  appointments: ExportAppointmentInput[],
  opts: { includeNotes: boolean },
): ExportRow[] {
  return appointments.map((a) => {
    const row: ExportRow = {
      Date: toClinicLocalDateString(a.startTime),
      Heure: formatClinicLocalTime(a.startTime),
      Patient: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      Téléphone: a.patient.phoneE164 || a.patient.phone,
      Service: localized(a.service.name as never, "fr"),
      "Durée (min)": String(a.service.durationMinutes),
      Statut: a.status,
      Source: a.source,
      "Créé le": formatClinicLocalDateTime(a.createdAt),
      "Confirmé le": a.confirmedAt
        ? formatClinicLocalDateTime(a.confirmedAt)
        : "",
      "Motif d'annulation": a.cancelReason ?? "",
    };
    if (opts.includeNotes) {
      row[EXPORT_NOTES_HEADER] = a.visitNotes ?? "";
    }
    return row;
  });
}

function escapeCsvCell(value: string): string {
  // RFC 4180: quote when the cell holds the delimiter, a quote, or a newline;
  // embedded quotes double up. Delimiter is ";" (French Excel default).
  const quoted = /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  // OWASP CSV-injection: a cell opening with = + - @ (or tab/CR) runs as a
  // formula when the CSV is opened in a spreadsheet. Patient names, phones,
  // service names and (opt-in) notes all flow here verbatim, so neutralize
  // with a leading single quote. Quoting alone does NOT stop evaluation.
  // The XLSX path needs no equivalent: aoa_to_sheet writes string cells.
  return /^[=+\-@\t\r]/.test(quoted) ? `'${quoted}` : quoted;
}

/** CSV with ";" delimiter + UTF-8 BOM so French Excel opens accents as-is. */
export function toCSV(rows: ExportRow[], includeNotes: boolean): string {
  const headers = exportHeaders(includeNotes);
  const lines = [headers.map(escapeCsvCell).join(";")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h] ?? "")).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** XLSX workbook buffer (first sheet = export, header row frozen + filtered). */
export function toXLSX(rows: ExportRow[], includeNotes: boolean): Buffer {
  const headers = exportHeaders(includeNotes);
  const aoa: string[][] = [
    headers,
    ...rows.map((row) => headers.map((h) => row[h] ?? "")),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = headers.map((h) => ({
    wch: Math.max(
      h.length + 2,
      ...rows.map((r) => Math.min((r[h] ?? "").length + 2, 40)),
    ),
  }));
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1" };
  sheet["!freeze_panes"] = { xSplit: 0, ySplit: 1 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Rendez-vous");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

export function exportFileName(
  month: string,
  format: "csv" | "xlsx",
): string {
  return `export-rendez-vous-${month}.${format}`;
}
