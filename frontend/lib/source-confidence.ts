import type { Source, SourceAnalysisSummary } from "@/types/source";

/**
 * Voting/confidence info derived from a source's analysis.
 *
 * `confidence` is the analysis-level confidence score (0-1). When multi-LLM
 * voting ran, it is the mean of the per-criterion aggregated vote confidences,
 * so it doubles as the confidence of the LLM voting.
 */
export interface SourceConfidence {
  confidence: number | null;
  votingEnabled: boolean;
  agreementRatio: number | null;
  providersUsed: string[];
  unanimousDecisions: number | null;
  splitDecisions: number | null;
}

const EMPTY: SourceConfidence = {
  confidence: null,
  votingEnabled: false,
  agreementRatio: null,
  providersUsed: [],
  unanimousDecisions: null,
  splitDecisions: null,
};

function pickNumber(summary: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Normalizes the analysis confidence and voting summary (which may arrive in
 * camelCase from the frontend or snake_case from the python service).
 */
export function getSourceConfidence(
  source: Pick<Source, "analysis"> | { analysis?: SourceAnalysisSummary | null },
): SourceConfidence {
  const analysis = source.analysis;
  if (!analysis) return EMPTY;

  const confidence =
    typeof analysis.confidenceScore === "number" && Number.isFinite(analysis.confidenceScore)
      ? analysis.confidenceScore
      : null;

  const summary = (analysis.votingSummary ?? null) as Record<string, unknown> | null;
  const providersRaw = summary
    ? summary.providersUsed ?? summary.providers_used
    : undefined;

  return {
    confidence,
    votingEnabled: Boolean(analysis.votingEnabled),
    agreementRatio: summary
      ? pickNumber(summary, "overallAgreementRatio", "overall_agreement_ratio")
      : null,
    providersUsed: Array.isArray(providersRaw) ? (providersRaw as string[]) : [],
    unanimousDecisions: summary
      ? pickNumber(summary, "unanimousDecisions", "unanimous_decisions")
      : null,
    splitDecisions: summary ? pickNumber(summary, "splitDecisions", "split_decisions") : null,
  };
}

/**
 * True when the LLMs disagreed on at least one criterion. These are the
 * sources where the ensemble did not reach consensus on its own.
 */
export function isContested(info: SourceConfidence): boolean {
  return info.votingEnabled && info.splitDecisions !== null && info.splitDecisions > 0;
}

/**
 * Sort key for the voting column: the inter-LLM agreement ratio. Sources
 * analyzed without voting have no agreement to rank on and sort last.
 */
export function getVotingSortValue(info: SourceConfidence): number | undefined {
  if (!info.votingEnabled || info.agreementRatio === null) return undefined;
  return info.agreementRatio;
}

/**
 * Ascending comparator: least agreement (most contested) first, with
 * confidence breaking ties inside an agreement bucket.
 */
export function compareVotingRank(a: SourceConfidence, b: SourceConfidence): number {
  const agreementDiff = (a.agreementRatio ?? 0) - (b.agreementRatio ?? 0);
  if (agreementDiff !== 0) return agreementDiff;
  return (a.confidence ?? 0) - (b.confidence ?? 0);
}

/** Human-readable tooltip describing how the decision was reached. */
export function formatConfidenceTooltip(info: SourceConfidence): string {
  if (info.confidence === null) return "Not analyzed yet";

  const parts: string[] = [];
  if (info.votingEnabled) {
    if (info.agreementRatio !== null) {
      parts.push(`Agreement: ${(info.agreementRatio * 100).toFixed(0)}%`);
    }
    if (info.unanimousDecisions !== null && info.splitDecisions !== null) {
      parts.push(`${info.unanimousDecisions} unanimous · ${info.splitDecisions} split`);
    }
    if (info.providersUsed.length > 0) {
      parts.push(`Voters: ${info.providersUsed.join(", ")}`);
    }
  } else {
    parts.push("Single-LLM analysis (no voting)");
  }
  parts.push(`Confidence: ${(info.confidence * 100).toFixed(0)}%`);
  return parts.join("\n");
}
