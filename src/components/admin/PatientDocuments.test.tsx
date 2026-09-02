// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import PatientDocuments from "./PatientDocuments";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/mime";

// Task 15 step 5 (ortho-tester) — component coverage for the documents
// panel. Only the network layer is mocked (the fixture rule's spirit); the
// upload requests are asserted at their REAL shape — a multipart FormData
// carrying `name`, `declaredMimeType` and `file` exactly as the POST route
// reads them — and every validation rule exercised here is the production
// one, imported from the single sources of truth (documentUploadSchema /
// MAX_DOCUMENT_BYTES), never a test-local copy.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "doc-1",
    name: "radio-dentaire.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2048,
    uploadedAt: "2026-09-01T10:00:00.000Z",
    uploadedBy: "Dr Amrani",
    ...overrides,
  };
}

/** Queued responses per `METHOD url` — the first GET list, then whatever the
 * list looks like after the operation under test refreshes it. */
type HandlerMap = Record<string, Array<() => Response>>;

let calls: Array<{ url: string; init?: RequestInit }>;

function installFetch(handlers: HandlerMap) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ url, init });
      const queue = handlers[key];
      if (!queue || queue.length === 0) throw new Error(`fetch inattendu : ${key}`);
      return queue.shift()!();
    },
  );
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderWithList(items: unknown[] = []) {
  installFetch({ "GET /api/admin/patients/patient-1/documents": [() => fetchOnce(200, { items, total: items.length })] });
  render(<PatientDocuments patientId="patient-1" role="ADMIN" />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
}

describe("PatientDocuments — upload happy path", () => {
  it("posts a multipart FormData with name + declaredMimeType + file, then refreshes the list", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "radio.jpg", {
      type: "image/jpeg",
    });
    installFetch({
      "GET /api/admin/patients/patient-1/documents": [
        () => fetchOnce(200, { items: [], total: 0 }),
        () => fetchOnce(200, { items: [makeItem()], total: 1 }),
      ],
      "POST /api/admin/patients/patient-1/documents": [() => fetchOnce(201, makeItem())],
    });

    render(<PatientDocuments patientId="patient-1" role="ADMIN" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "radio-dentaire.jpg" },
    });
    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [jpeg] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    const { url, init } = calls[1];
    expect(url).toBe("/api/admin/patients/patient-1/documents");
    expect(init?.method).toBe("POST");
    const formData = init?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("name")).toBe("radio-dentaire.jpg");
    expect(formData.get("declaredMimeType")).toBe("image/jpeg");
    expect(formData.get("file")).toBe(jpeg);

    // The list was refreshed after the upload — the new document appears.
    expect(await screen.findByText("radio-dentaire.jpg")).toBeInTheDocument();
    expect(calls[2].url).toBe("/api/admin/patients/patient-1/documents");
    expect(calls[2].init?.method).toBeUndefined();
  });
});

describe("PatientDocuments — client-side rejection (no network call)", () => {
  it("rejects an oversized file with the size message and never POSTs", async () => {
    const oversized = new File(
      [new ArrayBuffer(MAX_DOCUMENT_BYTES + 1)],
      "gros-fichier.jpg",
      { type: "image/jpeg" },
    );
    await renderWithList();

    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "gros-fichier.jpg" },
    });
    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [oversized] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    // Only the initial list GET ever fired.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/taille maximale de 4 Mo/)).toBeInTheDocument();
  });

  it("rejects a name with a forbidden path separator and never POSTs", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "radio.jpg", {
      type: "image/jpeg",
    });
    await renderWithList();

    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "radio/secret.jpg" },
    });
    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [jpeg] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Le nom du fichier contient des caractères non autorisés."),
    ).toBeInTheDocument();
  });

  it("rejects an empty name and never POSTs", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "radio.jpg", {
      type: "image/jpeg",
    });
    await renderWithList();

    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [jpeg] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Le nom du fichier est requis.")).toBeInTheDocument();
  });

  it("rejects a submit with no file selected via the component's own `if (!file)` branch and never POSTs", async () => {
    await renderWithList();

    // A valid name but NO file selected — this must short-circuit on the
    // component's explicit file-presence check, before the shared schema
    // (which cannot see the file) is ever consulted.
    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "radio-dentaire.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    // Only the initial list GET ever fired — no upload POST.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Le fichier est requis.")).toBeInTheDocument();
  });

  it("rejects a file type outside the shared allow-list and never POSTs", async () => {
    const html = new File(["<script>"], "piège.html", { type: "text/html" });
    await renderWithList();

    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "piège.html" },
    });
    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [html] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Type de fichier non autorisé.")).toBeInTheDocument();
  });
});

