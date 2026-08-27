import type { Source } from "@/types/source";

/**
 * Whether a source should offer the PDF actions (find / upload / open OA copy).
 *
 * Sources already screened out never get classified, so chasing their full text
 * is wasted effort — they only keep the delete action.
 */
export function needsPdfAction(source: Source): boolean {
  const excluded = source.finalDecision === "EXCLUDE" || source.status === "EXCLUDED";
  return !source.hasPdf && !excluded;
}

/**
 * The open-access copy we located but could not download, if any.
 *
 * Publishers like MDPI and Elsevier answer automated requests with a bot wall
 * even for gold open-access papers, so we hand the link to the user instead of
 * leaving them to search for the paper again.
 */
export function openAccessUrl(source: Source): string | undefined {
  const record = source.metadataExtension?.pdfRetrieval;
  if (!record || record.status === "retrieved") return undefined;
  return record.openAccessUrls?.[0];
}
