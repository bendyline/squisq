/**
 * SVG island hard limits, in a module of their own so schema validation can
 * share them without pulling in the HTML parser behind `parseSvgIsland`.
 */

/** Hard limits; a fence past any of them renders as code. */
export const SVG_ISLAND_LIMITS = Object.freeze({
  maxSourceBytes: 512 * 1024,
  maxElements: 20_000,
  maxDepth: 200,
  /** Elements rendered after `<use>` expansion. */
  maxExpandedElements: 50_000,
});
