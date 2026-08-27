import { describe, it, expect } from "vitest";
import { needsPdfAction, openAccessUrl } from "./source-pdf-actions";
import type { Source } from "@/types/source";

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "s1",
    studyId: "study-1",
    type: "PDF",
    sourceCategory: "FORMAL",
    originalUrl: null,
    storagePath: null,
    title: "A paper",
    authors: [],
    publicationDate: null,
    venue: null,
    doi: null,
    abstract: null,
    keywords: [],
    status: "PENDING",
    analysis: null,
    study: null,
    hasPdf: false,
    ...overrides,
  } as Source;
}

describe("needsPdfAction", () => {
  it("offers the actions for a source without a PDF", () => {
    expect(needsPdfAction(makeSource())).toBe(true);
  });

  it("hides them once the PDF is stored", () => {
    expect(needsPdfAction(makeSource({ hasPdf: true }))).toBe(false);
  });

  it("hides them for sources screened out by decision", () => {
    expect(needsPdfAction(makeSource({ finalDecision: "EXCLUDE" }))).toBe(false);
  });

  it("hides them for sources screened out by status", () => {
    expect(needsPdfAction(makeSource({ status: "EXCLUDED" }))).toBe(false);
  });

  it("does not depend on the needsPdf flag, which misses newer sources", () => {
    expect(needsPdfAction(makeSource({ needsPdf: false }))).toBe(true);
  });
});

describe("openAccessUrl", () => {
  it("returns the first link from a failed lookup", () => {
    const source = makeSource({
      metadataExtension: {
        pdfRetrieval: {
          status: "not_found",
          openAccessUrls: ["https://www.mdpi.com/1/pdf", "https://doi.org/10.3390/x"],
          attemptedAt: "2026-08-27T00:00:00Z",
        },
      },
    });

    expect(openAccessUrl(source)).toBe("https://www.mdpi.com/1/pdf");
  });

  it("returns nothing once the PDF was actually retrieved", () => {
    const source = makeSource({
      metadataExtension: {
        pdfRetrieval: {
          status: "retrieved",
          url: "https://arxiv.org/pdf/1",
          attemptedAt: "2026-08-27T00:00:00Z",
        },
      },
    });

    expect(openAccessUrl(source)).toBeUndefined();
  });

  it("returns nothing when no lookup has run", () => {
    expect(openAccessUrl(makeSource())).toBeUndefined();
    expect(
      openAccessUrl(makeSource({ metadataExtension: { database_source: "SCOPUS" } })),
    ).toBeUndefined();
  });
});
