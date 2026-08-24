import { describe, it, expect } from "vitest";
import {
  getSourceConfidence,
  formatConfidenceTooltip,
  isContested,
  getVotingSortValue,
  compareVotingRank,
} from "./source-confidence";

function makeSource(analysis: any) {
  return { analysis } as any;
}

describe("getSourceConfidence", () => {
  it("returns nulls when the source has no analysis", () => {
    const info = getSourceConfidence(makeSource(null));
    expect(info.confidence).toBeNull();
    expect(info.votingEnabled).toBe(false);
    expect(info.agreementRatio).toBeNull();
    expect(info.providersUsed).toEqual([]);
  });

  it("reads the confidence score for a single-LLM analysis", () => {
    const info = getSourceConfidence(
      makeSource({ confidenceScore: 0.72, votingEnabled: false, votingSummary: null }),
    );
    expect(info.confidence).toBe(0.72);
    expect(info.votingEnabled).toBe(false);
    expect(info.agreementRatio).toBeNull();
  });

  it("normalizes a camelCase voting summary", () => {
    const info = getSourceConfidence(
      makeSource({
        confidenceScore: 0.9,
        votingEnabled: true,
        votingSummary: {
          totalProviders: 3,
          providersUsed: ["claude", "openai", "gemini"],
          overallAgreementRatio: 0.83,
          unanimousDecisions: 4,
          splitDecisions: 2,
        },
      }),
    );
    expect(info.agreementRatio).toBe(0.83);
    expect(info.providersUsed).toEqual(["claude", "openai", "gemini"]);
    expect(info.unanimousDecisions).toBe(4);
    expect(info.splitDecisions).toBe(2);
  });

  it("normalizes a snake_case voting summary from the python service", () => {
    const info = getSourceConfidence(
      makeSource({
        confidenceScore: 0.55,
        votingEnabled: true,
        votingSummary: {
          total_providers: 2,
          providers_used: ["claude", "gemini"],
          overall_agreement_ratio: 0.5,
          unanimous_decisions: 1,
          split_decisions: 3,
        },
      }),
    );
    expect(info.confidence).toBe(0.55);
    expect(info.agreementRatio).toBe(0.5);
    expect(info.providersUsed).toEqual(["claude", "gemini"]);
    expect(info.unanimousDecisions).toBe(1);
    expect(info.splitDecisions).toBe(3);
  });

  it("ignores a non-numeric confidence score", () => {
    const info = getSourceConfidence(makeSource({ confidenceScore: null, votingEnabled: true }));
    expect(info.confidence).toBeNull();
  });

});

const voted = (agreement: number, splits: number, confidence = 0.96) =>
  getSourceConfidence(
    makeSource({
      confidenceScore: confidence,
      votingEnabled: true,
      votingSummary: { overallAgreementRatio: agreement, splitDecisions: splits },
    }),
  );

describe("isContested", () => {
  it("is true when at least one criterion split", () => {
    expect(isContested(voted(0.91, 3))).toBe(true);
  });

  it("is false for a unanimous vote", () => {
    expect(isContested(voted(1, 0))).toBe(false);
  });

  it("is false without voting or without an analysis", () => {
    expect(isContested(getSourceConfidence(makeSource({ confidenceScore: 0.9 })))).toBe(false);
    expect(isContested(getSourceConfidence(makeSource(null)))).toBe(false);
  });
});

describe("getVotingSortValue", () => {
  it("ranks on the agreement ratio", () => {
    expect(getVotingSortValue(voted(0.85, 5))).toBe(0.85);
  });

  it("is undefined without voting, so those sources sort last", () => {
    expect(
      getVotingSortValue(getSourceConfidence(makeSource({ confidenceScore: 0.9 }))),
    ).toBeUndefined();
    expect(getVotingSortValue(getSourceConfidence(makeSource(null)))).toBeUndefined();
  });
});

describe("compareVotingRank", () => {
  it("orders least agreement first", () => {
    expect(compareVotingRank(voted(0.79, 7), voted(1, 0))).toBeLessThan(0);
    expect(compareVotingRank(voted(1, 0), voted(0.79, 7))).toBeGreaterThan(0);
  });

  it("breaks ties on confidence", () => {
    expect(compareVotingRank(voted(0.91, 3, 0.93), voted(0.91, 3, 0.97))).toBeLessThan(0);
  });

  it("sorts a mixed list most-contested first", () => {
    const ranked = [voted(1, 0), voted(0.85, 5), voted(0.97, 1)].sort(compareVotingRank);
    expect(ranked.map((r) => r.splitDecisions)).toEqual([5, 1, 0]);
  });
});

describe("formatConfidenceTooltip", () => {
  it("describes an unanalyzed source", () => {
    expect(formatConfidenceTooltip(getSourceConfidence(makeSource(null)))).toBe(
      "Not analyzed yet",
    );
  });

  it("includes voters and agreement when voting ran", () => {
    const tooltip = formatConfidenceTooltip(
      getSourceConfidence(
        makeSource({
          confidenceScore: 0.9,
          votingEnabled: true,
          votingSummary: {
            providers_used: ["claude", "openai"],
            overall_agreement_ratio: 1,
            unanimous_decisions: 5,
            split_decisions: 0,
          },
        }),
      ),
    );
    expect(tooltip).toContain("Confidence: 90%");
    expect(tooltip).toContain("Voters: claude, openai");
    expect(tooltip).toContain("Agreement: 100%");
    expect(tooltip).toContain("5 unanimous · 0 split");
  });

  it("marks single-LLM analyses", () => {
    const tooltip = formatConfidenceTooltip(
      getSourceConfidence(makeSource({ confidenceScore: 0.6, votingEnabled: false })),
    );
    expect(tooltip).toContain("Single-LLM analysis (no voting)");
  });
});
