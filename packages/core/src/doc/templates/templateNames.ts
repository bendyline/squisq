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

/** Templates that consume their child headings rather than rendering them. */
export const CONTAINER_TEMPLATES: ReadonlySet<string> = new Set(['diagram', 'drawing', 'layout']);

/** True when `name` (or its alias) consumes child blocks. */
export function isContainerTemplate(name: string | undefined): boolean {
  return !!name && CONTAINER_TEMPLATES.has(resolveTemplateName(name));
}
