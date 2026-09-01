import { describe, it, expect } from "vitest";
import { isResidualCategory } from "./residual-categories";

describe("isResidualCategory", () => {
  it("matches catch-all labels regardless of case and spacing", () => {
    const residual = [
      "Unspecified",
      "unknown",
      "Unclear",
      "None stated",
      "  none  ",
      "Not specified",
      "Not applicable",
      "N/A",
      "Other",
      "Others",
      "Mixed or other",
      "Misc / other",
      "Various",
    ];
    for (const label of residual) {
      expect(isResidualCategory(label), label).toBe(true);
    }
  });

  it("does not match substantive categories", () => {
    const substantive = [
      "Platoon control",
      "Mixed V2X",
      "Unattributed central authority",
      "Cloud or remote compute",
      "None, single locus",
      "Other-vehicle intent prediction",
      "Logistics and operations",
      "Safety guarantee",
    ];
    for (const label of substantive) {
      expect(isResidualCategory(label), label).toBe(false);
    }
  });

  it("treats missing or blank labels as non-residual", () => {
    expect(isResidualCategory(null)).toBe(false);
    expect(isResidualCategory(undefined)).toBe(false);
    expect(isResidualCategory("   ")).toBe(false);
  });
});
