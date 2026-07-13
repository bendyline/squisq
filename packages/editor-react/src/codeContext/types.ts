/**
 * Host-supplied context sections rendered INSIDE the Monaco (raw/code)
 * surface: collapsible markdown blurbs injected above anchor lines, plus an
 * optional file-top summary. Squisq stays host-agnostic — anchors are plain
 * line numbers, ids are opaque strings, links are intercepted via callback.
 *
 * Accessibility note: Monaco marks its view-zone layer `aria-hidden`, so
 * sections are invisible to screen readers in v1.
 */

/**
 * One host-supplied markdown blurb anchored above a line of the code buffer.
 * Rendered as a compact one-line strip that expands in place to the full
 * markdown body.
 */
export interface CodeContextSection {
  /**
   * Stable identity used to reconcile zones across prop updates — e.g. a
   * symbol id like 'resolveImportEdges@60'. Zones are diffed by id: same id +
   * new line moves the zone; same id + new markdown re-renders in place; a
   * new id creates a new zone.
   */
  id: string;
  /**
   * 1-based line the section renders ABOVE. Out-of-range values are clamped
   * by Monaco. In editable buffers the zone rides Monaco's whitespace
   * semantics — it shifts as lines are inserted/deleted above it and
   * collapses onto the previous line if its anchor lines are deleted. Squisq
   * never re-derives anchors from edits; the host re-supplies lines when it
   * re-analyzes the file.
   */
  line: number;
  /**
   * Compact markdown for the collapsed strip. Rendered on one line (block
   * structure flattened, overflow ellipsized). Links work here too and go
   * through `onLinkClick`.
   */
  summaryMarkdown: string;
  /**
   * Full markdown body shown when expanded. Omit while still loading — the
   * expanded view shows a muted loading row and fills in when a later prop
   * update supplies it.
   */
  markdown?: string;
  /** Start expanded. The user's toggle wins after first interaction. Default false. */
  defaultExpanded?: boolean;
}

/** The full context dictionary passed to `EditorShell.codeContext`. */
export interface CodeContext {
  /**
   * Section pinned above line 1 (file summary). Rendered before any line-1
   * `sections` entry. `line` is implicit.
   */
  fileTop?: Omit<CodeContextSection, 'line'>;
  /** Line-anchored sections. Array order is preserved for equal lines. */
  sections?: CodeContextSection[];
  /**
   * Extra URI schemes section links may use (e.g. `['workspace-nav']`).
   * http/https/mailto/tel are always allowed; executable schemes
   * (javascript:, data:) are never allowed regardless.
   */
  linkSchemes?: readonly string[];
  /**
   * Intercepts link clicks inside sections, receiving the href exactly as
   * authored in the markdown. Return `false` to let the browser's default
   * navigation proceed; any other return (or void) suppresses it. Fragment
   * links of the form `#L<digits>` are handled natively by squisq (reveal
   * that line in the editor) and never reach this callback. When omitted:
   * http(s)/mailto links open normally, custom-scheme links do nothing.
   */
  onLinkClick?: (href: string, meta: { sectionId: string }) => boolean | undefined;
  /** Notified on expand/collapse — lets hosts lazy-load bodies on first expand. */
  onToggleSection?: (sectionId: string, expanded: boolean) => void;
}
