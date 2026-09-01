import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  source: {
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
  },
  facet: { findMany: vi.fn() },
  importBatch: { aggregate: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { getSummaryStats } from "./summary-service";

/**
 * The corpus counts are driven purely by the `where` clause of each
 * `source.count` call, so the fake resolves counts from a tiny in-memory
 * corpus instead of hard-coding call order.
 */
type Row = {
  status: string;
  finalDecision: string | null;
  sourceCategory: string;
  importBatchId: string | null;
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  if (where.OR) {
    return (where.OR as Record<string, unknown>[]).some((clause) => matches(row, clause));
  }
  if (where.status !== undefined && row.status !== where.status) return false;
  if (where.finalDecision !== undefined && row.finalDecision !== where.finalDecision) return false;
  if (where.sourceCategory !== undefined && row.sourceCategory !== where.sourceCategory) return false;
  if (where.importBatchId !== undefined && row.importBatchId !== where.importBatchId) return false;
  return true;
}

function setupCorpus(corpus: Row[]) {
  mockPrisma.source.count.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    // The facet-coverage query nests through `analysis`; it is not exercised here.
    if (where.analysis) return Promise.resolve(0);
    return Promise.resolve(corpus.filter((row) => matches(row, where)).length);
  });
  mockPrisma.source.aggregate.mockResolvedValue({
    _min: { publicationDate: null },
    _max: { publicationDate: null },
  });
  mockPrisma.source.groupBy.mockResolvedValue([]);
  mockPrisma.source.findMany.mockResolvedValue([]);
  mockPrisma.facet.findMany.mockResolvedValue([]);
  mockPrisma.importBatch.aggregate.mockResolvedValue({
    _sum: { totalRecords: 1908, duplicates: 720 },
  });
}

const included = (over: Partial<Row> = {}): Row => ({
  status: "CLASSIFIED",
  finalDecision: "INCLUDE",
  sourceCategory: "FORMAL",
  importBatchId: "batch-1",
  ...over,
});

describe("getSummaryStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts exclusions marked only by status, not finalDecision", async () => {
    // Batch screening writes status=EXCLUDED and leaves finalDecision NULL.
    setupCorpus([
      included(),
      included(),
      { status: "EXCLUDED", finalDecision: null, sourceCategory: "FORMAL", importBatchId: "batch-1" },
      { status: "EXCLUDED", finalDecision: null, sourceCategory: "FORMAL", importBatchId: "batch-1" },
      { status: "EXCLUDED", finalDecision: null, sourceCategory: "FORMAL", importBatchId: "batch-1" },
    ]);

    const stats = await getSummaryStats("study-1");

    expect(stats.excludedSources).toBe(3);
    expect(stats.includedSources).toBe(2);
    // Screened must reconcile with the corpus, not collapse to the included count.
    expect(stats.includedSources + stats.excludedSources).toBe(stats.totalSources);
  });

  it("does not double-count exclusions marked by both fields", async () => {
    setupCorpus([
      included(),
      { status: "EXCLUDED", finalDecision: "EXCLUDE", sourceCategory: "FORMAL", importBatchId: "batch-1" },
      { status: "ANALYZED", finalDecision: "EXCLUDE", sourceCategory: "FORMAL", importBatchId: "batch-1" },
    ]);

    const stats = await getSummaryStats("study-1");

    expect(stats.excludedSources).toBe(2);
  });

  it("reports sources added outside a database import separately", async () => {
    setupCorpus([
      included(),
      included({ importBatchId: null }),
      included({ importBatchId: null, sourceCategory: "GREY" }),
    ]);

    const stats = await getSummaryStats("study-1");

    expect(stats.prismaFlow).toEqual({
      totalRecordsIdentified: 1908,
      duplicatesRemoved: 720,
      otherSourcesIdentified: 2,
    });
  });

  it("falls back to the source count when no import batches exist", async () => {
    setupCorpus([included(), included()]);
    mockPrisma.importBatch.aggregate.mockResolvedValue({
      _sum: { totalRecords: null, duplicates: null },
    });

    const stats = await getSummaryStats("study-1");

    expect(stats.prismaFlow.totalRecordsIdentified).toBe(2);
    expect(stats.prismaFlow.duplicatesRemoved).toBe(0);
  });
});
