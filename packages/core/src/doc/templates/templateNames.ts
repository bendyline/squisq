/** Canonical aliases for historical template ids. Kept dependency-free. */
export const TEMPLATE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  titleBlock: 'title',
  quoteBlock: 'quote',
  mapBlock: 'map',
  listBlock: 'list',
  diagramBlock: 'diagram',
  diagramNode: 'diagram',
});

/** Resolve a historical template id to its canonical registry key. */
export function resolveTemplateName(name: string): string {
  return TEMPLATE_ALIASES[name] ?? name;
}

/**
 * Templates whose data is the first GFM table in the block body: the parse
 * pipeline promotes that table into `templateData.headers`/`rows` unless the
 * author already supplied them (data fence / `{[…]}` params).
 */
export const TABLE_FED_TEMPLATES: ReadonlySet<string> = new Set([
  'dataTable',
  'barChart',
  'columnChart',
  'pieChart',
  'donutChart',
  'lineChart',
  'areaChart',
  'scatterChart',
]);

/** Templates that consume their child headings rather than rendering them. */
export const CONTAINER_TEMPLATES: ReadonlySet<string> = new Set(['diagram', 'drawing', 'layout']);

/** True when `name` (or its alias) consumes child blocks. */
export function isContainerTemplate(name: string | undefined): boolean {
  return !!name && CONTAINER_TEMPLATES.has(resolveTemplateName(name));
}

/**
 * Canonical ids of every built-in block template. Kept in registry order so it
 * diffs cleanly against `templateRegistry` (`registry.ts`). Hard-coded here —
 * rather than derived from the registry — because this module is a dependency-
 * free leaf that the markdown parser imports; pulling in `registry.ts` (which
 * imports all 33 template functions) would risk an import cycle. A unit test
 * (`templateTokenNames.test.ts`) asserts this set stays 1:1 with the registry.
 */
export const TEMPLATE_TOKEN_NAMES: ReadonlySet<string> = new Set([
  'title',
  'sectionHeader',
  'bigText',
  'transcript',
  'content',
  'statHighlight',
  'quote',
  'factCard',
  'twoColumn',
  'dateEvent',
  'imageWithCaption',
  'leftFeature',
  'rightFeature',
  'map',
  'fullBleedQuote',
  'list',
  'photoGrid',
  'definitionCard',
  'comparisonBar',
  'pullQuote',
  'videoWithCaption',
  'videoPullQuote',
  'dataTable',
  'barChart',
  'columnChart',
  'pieChart',
  'donutChart',
  'lineChart',
  'areaChart',
  'scatterChart',
  'diagram',
  'tree',
  'timeline',
  'layout',
  'drawing',
]);

/**
 * True when a bare `{[token]}` names a block template (directly or via a legacy
 * alias) and must therefore NOT be treated as an inline FontAwesome icon — block
 * tags win over icon tokens. Qualified icon tokens (`fa-solid:list`) contain a
 * `:` and never resolve to a template id, so they still render as icons.
 */
export function isReservedAnnotationToken(token: string): boolean {
  return TEMPLATE_TOKEN_NAMES.has(resolveTemplateName(token));
}
