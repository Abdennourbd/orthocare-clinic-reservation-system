import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildExportRows,
  exportFileName,
  exportHeaders,
  getClinicMonthBoundsUTC,
  toCSV,
  toXLSX,
  type ExportAppointmentInput,
} from "./appointments";

// Task 19 — pure export builders: month bounds, row shaping (notes opt-in),
// CSV escaping/BOM, XLSX round-trip.

function sampleInput(overrides: Partial<ExportAppointmentInput> = {}): ExportAppointmentInput {
  return {
    id: "a1",
    startTime: new Date("2026-09-05T09:00:00.000Z"),
    endTime: new Date("2026-09-05T09:30:00.000Z"),
    status: "CONFIRMED",
    source: "ONLINE",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    confirmedAt: new Date("2026-09-01T10:00:00.000Z"),
    cancelledAt: null,
    cancelReason: null,
    visitNotes: "Note sensible",
    patient: {
      firstName: "Sara",
      lastName: "Benali",
      phone: "0550111222",
      phoneE164: "+213550111222",
    },
    service: { name: { fr: "Consultation" }, durationMinutes: 30 },
    ...overrides,
  };
}

describe("getClinicMonthBoundsUTC", () => {
  it("covers the full clinic-local month (Sept 2026 → 30 days)", () => {
    const { startUTC, endUTC, from, to } = getClinicMonthBoundsUTC("2026-09");
    expect(from).toBe("2026-09-01");
    expect(to).toBe("2026-09-30");
    // 2026-09-01 00:00 clinic-local = 2026-08-31T23:00Z (UTC+1, no DST).
    expect(startUTC.toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(endUTC.toISOString()).toBe("2026-09-30T22:59:59.999Z");
  });

  it("handles February in a leap year (2028 → 29 days)", () => {
    const { from, to } = getClinicMonthBoundsUTC("2028-02");
    expect(from).toBe("2028-02-01");
    expect(to).toBe("2028-02-29");
  });
});

describe("buildExportRows", () => {
  it("shapes clinic-local date/time + E.164 phone + FR service name", () => {
    const [row] = buildExportRows([sampleInput()], { includeNotes: false });
    // 09:00Z = 10:00 clinic-local.
    expect(row["Date"]).toBe("2026-09-05");
    expect(row["Heure"]).toBe("10:00");
    expect(row["Patient"]).toBe("Sara Benali");
    expect(row["Téléphone"]).toBe("+213550111222");
    expect(row["Service"]).toBe("Consultation");
    expect(row["Durée (min)"]).toBe("30");
    expect(row["Statut"]).toBe("CONFIRMED");
  });

  it("excludes clinical notes by default, includes them on explicit opt-in", () => {
    const [without] = buildExportRows([sampleInput()], { includeNotes: false });
    expect(without).not.toHaveProperty("Notes cliniques");
    expect(exportHeaders(false)).not.toContain("Notes cliniques");

    const [withNotes] = buildExportRows([sampleInput()], { includeNotes: true });
    expect(withNotes["Notes cliniques"]).toBe("Note sensible");
    expect(exportHeaders(true)).toContain("Notes cliniques");
  });

  it("falls back to the as-typed phone when E.164 is missing", () => {
    const [row] = buildExportRows(
      [sampleInput({ patient: { firstName: "A", lastName: "B", phone: "0550", phoneE164: "" } })],
      { includeNotes: false },
    );
    expect(row["Téléphone"]).toBe("0550");
  });
});

describe("toCSV", () => {
  it("starts with a UTF-8 BOM and uses ; delimiters", () => {
    const csv = toCSV(buildExportRows([sampleInput()], { includeNotes: false }), false);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Date;Heure;Patient");
  });

  it("quotes cells holding the delimiter, quotes or newlines (RFC 4180)", () => {
    const csv = toCSV(
      buildExportRows(
        [
          sampleInput({
            patient: { firstName: 'Sa"ra', lastName: "Be;nali", phone: "0550", phoneE164: "+213550" },
            visitNotes: "ligne1\nligne2",
          }),
        ],
        { includeNotes: true },
      ),
      true,
    );
    expect(csv).toContain('"Sa""ra Be;nali"');
    expect(csv).toContain('"ligne1\nligne2"');
  });

  it("neutralizes spreadsheet formula injection (OWASP CSV injection)", () => {
    const csv = toCSV(
      buildExportRows(
        [
          sampleInput({
            patient: { firstName: "=HYPERLINK(", lastName: "evil", phone: "0550", phoneE164: "+213550" },
          }),
          sampleInput({
            patient: { firstName: "+cmd", lastName: "x", phone: "0550", phoneE164: "@x" },
          }),
        ],
        { includeNotes: false },
      ),
      false,
    );
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain("'+cmd");
    expect(csv).not.toMatch(/[;\r\n]=HYPERLINK/);
  });
});

describe("toXLSX", () => {
  it("round-trips headers + rows through a real workbook", () => {
    const rows = buildExportRows([sampleInput()], { includeNotes: false });
    const buffer = toXLSX(rows, false);
    expect(buffer.length).toBeGreaterThan(0);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(aoa[0]).toEqual(exportHeaders(false));
    expect(aoa).toHaveLength(2);
    expect(aoa[1][2]).toBe("Sara Benali");
  });
});

describe("exportFileName", () => {
  it("builds a safe attachment filename from the validated month", () => {
    expect(exportFileName("2026-09", "csv")).toBe("export-rendez-vous-2026-09.csv");
    expect(exportFileName("2026-09", "xlsx")).toBe("export-rendez-vous-2026-09.xlsx");
  });
});
