/**
 * Which toolbar items move into the ··· menu when the row runs out of room.
 *
 * The toolbar used to collapse positionally: everything right of the first
 * button that didn't fit went into the menu. Insert is the last button in
 * the row, so it was always the FIRST thing to disappear, followed by the
 * lists and headings, while Superscript, Subscript, Inline code and the
 * host's document chrome (Custom layouts, Document settings, Files) all
 * stayed put. That is backwards for most writers: Insert is the only way to
 * reach tables, images and links, and it has no keyboard shortcut.
 *
 * Items now collapse by priority instead, in TOOLBAR_COLLAPSE_ORDER, while
 * the visible ones keep their usual left-to-right order.
 */

/**
 * Collapse order, first to go → last to go. Ids are toolbar BUTTONS ids, the
 * synthetic `insert` dropdown, the document-chrome ids below, and
 * `contextual:<data-contextual>` for the template / transition / table
 * groups (which only ever borrow whatever width is left over, as before).
 * An id missing from this list collapses before every listed one.
 */
export const TOOLBAR_COLLAPSE_ORDER: readonly string[] = [
  'contextual:table',
  'contextual:transition',
  'contextual:template',
  'subscript',
  'superscript',
  'layouts',
  'h6',
  'h5',
  'h4',
  'code',
  'hr',
  'docSettings',
  'files',
  'strikethrough',
  'quote',
  'h3',
  'ol',
  'h2',
  'h1',
  'ul',
  'italic',
  'bold',
  'insert',
];

const COLLAPSE_RANK = new Map(TOOLBAR_COLLAPSE_ORDER.map((id, rank) => [id, rank]));

function collapseRank(id: string): number {
  return COLLAPSE_RANK.get(id) ?? -1;
}

/** Sub-pixel layout rounding must not push an item that fits into the menu. */
const FIT_TOLERANCE = 0.5;

export interface CollapseGroup {
  /** Item ids in layout order. */
  readonly items: readonly string[];
  /**
   * Whether the group opens with a separator when an earlier group is
   * visible. Contextual groups carry their own, already in their width.
   */
  readonly separated: boolean;
}

export interface CollapseLayout {
  /** Groups of the actions lane, in layout order. */
  readonly groups: readonly CollapseGroup[];
  /** Collapsible host chrome on the same toolbar row, outside the lane. */
  readonly chrome: readonly string[];
  readonly widthOf: (id: string) => number;
  /** A separator's width including its margins. */
  readonly separatorWidth: number;
  /** Gap between the children of a group. */
  readonly groupGap: number;
  /** Gap between the groups of the lane. */
  readonly laneGap: number;
  /** Gap between toolbar-row items: chrome buttons and the ··· trigger. */
  readonly rowGap: number;
  readonly triggerWidth: number;
  /**
   * Width the lane, the collapsible chrome and the ··· trigger share: the
   * lane's own width plus whatever the displayed chrome and trigger occupy.
   * Collapsing a chrome button hands its width to the lane, so this total
   * does not change with the outcome.
   */
  readonly budget: number;
}

/** The row width the visible items need when `collapsed` are in the menu. */
export function requiredRowWidth(layout: CollapseLayout, collapsed: ReadonlySet<string>): number {
  let width = 0;
  let shownGroups = 0;
  for (const group of layout.groups) {
    const shown = group.items.filter((id) => !collapsed.has(id));
    if (shown.length === 0) continue;
    if (group.separated && shownGroups > 0) width += layout.separatorWidth + layout.groupGap;
    for (const id of shown) width += layout.widthOf(id);
    width += (shown.length - 1) * layout.groupGap;
    shownGroups++;
  }
  width += Math.max(0, shownGroups - 1) * layout.laneGap;
  for (const id of layout.chrome) {
    if (!collapsed.has(id)) width += layout.widthOf(id) + layout.rowGap;
  }
  if (collapsed.size > 0) width += layout.triggerWidth + layout.rowGap;
  return width;
}

/**
 * Collapse items in TOOLBAR_COLLAPSE_ORDER until the rest fit. The result is
 * always a prefix of that order (restricted to the items present), so a
 * narrower row collapses a superset of what a wider one does.
 */
export function chooseCollapsedItems(layout: CollapseLayout): Set<string> {
  const present = [...layout.groups.flatMap((group) => group.items), ...layout.chrome];
  // Array.prototype.sort is stable, so unlisted ids keep their layout order.
  const order = [...present].sort((a, b) => collapseRank(a) - collapseRank(b));
  const collapsed = new Set<string>();
  for (const id of order) {
    if (requiredRowWidth(layout, collapsed) <= layout.budget + FIT_TOLERANCE) break;
    collapsed.add(id);
  }
  return collapsed;
}
