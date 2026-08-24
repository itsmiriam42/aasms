import { describe, it, expect } from "vitest";
import {
  getSourceYear,
  buildYearOptions,
  filterSourcesByYearRange,
  isYearInRange,
  isYearRangeActive,
  EMPTY_YEAR_RANGE,
} from "./source-year-filter";

const src = (publicationDate: string | null) => ({ publicationDate });

describe("getSourceYear", () => {
  it("reads the year from a publication date", () => {
    expect(getSourceYear(src("2023-06-01"))).toBe(2023);
  });

  it("returns null for a missing date", () => {
    expect(getSourceYear(src(null))).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(getSourceYear(src("not-a-date"))).toBeNull();
  });
});

describe("buildYearOptions", () => {
  it("counts sources per year, oldest first with unknown years last", () => {
    const options = buildYearOptions([
      src("2021-01-01"),
      src("2023-05-01"),
      src("2021-09-01"),
      src(null),
      src("2025-02-01"),
      src("2021-12-31"),
    ]);

    expect(options).toEqual([
      { year: 2021, count: 3 },
      { year: 2023, count: 1 },
      { year: 2025, count: 1 },
      { year: null, count: 1 },
    ]);
  });

  it("returns an empty list for no sources", () => {
    expect(buildYearOptions([])).toEqual([]);
  });
});

describe("isYearRangeActive", () => {
  it("is inactive when both bounds are unset", () => {
    expect(isYearRangeActive(EMPTY_YEAR_RANGE)).toBe(false);
  });

  it("is active with a single bound", () => {
    expect(isYearRangeActive({ from: 2020, to: null })).toBe(true);
    expect(isYearRangeActive({ from: null, to: 2020 })).toBe(true);
  });
});

describe("isYearInRange", () => {
  it("includes both bounds", () => {
    expect(isYearInRange(2020, { from: 2020, to: 2023 })).toBe(true);
    expect(isYearInRange(2023, { from: 2020, to: 2023 })).toBe(true);
  });

  it("excludes years outside the bounds", () => {
    expect(isYearInRange(2019, { from: 2020, to: 2023 })).toBe(false);
    expect(isYearInRange(2024, { from: 2020, to: 2023 })).toBe(false);
  });

  it("normalizes reversed bounds", () => {
    expect(isYearInRange(2021, { from: 2023, to: 2020 })).toBe(true);
    expect(isYearInRange(2019, { from: 2023, to: 2020 })).toBe(false);
  });

  it("keeps unknown years only while no range is set", () => {
    expect(isYearInRange(null, EMPTY_YEAR_RANGE)).toBe(true);
    expect(isYearInRange(null, { from: 2020, to: null })).toBe(false);
  });
});

describe("filterSourcesByYearRange", () => {
  const sources = [src("2019-01-01"), src("2021-01-01"), src("2023-01-01"), src(null)];

  it("returns every source when no bound is set", () => {
    expect(filterSourcesByYearRange(sources, EMPTY_YEAR_RANGE)).toHaveLength(4);
  });

  it("filters to an inclusive range and drops undated sources", () => {
    const result = filterSourcesByYearRange(sources, { from: 2019, to: 2021 });
    expect(result.map((s) => s.publicationDate)).toEqual(["2019-01-01", "2021-01-01"]);
  });

  it("supports an open-ended lower bound", () => {
    const result = filterSourcesByYearRange(sources, { from: null, to: 2019 });
    expect(result.map((s) => s.publicationDate)).toEqual(["2019-01-01"]);
  });

  it("supports an open-ended upper bound", () => {
    const result = filterSourcesByYearRange(sources, { from: 2021, to: null });
    expect(result.map((s) => s.publicationDate)).toEqual(["2021-01-01", "2023-01-01"]);
  });

  it("returns nothing for a range with no sources", () => {
    expect(filterSourcesByYearRange(sources, { from: 2030, to: 2035 })).toEqual([]);
  });
});
