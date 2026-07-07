/**
 * Pure reconciler for context-section zones. Diffs the previous resolved spec
 * list against the next by section id, so the zone layer can apply one
 * changeViewZones batch: create `add`, delete `remove`, and re-anchor `move`
 * (same id, different line or ordinal). Content-only changes are not the zone
 * layer's business — React re-renders the portal and the resize observer
 * corrects the height.
 */

export interface ZoneSpec {
  id: string;
  /** 1-based anchor line (0 = file-top, above line 1). */
  line: number;
  /** Stable order among zones sharing an anchor line. */
  ordinal: number;
}

export interface ZoneDiff {
  add: ZoneSpec[];
  remove: string[];
  move: ZoneSpec[];
}

export function diffContextSections(prev: ZoneSpec[], next: ZoneSpec[]): ZoneDiff {
  const prevById = new Map(prev.map((z) => [z.id, z]));
  const nextIds = new Set<string>();
  const add: ZoneSpec[] = [];
  const move: ZoneSpec[] = [];
  for (const spec of next) {
    if (nextIds.has(spec.id)) continue; // duplicate id — first occurrence wins
    nextIds.add(spec.id);
    const before = prevById.get(spec.id);
    if (!before) add.push(spec);
    else if (before.line !== spec.line || before.ordinal !== spec.ordinal) move.push(spec);
  }
  const remove = prev.filter((z) => !nextIds.has(z.id)).map((z) => z.id);
  return { add, remove, move };
}
