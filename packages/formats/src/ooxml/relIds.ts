/**
 * Relationship ID allocation.
 *
 * Every OOXML relationship lives in a `_rels/*.rels` part, and its `Id` must
 * be unique *within that part*. The only way to guarantee that by construction
 * is to hand out every id for a given part from a single counter — fixed /
 * well-known rels (styles, numbering, theme, slideMaster) included.
 *
 * Reserving a "high" range for fixed rels instead (`rId100`+ while dynamic
 * rels count up from `rId1`) does not fix the problem, it only moves the
 * cliff: the 99th hyperlink allocates `rId100` and duplicates the styles rel,
 * at which point Word/PowerPoint refuse the file or silently "repair" it by
 * dropping content. Route every id through one allocator per part instead.
 *
 * @example
 * ```ts
 * const relIds = new RelIdAllocator();
 * relIds.alloc('word/document.xml'); // → "rId1"
 * relIds.alloc('word/document.xml'); // → "rId2"
 * relIds.alloc('word/header1.xml');  // → "rId1" (a different rels part)
 * ```
 */
export class RelIdAllocator {
  /** part path → next free numeric suffix */
  private readonly next = new Map<string, number>();

  /**
   * Allocate the next free relationship id for `part`'s rels file.
   *
   * @param part - Zip path of the part that owns the relationship
   *   (e.g. `"word/document.xml"`). Use `""` for the package root.
   *   Ids are only unique per `part`, which is exactly the OOXML rule.
   */
  alloc(part: string = ''): string {
    const n = this.next.get(part) ?? 1;
    this.next.set(part, n + 1);
    return `rId${n}`;
  }
}
