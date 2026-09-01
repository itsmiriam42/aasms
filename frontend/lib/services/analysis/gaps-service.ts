import { prisma } from "@/lib/db";
import type { GapAnalysis, SingleDimensionGap, CrossTabGap, GapCategory } from "@/types/analysis";
import { getFrequencyData } from "./frequency-service";
import { getCrossTabData } from "./crosstab-service";
import { isResidualCategory } from "./residual-categories";

/**
 * Get gap analysis for a study
 */
export async function getGapAnalysis(
  studyId: string,
  threshold: number = 3,
  facetIds?: string[],
): Promise<GapAnalysis> {
  // Get facets to analyze
  const facets = await prisma.facet.findMany({
    where: {
      studyId,
      ...(facetIds && facetIds.length > 0 ? { id: { in: facetIds } } : {}),
    },
    orderBy: { order: "asc" },
    include: {
      categories: { orderBy: { order: "asc" } },
    },
  });

  // Analyze single dimension gaps for each facet
  const singleDimensionGaps: SingleDimensionGap[] = await Promise.all(
    facets.map(async (facet) => {
      const frequencyData = await getFrequencyData(studyId, {
        type: "facet",
        facetId: facet.id,
      });

      // Catch-all categories ("Unspecified", "None stated", "Other") are not
      // research areas, so their counts are never gaps
      const substantiveItems = frequencyData.items.filter(
        (item) => !isResidualCategory(item.label),
      );

      const gaps: GapCategory[] = substantiveItems
        .filter((item) => item.count > 0 && item.count <= threshold)
        .map((item) => ({
          categoryId: item.id,
          categoryName: item.label,
          count: item.count,
        }));

      const empty = substantiveItems
        .filter((item) => item.count === 0)
        .map((item) => ({
          categoryId: item.id,
          categoryName: item.label,
        }));

      return {
        facetId: facet.id,
        facetName: facet.name,
        gaps,
        empty,
      };
    }),
  );

  // Analyze cross-tabulation gaps. OPEN_CODED facets qualify too: their coded
  // categories cross-tabulate exactly like CLOSED ones. Plain OPEN facets do
  // not — their free-text values are not a fixed category set.
  const crossTabbableFacets = facets.filter(
    (f) =>
      (f.type === "CLOSED" || f.type === "OPEN_CODED") &&
      f.categories.length > 0 &&
      f.categories.length <= 15,
  );

  const crossTabGaps: CrossTabGap[] = [];

  // Only do crosstab analysis for pairs of facets (avoid combinatorial explosion)
  for (let i = 0; i < crossTabbableFacets.length; i++) {
    for (let j = i + 1; j < crossTabbableFacets.length; j++) {
      const rowFacet = crossTabbableFacets[i];
      const colFacet = crossTabbableFacets[j];

      try {
        const crossTabData = await getCrossTabData(
          studyId,
          { type: "facet", facetId: rowFacet.id },
          { type: "facet", facetId: colFacet.id },
        );

        const residualRowIds = new Set(
          crossTabData.rowLabels.filter((r) => isResidualCategory(r.label)).map((r) => r.id),
        );
        const residualColIds = new Set(
          crossTabData.colLabels.filter((c) => isResidualCategory(c.label)).map((c) => c.id),
        );

        const rowLabelById = new Map(crossTabData.rowLabels.map((r) => [r.id, r.label]));
        const colLabelById = new Map(crossTabData.colLabels.map((c) => [c.id, c.label]));

        // Empty cells (count 0) are the strongest gap signal, so they are
        // included alongside the sparse ones
        const gaps = crossTabData.cells
          .filter(
            (cell) =>
              cell.count <= threshold &&
              !residualRowIds.has(cell.rowId) &&
              !residualColIds.has(cell.colId),
          )
          .map((cell) => ({
            rowId: cell.rowId,
            colId: cell.colId,
            rowLabel: rowLabelById.get(cell.rowId) ?? "",
            colLabel: colLabelById.get(cell.colId) ?? "",
            count: cell.count,
          }))
          .sort((a, b) => a.count - b.count);

        if (gaps.length > 0) {
          crossTabGaps.push({
            rowFacetId: rowFacet.id,
            rowFacetName: rowFacet.name,
            colFacetId: colFacet.id,
            colFacetName: colFacet.name,
            gaps,
          });
        }
      } catch (error) {
        // Skip failed crosstab analyses
        console.warn(`Failed to analyze crosstab for ${rowFacet.name} × ${colFacet.name}:`, error);
      }
    }
  }

  return {
    threshold,
    singleDimensionGaps,
    crossTabGaps,
  };
}
