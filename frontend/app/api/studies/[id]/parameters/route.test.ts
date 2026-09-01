import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = vi.hoisted(() => {
  const collection = () => ({ deleteMany: vi.fn(), createMany: vi.fn() });
  const p = {
    study: { findUnique: vi.fn() },
    studyParameters: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    formalSource: collection(),
    greySource: collection(),
    inclusionCriterion: collection(),
    exclusionCriterion: collection(),
    $transaction: vi.fn(),
  };
  // Interactive transaction: run the callback against the same mock client.
  p.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(p));
  return p;
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

import { POST } from "./route";

const routeParams = { params: Promise.resolve({ id: "study-1" }) };

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/studies/study-1/parameters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/studies/[id]/parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockPrisma),
    );
    mockPrisma.study.findUnique.mockResolvedValue({ id: "study-1" });
    mockPrisma.studyParameters.upsert.mockResolvedValue({
      id: "params-1",
      studyId: "study-1",
      picoPopulation: "Existing population",
    });
    mockPrisma.studyParameters.findUnique.mockResolvedValue({
      id: "params-1",
      studyId: "study-1",
      picoPopulation: "Existing population",
      formalSources: [{ id: "fs-1", name: "Scopus" }],
      greySources: [],
      inclusionCriteria: [{ id: "ic-1", criterion: "Must be primary research", order: 0 }],
      exclusionCriteria: [],
    });
  });

  it("saving criteria only replaces criteria and never deletes the parameters row", async () => {
    const response = await POST(
      makeRequest({
        inclusionCriteria: [{ criterion: "Must be primary research", order: 0 }],
        exclusionCriteria: [],
      }),
      routeParams,
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.studyParameters.delete).not.toHaveBeenCalled();
    expect(mockPrisma.studyParameters.upsert).toHaveBeenCalledWith({
      where: { studyId: "study-1" },
      create: { studyId: "study-1" },
      update: {},
    });

    // Criteria are replaced
    expect(mockPrisma.inclusionCriterion.deleteMany).toHaveBeenCalledWith({
      where: { parametersId: "params-1" },
    });
    expect(mockPrisma.inclusionCriterion.createMany).toHaveBeenCalledWith({
      data: [{ parametersId: "params-1", criterion: "Must be primary research", order: 0 }],
    });
    expect(mockPrisma.exclusionCriterion.deleteMany).toHaveBeenCalledWith({
      where: { parametersId: "params-1" },
    });
    expect(mockPrisma.exclusionCriterion.createMany).not.toHaveBeenCalled();

    // Search protocol data (formal/grey sources) is left alone
    expect(mockPrisma.formalSource.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.formalSource.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.greySource.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.greySource.createMany).not.toHaveBeenCalled();

    // Response reflects the untouched fields
    const json = await response.json();
    expect(json.data.picoPopulation).toBe("Existing population");
    expect(json.data.formalSources).toHaveLength(1);
  });

  it("saving formal sources leaves criteria untouched", async () => {
    await POST(
      makeRequest({
        formalSources: [{ name: "IEEE Xplore", type: "ACADEMIC_DATABASE", searchString: "q" }],
      }),
      routeParams,
    );

    expect(mockPrisma.formalSource.deleteMany).toHaveBeenCalledWith({
      where: { parametersId: "params-1" },
    });
    expect(mockPrisma.formalSource.createMany).toHaveBeenCalledWith({
      data: [
        {
          parametersId: "params-1",
          name: "IEEE Xplore",
          type: "ACADEMIC_DATABASE",
          searchString: "q",
          dateRange: undefined,
        },
      ],
    });
    expect(mockPrisma.inclusionCriterion.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.exclusionCriterion.deleteMany).not.toHaveBeenCalled();
  });

  it("never writes PICO fields", async () => {
    await POST(
      makeRequest({ inclusionCriteria: [{ criterion: "x", order: 0 }] }),
      routeParams,
    );
    const upsertArg = mockPrisma.studyParameters.upsert.mock.calls[0][0];
    expect(upsertArg.update).toEqual({});
    expect(upsertArg.create).toEqual({ studyId: "study-1" });
  });

  it("returns 404 when the study does not exist", async () => {
    mockPrisma.study.findUnique.mockResolvedValue(null);
    const response = await POST(makeRequest({ inclusionCriteria: [] }), routeParams);
    expect(response.status).toBe(404);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid body", async () => {
    const response = await POST(
      makeRequest({ formalSources: [{ name: "X", type: "NOT_A_TYPE" }] }),
      routeParams,
    );
    expect(response.status).toBe(400);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
