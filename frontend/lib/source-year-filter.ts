import type { Source } from "@/types/source";

export interface YearOption {
  /** Publication year, or null for sources without a usable date. */
  year: number | null;
  /** Number of sources falling into this year. */
  count: number;
}

/** Inclusive year bounds. `null` on either side means unbounded. */
export interface YearRange {
  from: number | null;
  to: number | null;
}

export const EMPTY_YEAR_RANGE: YearRange = { from: null, to: null };

type YearSource = Pick<Source, "publicationDate">;

/** Extracts the publication year, tolerating missing and unparseable dates. */
export function getSourceYear(source: YearSource): number | null {
  if (!source.publicationDate) return null;
  const year = new Date(source.publicationDate).getFullYear();
  return Number.isFinite(year) ? year : null;
}

export function isYearRangeActive(range: YearRange): boolean {
  return range.from !== null || range.to !== null;
}

/**
 * Counts sources per publication year, oldest first, with unknown years last.
 */
export function buildYearOptions(sources: YearSource[]): YearOption[] {
  const counts = new Map<number | null, number>();

  for (const source of sources) {
    const year = getSourceYear(source);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return a.year - b.year;
    });
}

/** True when the year falls inside the inclusive range (reversed bounds are normalized). */
export function isYearInRange(year: number | null, range: YearRange): boolean {
  if (!isYearRangeActive(range)) return true;
  if (year === null) return false;

  const [low, high] =
    range.from !== null && range.to !== null && range.from > range.to
      ? [range.to, range.from]
      : [range.from, range.to];

  if (low !== null && year < low) return false;
  if (high !== null && year > high) return false;
  return true;
}

/**
 * Keeps sources whose publication year lies within the inclusive range.
 * An empty range keeps everything; once a bound is set, sources without a
 * publication year drop out because they cannot be placed in the range.
 */
export function filterSourcesByYearRange<T extends YearSource>(
  sources: T[],
  range: YearRange,
): T[] {
  if (!isYearRangeActive(range)) return sources;
  return sources.filter((source) => isYearInRange(getSourceYear(source), range));
}