describe("PatientDocuments — delete flow", () => {
  it("requires an explicit confirmation before DELETE, then refreshes the list", async () => {
    installFetch({
      "GET /api/admin/patients/patient-1/documents": [
        () => fetchOnce(200, { items: [makeItem()], total: 1 }),
        () => fetchOnce(200, { items: [], total: 0 }),
      ],
      "DELETE /api/admin/documents/doc-1": [() => fetchOnce(200, { blobDeleted: true })],
    });

    render(<PatientDocuments patientId="patient-1" role="ADMIN" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("radio-dentaire.jpg")).toBeInTheDocument();

    // Step 1 — arming the confirm does NOT call DELETE yet.
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Supprimer définitivement ce document/),
    ).toBeInTheDocument();

    // Step 2 — the confirm button fires DELETE, then the list reloads.
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    expect(calls[1].url).toBe("/api/admin/documents/doc-1");
    expect(calls[1].init?.method).toBe("DELETE");
    expect(await screen.findByText("Aucun document pour ce patient.")).toBeInTheDocument();
    expect(screen.queryByText("radio-dentaire.jpg")).toBeNull();
  });

  it("cancels the delete on Annuler without firing DELETE or refreshing the list", async () => {
    await renderWithList([makeItem()]);

    // Arm the confirm — no network call expected on arming (same guarantee
    // as the confirm test above).
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(
      screen.getByText(/Supprimer définitivement ce document/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    // The confirm banner disappears, the document row survives, and ONLY
    // the initial list GET ever fired — no DELETE, no list refresh.
    expect(
      screen.queryByText(/Supprimer définitivement ce document/),
    ).toBeNull();
    expect(screen.getByText("radio-dentaire.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a generic error when the delete 404s (document already gone)", async () => {
    installFetch({
      // Only the initial GET is queued — the 404 path never refreshes the
      // list (deleteError is shown inside the still-armed confirm banner).
      "GET /api/admin/patients/patient-1/documents": [
        () => fetchOnce(200, { items: [makeItem()], total: 1 }),
      ],
      "DELETE /api/admin/documents/doc-1": [
        () => fetchOnce(404, { error: { code: "NOT_FOUND", message: "Document introuvable." } }),
      ],
    });

    render(<PatientDocuments patientId="patient-1" role="ADMIN" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));

    // findByText, not findByRole("alert") — the confirm banner itself is an
    // alert, so the role query resolves too early.
    expect(await screen.findByText("Document introuvable.")).toBeInTheDocument();
    // The document stays listed — nothing was deleted.
    expect(screen.getByText("radio-dentaire.jpg")).toBeInTheDocument();
  });
});

describe("PatientDocuments — error and role rendering", () => {
  it("surfaces the server's French error message on a failed upload", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "radio.jpg", {
      type: "image/jpeg",
    });
    installFetch({
      "GET /api/admin/patients/patient-1/documents": [() => fetchOnce(200, { items: [], total: 0 })],
      "POST /api/admin/patients/patient-1/documents": [
        () =>
          fetchOnce(415, {
            error: { code: "DOCUMENT_TYPE_NOT_ALLOWED", message: "Type de fichier non autorisé." },
          }),
      ],
    });

    render(<PatientDocuments patientId="patient-1" role="ADMIN" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Nom du document"), {
      target: { value: "radio.jpg" },
    });
    fireEvent.change(screen.getByLabelText("Fichier"), { target: { files: [jpeg] } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le document" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Type de fichier non autorisé.");
  });

  it("hides the delete button for a RECEPTIONIST (upload/list remain available)", async () => {
    installFetch({
      "GET /api/admin/patients/patient-1/documents": [
        () => fetchOnce(200, { items: [makeItem()], total: 1 }),
      ],
    });
    render(<PatientDocuments patientId="patient-1" role="RECEPTIONIST" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(screen.getByText("radio-dentaire.jpg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Télécharger" })).toHaveAttribute(
      "href",
      "/api/admin/documents/doc-1",
    );
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull();
  });

  it("never renders the document name as a download URL segment other than the document id (no blobKey leak surface)", async () => {
    await renderWithList([makeItem({ name: "radio-dentaire.jpg" })]);
    const link = screen.getByRole("link", { name: "Télécharger" });
    expect(link.getAttribute("href")).toBe("/api/admin/documents/doc-1");
    expect(link.getAttribute("href")).not.toContain("blob");
  });
});
