/**
 * Element ids for per-layer SVG `<defs>` (markers, gradients, filters).
 *
 * A layer id is author-controlled and may hold anything — diagram edges, for
 * example, embed their label (`edge-nobles->parliament:a third of seats`).
 * Spaces and punctuation are legal in an `id` attribute but not in the
 * `url(#…)` reference that points at it, so an unsanitised id silently drops
 * the arrowhead, gradient or shadow. This keeps only URL-safe characters,
 * appending a short hash so two ids that differ only in stripped characters
 * still stay distinct.
 */
export function defsIdFor(reactId: string, layerId: string): string {
  const raw = `${reactId}-${layerId}`;
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '_');
  if (safe === raw.replace(/:/g, '_')) return safe.replace(/^_+/, 'd');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  return `${safe.replace(/^_+/, 'd')}-${hash.toString(36)}`;
}
