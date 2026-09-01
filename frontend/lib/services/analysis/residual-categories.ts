/**
 * "Residual" categories are the catch-all buckets a facet needs so every source
 * can be classified — "Unspecified", "None stated", "Other", "Unknown".
 *
 * They are not research areas, so a low or zero count in one of them is not a
 * research gap — it only says the papers were silent on the attribute, or fell
 * outside the scheme. Gap analysis therefore excludes them, both as
 * single-dimension gaps and as either side of a cross-facet gap.
 */
const RESIDUAL_PATTERNS: RegExp[] = [
  /^un(specified|known|clear|stated|reported|defined)$/,
  /^not\s+(specified|stated|reported|applicable|available|given)$/,
  /^no(ne|t)\s+(stated|specified|reported|given|applicable|available)$/,
  /^none$/,
  /^n\/?a$/,
  // "Other", "Others", "Mixed or other", "Misc / other", "Other or mixed"
  /^(others?|mixed|misc|miscellaneous|various)([\s/,-]+(or|and)?[\s/,-]*(others?|mixed))?$/,
];

/**
 * True if a facet category label is a catch-all rather than a substantive class.
 */
export function isResidualCategory(label: string | null | undefined): boolean {
  if (!label) return false;
  const normalized = label.trim().toLowerCase();
  if (!normalized) return false;
  return RESIDUAL_PATTERNS.some((pattern) => pattern.test(normalized));
}
