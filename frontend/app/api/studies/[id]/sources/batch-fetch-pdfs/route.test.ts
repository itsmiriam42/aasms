import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = vi.hoisted(() => ({
  source: {
    findMany: vi.fn(),
  },
}));

const mockRetrieval = vi.hoisted(() => ({
  fetchAndStoreOpenAccessPdf: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/api-utils/pdf-retrieval", () => mockRetrieval);

import { POST } from "./route";

const routeParams = { params: Promise.resolve({ id: "study-1" }) };

function makeRequest(body?: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/studies/study-1/sources/batch-fetch-pdfs", {
    method: "POST",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

async function collectEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.substring(6)));
}

/**
 * Unscreened sources have finalDecision = null. A plain `NOT { OR }` or a
 * `{ not: "EXCLUDE" }` drops those rows entirely (verified against Postgres),
 * so the null branch must stay explicit — do not "simplify" this.
 */
const NULL_SAFE_NOT_EXCLUDED = [
  { OR: [{ finalDecision: null }, { finalDecision: { not: "EXCLUDE" } }] },
  { status: { not: "EXCLUDED" } },
];

const sourceA = { id: "s1", studyId: "study-1", title: "Paper A", hasPdf: false };
const sourceB = { id: "s2", studyId: "study-1", title: "Paper B", hasPdf: false };

describe("POST /api/studies/[id]/sources/batch-fetch-pdfs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects sources without a PDF and skips ones already screened out", async () => {
    mockPrisma.source.findMany.mockResolvedValue([]);

    await POST(makeRequest(), routeParams);

    expect(mockPrisma.source.findMany.mock.calls[0][0].where).toEqual({
      studyId: "study-1",
      hasPdf: false,
      AND: NULL_SAFE_NOT_EXCLUDED,
    });
  });

  it("restricts the run to the given source ids", async () => {
    mockPrisma.source.findMany.mockResolvedValue([]);

    await POST(makeRequest({ sourceIds: ["s1", "s2"] }), routeParams);

    expect(mockPrisma.source.findMany.mock.calls[0][0].where).toEqual({
      studyId: "study-1",
      hasPdf: false,
      AND: NULL_SAFE_NOT_EXCLUDED,
      id: { in: ["s1", "s2"] },
    });
  });

  it("streams a result per source and a summary tallying each outcome", async () => {
    mockPrisma.source.findMany.mockResolvedValue([sourceA, sourceB]);
    mockRetrieval.fetchAndStoreOpenAccessPdf
      .mockResolvedValueOnce({ status: "success", message: "Retrieved via unpaywall" })
      .mockResolvedValueOnce({ status: "error", message: "No open-access PDF found" });

    const events = await collectEvents(await POST(makeRequest(), routeParams));

    const results = events.filter((e) => e.status);
    expect(results.map((e) => [e.sourceId, e.status])).toEqual([
      ["s1", "success"],
      ["s2", "error"],
    ]);

    const complete = events.at(-1);
    expect(complete).toEqual({
      type: "complete",
      summary: { total: 2, success: 1, errors: 1, skipped: 0 },
    });
  });

  it("counts skipped sources separately from errors", async () => {
    mockPrisma.source.findMany.mockResolvedValue([sourceA]);
    mockRetrieval.fetchAndStoreOpenAccessPdf.mockResolvedValue({
      status: "skipped",
      message: "No DOI, title or URL to search with",
    });

    const events = await collectEvents(await POST(makeRequest(), routeParams));

    expect(events.at(-1).summary).toEqual({ total: 1, success: 0, errors: 0, skipped: 1 });
  });

  it("completes with an empty summary when nothing needs a PDF", async () => {
    mockPrisma.source.findMany.mockResolvedValue([]);

    const events = await collectEvents(await POST(makeRequest(), routeParams));

    expect(events).toEqual([
      { type: "complete", summary: { total: 0, success: 0, errors: 0, skipped: 0 } },
    ]);
    expect(mockRetrieval.fetchAndStoreOpenAccessPdf).not.toHaveBeenCalled();
  });

  it("stops processing when the client disconnects", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sourceA,
      id: `s${i}`,
      title: `Paper ${i}`,
    }));
    mockPrisma.source.findMany.mockResolvedValue(many);
    mockRetrieval.fetchAndStoreOpenAccessPdf.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve({ status: "skipped", message: "x" }), 1)),
    );

    const response = await POST(makeRequest(), routeParams);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    // Give the loop a chance to notice and bail out
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterCancel = mockRetrieval.fetchAndStoreOpenAccessPdf.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockRetrieval.fetchAndStoreOpenAccessPdf.mock.calls.length).toBe(afterCancel);
    expect(afterCancel).toBeLessThan(many.length);
  });

  it("returns 500 when the source lookup fails", async () => {
    mockPrisma.source.findMany.mockRejectedValue(new Error("db down"));

    const response = await POST(makeRequest(), routeParams);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Batch PDF retrieval failed" });
  });
});
