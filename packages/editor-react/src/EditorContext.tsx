/**
 * EditorContext
 *
 * Shared React context that synchronizes state across all three editor views
 * (Raw/Monaco, WYSIWYG/Tiptap, Preview/DocPlayer). When any view modifies the
 * markdown source, the context re-parses and regenerates the MarkdownDocument
 * and Doc so all views stay in sync.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  DocumentVersionManager,
  type PrunePolicy,
  type SaveVersionOptions,
  type SaveVersionResult,
} from '@bendyline/squisq/versions';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import { markdownToTiptap } from './tiptapBridge';
import { resolveFileKind } from './fileKind';
import { useBlockNavigator } from './useBlockNavigator';
import {
  createSceneTextChannel,
  type SceneTextChannel,
  type SceneTextHandle,
} from './scene/text/sceneTextChannel';
import {
  readMonacoScrollRatio,
  readWysiwygScrollRatio,
  restoreMonacoScrollRatio,
  restoreWysiwygScrollRatio,
} from './editorScrollSync';

/** Monaco standalone code editor instance type */
type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

/**
 * One candidate returned by a {@link MentionProvider}. Shown in the editor's
 * `@` popover. `id` is the stable identifier (serialized into the mention
 * wire format); `label` is what the reader sees; `scheme` is the namespace
 * (e.g. `'user'`, `'issue'`) written into the markdown as `@[label](scheme:id)`;
 * `description` and `group` are optional hints for richer suggestion UIs.
 *
 * Different candidates in the same result set may carry different schemes —
 * a provider that returns both users and issues, for example, tags each
 * candidate with its own namespace and the editor emits mentions accordingly.
 */
export interface MentionCandidate {
  id: string;
  label: string;
  scheme: string;
  description?: string;
  group?: string;
}

/**
 * Looks up mention candidates matching a query. Called as the user types
 * after `@`. The provider is free to do server-side or client-side filtering;
 * the editor only cares that candidates come back in relevance order.
 */
export type MentionProvider = (query: string) => Promise<MentionCandidate[]>;

/**
 * A document that the link dialog's "Browse documents" picker can offer.
 * `path` is what lands in the markdown URL (typically relative to the
 * current document so `home.md → resume.md` round-trips through file-
 * system serializers). `label` is the human name shown in the list.
 * `description` is an optional secondary line (e.g. workspace folder,
 * last-modified date).
 */
export interface DocumentLinkCandidate {
  path: string;
  label: string;
  description?: string;
}

/**
 * Resolves sibling / workspace document candidates for the link dialog.
 * The editor itself has no notion of "neighbors" — hosts that organize
 * docs in a workspace (e.g. docblocks) implement this to power the
 * dialog's document picker. Pass `''` as the query for an initial list
 * (the dialog calls it once on open); subsequent calls narrow by user
 * input.
 */
export type DocumentLinkProvider = (query: string) => Promise<DocumentLinkCandidate[]>;

// ─── Types ───────────────────────────────────────────────

export type EditorView = 'raw' | 'wysiwyg' | 'preview';
/**
 * Light/dark chrome mode for the editor shell (toolbar, tabs, status bar,
 * side panes). This is the editor's *UI color scheme* — distinct from a
 * Squisq `Theme` object, which styles the rendered document. Renamed from
 * the former `EditorTheme` to remove that ambiguity.
 */
export type EditorColorScheme = 'light' | 'dark';
/**
 * Document layout mode. `'document'` shows the whole markdown document in
 * the active view (the historical behavior). `'block'` is the
 * block-at-a-time view — one heading-defined block on a card at a time,
 * with the editor scoped to just that block. `'timeline'` is block mode plus
 * a horizontal timeline track for editing block durations and media slices.
 * See {@link useBlockNavigator}.
 */
export type LayoutMode = 'document' | 'block' | 'timeline';
/**
 * How much of the active Squisq theme the WYSIWYG editing surface
 * mirrors. `'fonts'` is the historical default — body and heading
 * fonts only. `'fonts-colors'` also borrows the theme canvas / text
 * colors. `'none'` opts out completely.
 */
export type ThemeInheritance = 'none' | 'fonts' | 'fonts-colors';
/**
 * When inline block-template tags are shown in the WYSIWYG surface.
 * `'active'` shows tags for the cursor's block and the block under the pointer.
 */
export type BlockTagVisibility = 'none' | 'active' | 'always';
/**
 * Editor operating mode. `markdown` is the full experience (WYSIWYG +
 * Preview tabs, formatting toolbar). `code` is a Monaco-only view used
 * when the content represents a non-markdown file like `foo.ts`.
 */
export type EditorMode = 'markdown' | 'code' | 'image';

export interface EditorState {
  /** Raw markdown source string */
  markdownSource: string;
  /** Parsed markdown document (JSON DOM) */
  markdownDoc: MarkdownDocument | null;
  /** Generated Doc (block hierarchy) */
  doc: Doc | null;
  /** Currently active editor view */
  activeView: EditorView;
  /** Parse error, if any */
  parseError: string | null;
  /** Whether a parse is pending */
  isParsing: boolean;
  /** Current light/dark chrome color scheme for the editor shell. */
  colorScheme: EditorColorScheme;
  /** Operating mode — 'markdown' for the full shell, 'code' for Monaco-only. */
  editorMode: EditorMode;
  /** Whether the host-triggered Find toolbar is active. */
  findMode: boolean;
  /** Monaco language ID for the Raw editor. */
  language: string;
  /**
   * Whether the inline preview gutter (per-block card previews next to the
   * WYSIWYG surface) is currently visible. Initialized from the EditorShell
   * `inlinePreview` prop; the View menu in the toolbar can toggle it at
   * runtime.
   */
  inlinePreviewVisible: boolean;
  /**
   * Whether the bottom status bar is currently visible. Initialized from
   * the EditorShell `showStatusBar` prop (default true); the View menu in
   * the toolbar can toggle it at runtime.
   */
  statusBarVisible: boolean;
  /**
   * Whether the left-side outline pane is currently visible. Initialized
   * from the EditorShell `outline` prop (default false); the View menu in
   * the toolbar can toggle it at runtime.
   */
  outlineVisible: boolean;
  /** When inline block-template tags are shown in the WYSIWYG view. */
  blockTagVisibility: BlockTagVisibility;
  /**
   * Whether inline block-template tags can currently be visible.
   * Kept for compatibility; prefer {@link blockTagVisibility}.
   */
  blockTagsVisible: boolean;
  /**
   * How much of the active Squisq theme the WYSIWYG editing surface should
   * inherit. `'none'` shows the default editor styling, `'fonts'` (the
   * default) matches body and heading fonts only, and `'fonts-colors'`
   * also borrows the theme's canvas / text colors so authors get a
   * closer preview while editing.
   */
  themeInheritance: ThemeInheritance;
  /**
   * Relative path of an image the user requested to edit, or `null` when
   * no editor is open. Surfaced by `<ImageNodeView>`'s hover affordance
   * and consumed by `<EditorShell>` to render the modal `<ImageEditor>`.
   */
  imageEditTarget: string | null;
  /**
   * Monotonic counter bumped whenever a managed media asset is rewritten
   * (e.g. after the image-editor modal saves back). Image render paths
   * that cache resolved blob URLs should include this in their effect
   * deps so the new bytes get picked up.
   */
  mediaRevision: number;
  /**
   * Whether the in-editor media recorder should be available. Defaults
   * to true when a `mediaProvider` is wired; hosts that explicitly
   * don't want the affordance (e.g. read-only embeds, surfaces where
   * camera/screen prompts would be jarring) can pass `false` on the
   * shell.
   */
  allowRecording: boolean;
  /**
   * Whether the Narrate (teleprompter) display mode is offered under the
   * Use tab. Orthogonal to `allowRecording`: the teleprompter is useful
   * without any capture (reading for external recording software), and a
   * host may allow the recorder modal but not want a prompter surface.
   */
  allowNarrate: boolean;
  /**
   * Document layout mode. `'document'` (default) edits the whole document;
   * `'block'` activates the block-at-a-time card view. Initialized from the
   * EditorShell `layoutMode` prop; the View menu can toggle it at runtime.
   */
  layoutMode: LayoutMode;
  /**
   * The markdown the active text editor should bind to: the full source in
   * `'document'` mode, or just the active block's slice in `'block'` mode.
   * Editors read this instead of `markdownSource` so the same surfaces work
   * in both layouts.
   */
  editorSource: string;
  /** Number of navigable blocks (cards) in the current document. */
  blockCount: number;
  /** Index of the block currently shown on the card (block mode). */
  activeBlockKey: number;
  /** 1-based source line where the active block begins, or null. */
  activeBlockStartLine: number | null;
}

export interface EditorActions {
  /** Set markdown source and trigger re-parse */
  setMarkdownSource: (source: string) => void;
  /**
   * Write through the active editor channel. In `'document'` mode this is
   * `setMarkdownSource`; in `'block'` mode it splices the edited block back
   * into the full document. Editors call this instead of `setMarkdownSource`.
   */
  setEditorSource: (source: string) => void;
  /** Switch between Document and Block-at-a-time layouts. */
  setLayoutMode: (mode: LayoutMode) => void;
  /** Show a block by index in block mode (clamped to range). */
  goToBlock: (key: number) => void;
  /** Show the block that owns a given 1-based source line (used by the outline). */
  goToBlockByLine: (line: number) => void;
  /** Move the card to the previous block. */
  prevBlock: () => void;
  /** Move the card to the next block. */
  nextBlock: () => void;
  /** Insert a new heading block after the active one and move to it. */
  addBlock: () => void;
  /** Set markdown from a MarkdownDocument (e.g. from WYSIWYG) */
  setMarkdownDoc: (doc: MarkdownDocument) => void;
  /** Switch the active view */
  setActiveView: (view: EditorView) => void;
  /** Enter or leave the host-triggered Find toolbar mode. */
  setFindMode: (active: boolean) => void;
  /** Register / unregister the Tiptap editor instance (called by WysiwygEditor) */
  setTiptapEditor: (editor: TiptapEditor | null) => void;
  /** Register / unregister the Monaco editor instance (called by RawEditor) */
  setMonacoEditor: (editor: MonacoEditor | null) => void;
  /** Set the light/dark chrome color scheme for the editor shell. */
  setColorScheme: (colorScheme: EditorColorScheme) => void;
  /** Show or hide the inline preview gutter at runtime (driven by the View menu). */
  setInlinePreviewVisible: (visible: boolean) => void;
  /** Show or hide the bottom status bar at runtime (driven by the View menu). */
  setStatusBarVisible: (visible: boolean) => void;
  /** Show or hide the left-side outline pane at runtime (driven by the View menu). */
  setOutlineVisible: (visible: boolean) => void;
  /** Show or hide inline block-template tags at runtime (driven by the View menu). */
  setBlockTagsVisible: (visible: boolean) => void;
  /** Choose when inline block-template tags are shown. */
  setBlockTagVisibility: (visibility: BlockTagVisibility) => void;
  /** Change how much of the active Squisq theme the WYSIWYG surface mirrors. */
  setThemeInheritance: (mode: ThemeInheritance) => void;
  /** Insert text at the current cursor position in the active editor */
  insertAtCursor: (text: string) => void;
  /** Replace all editor content with the given text */
  replaceAll: (text: string) => void;
  /**
   * Request the modal image editor open on the given relative media path.
   * The path must resolve through the active `mediaProvider`. No-op when
   * no provider is wired — callers should hide the affordance in that
   * case.
   */
  openImageEdit: (relativePath: string) => void;
  /** Close the image editor modal without saving. */
  closeImageEdit: () => void;
  /**
   * Bump `mediaRevision`. Called after the image editor writes back to
   * the original media path so dependent `<img>` nodes re-resolve their
   * blob URL.
   */
  bumpMediaRevision: () => void;
}

export interface EditorContextValue extends EditorState, EditorActions {
  /** The live Tiptap editor instance (null when WYSIWYG is not mounted) */
  tiptapEditor: TiptapEditor | null;
  /** The live Monaco editor instance (null when Raw is not mounted) */
  monacoEditor: MonacoEditor | null;
  /**
   * The focused canvas textbox editor, if any — a small Tiptap instance for
   * a diagram/drawing/layout textbox being edited inline. Published via
   * `sceneTextChannel` (the canvas renders in a detached React root). The
   * top formatting toolbar retargets to this when set. `level` gates which
   * buttons apply (`inline` = marks only; `rich` = headings/lists too).
   */
  activeSceneText: SceneTextHandle | null;
  /** Instance-owned bridge used by detached scene widget roots. */
  sceneTextChannel: SceneTextChannel;
  /**
   * Workspace-scoped `ContentContainer` for this document — the folder
   * holding the doc, its `_files/` sidecar, sibling documents, and any
   * version snapshots. Drives audio mapping, version history, and
   * sibling-doc reads for the recursive HTML export.
   */
  workspaceContainer: ContentContainer | null;
  /**
   * Version manager — non-null only when the host opted into versioning
   * (`allowVersioning` + a `workspaceContainer`). Components can call
   * `saveVersion` directly, or render the version-history panel which
   * reads it from here.
   */
  versioning: DocumentVersionManager | null;
  /**
   * Stamp a new snapshot of the current document. No-op (returns
   * `unchanged`) when content matches the latest version. Always safe
   * to call — when versioning is disabled, returns `no-document`
   * without writing.
   */
  saveVersion: (options?: SaveVersionOptions) => Promise<SaveVersionResult>;
  /** MediaProvider for resolving image URLs in the WYSIWYG editor */
  mediaProvider: MediaProvider | null;
  /**
   * How pasted/inserted images should be displayed in the WYSIWYG view.
   * `'inline'` (default) lets them flow at natural size up to the editor
   * width; `'thumbnail'` constrains them to a 100×100 box so chat
   * composers and other dense surfaces don't get dominated by a single
   * pasted screenshot. The stored image bytes are unchanged — this is a
   * pure render-time decision.
   */
  imageDisplayMode: ImageDisplayMode;
  /**
   * Optional provider for `@`-mention suggestions. When set, both the
   * WYSIWYG (Tiptap) and Raw (Monaco) editors show a mention popover as
   * the user types `@<query>`. When unset, `@` is just a literal character.
   */
  mentionProvider: MentionProvider | null;
  /**
   * Optional provider for sibling-document suggestions in the link
   * dialog. When set, the dialog shows a "Browse documents" picker that
   * lets authors search neighbor docs by name and insert a relative-
   * path link. When unset, the dialog falls back to URL-only.
   */
  documentLinkProvider: DocumentLinkProvider | null;
}

export type ImageDisplayMode = 'inline' | 'thumbnail';

// ─── Context ─────────────────────────────────────────────

const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Hook to access the editor context. Must be used within an EditorProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditorContext must be used within an <EditorProvider>');
  }
  return ctx;
}

// ─── Provider ────────────────────────────────────────────

export interface EditorProviderProps {
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Initial active view */
  initialView?: EditorView;
  /** Article ID used when generating the Doc */
  articleId?: string;
  /** Light/dark chrome color scheme for the editor shell. */
  colorScheme?: EditorColorScheme;
  /**
   * Workspace-scoped `ContentContainer` for this document — the folder
   * holding the doc, its `_files/` sidecar, sibling documents, and any
   * version snapshots. Required for `allowVersioning` to take effect.
   */
  workspaceContainer?: ContentContainer | null;
  /**
   * Enable version history. Snapshots are stored at
   * `.versions/<basename>.<timestamp>.md` inside `workspaceContainer`.
   * Auto-save fires after `versioningAutoSaveIdleMs` of idle; hosts can
   * also call `saveVersion()` from the context. Without a
   * `workspaceContainer`, this prop is ignored (and a `console.warn` is
   * emitted).
   */
  allowVersioning?: boolean;
  /** Override the basename used in version filenames. Defaults to the
   * basename of the container's primary document path. */
  versionBasename?: string;
  /**
   * Prune policy applied after each successful auto-save. Defaults to
   * keeping the last 50 snapshots so the count doesn't grow unbounded.
   */
  versioningPrunePolicy?: PrunePolicy;
  /**
   * Idle delay (ms) before auto-saving a version. `0` disables auto-save
   * entirely (versions are saved only via host-driven `saveVersion`
   * calls). Default: 5000.
   */
  versioningAutoSaveIdleMs?: number;
  /**
   * Notified after each `saveVersion` attempt — both successful saves
   * (`reason: 'saved'`) and skips (`'unchanged'`, `'no-document'`,
   * `'empty'`). Useful for hosts that want a "Last saved" indicator.
   */
  onSaveVersion?: (result: SaveVersionResult) => void;
  /** MediaProvider for resolving image URLs */
  mediaProvider?: MediaProvider | null;
  /** Display mode for images in the WYSIWYG view. Defaults to `'inline'`. */
  imageDisplayMode?: ImageDisplayMode;
  /**
   * Async provider for `@`-mention suggestions. Omit to disable mentions
   * entirely — typing `@` becomes just a literal character again.
   */
  mentionProvider?: MentionProvider | null;
  /**
   * Async provider for sibling-document suggestions in the link dialog.
   * Omit to fall back to URL-only link insertion.
   */
  documentLinkProvider?: DocumentLinkProvider | null;
  /**
   * Whether the in-editor media recorder is available in the toolbar.
   * Defaults to true. Set to false to suppress the recorder affordance
   * even when a `mediaProvider` is wired (e.g. read-only embeds,
   * surfaces where camera/screen prompts would be jarring).
   */
  allowRecording?: boolean;
  /**
   * Whether the Narrate (teleprompter) display mode is offered under the
   * Use tab. Defaults to true. When false the mode button is hidden and a
   * frontmatter-forced `display-mode: narrate` clamps back to video.
   */
  allowNarrate?: boolean;
  /**
   * File name (e.g. `foo.ts`) or bare extension — used to pick a Monaco
   * language and decide between markdown vs. code mode.
   */
  fileName?: string;
  /** Explicit Monaco language ID — wins over the fileName-derived one. */
  language?: string;
  /**
   * Controlled Find-mode state. No trigger button is rendered by default;
   * hosts can set this prop or call `setFindMode` from editor context.
   */
  findMode?: boolean;
  /** Notified when Find mode requests a state change (for example, its X button). */
  onFindModeChange?: (active: boolean) => void;
  /**
   * Initial visibility of the inline preview gutter. Defaults to false.
   * The toolbar's View menu can toggle it at runtime.
   */
  inlinePreview?: boolean;
  /**
   * Initial visibility of the bottom status bar. Defaults to true.
   * The toolbar's View menu can toggle it at runtime.
   */
  showStatusBar?: boolean;
  /**
   * Initial visibility of the left-side outline pane. Defaults to false.
   * The toolbar's View menu can toggle it at runtime.
   */
  outline?: boolean;
  /**
   * Legacy initial visibility of inline block-template tags on headings.
   * `true` maps to always visible and `false` maps to hidden. When omitted,
   * {@link blockTagVisibility} defaults to `'active'`.
   */
  blockTags?: boolean;
  /**
   * Initial block-tag visibility mode. When set, this takes precedence over
   * the legacy boolean {@link blockTags} prop. Defaults to `'active'`.
   */
  blockTagVisibility?: BlockTagVisibility;
  /**
   * Initial value for how much of the active Squisq theme the WYSIWYG
   * editing surface should mirror. Defaults to `'fonts'` — the
   * historical behavior of inheriting body / heading fonts only. The
   * toolbar's View menu can change it at runtime.
   */
  themeInheritance?: ThemeInheritance;
  /**
   * Initial layout mode. Defaults to `'document'` (whole-document editing).
   * `'block'` boots into the block-at-a-time card view. The toolbar's View
   * menu can toggle it at runtime.
   */
  layoutMode?: LayoutMode;
  /**
   * Bundled view preferences — a serializable JSON blob covering all
   * runtime-toggleable view options. When provided, individual values
   * here override the matching individual props (`inlinePreview`,
   * `showStatusBar`, `outline`, `blockTagVisibility`, `blockTags`). Hosts
   * wiring this up typically load the blob from their own preferences storage
   * and pair it with {@link onViewPreferencesChange}.
   */
  viewPreferences?: ViewPreferences;
  /**
   * Notified after each user-driven toggle in the View menu (or any
   * programmatic call to the corresponding context setters). The
   * argument is a full snapshot — hosts can persist it as-is.
   * Not called when {@link viewPreferences} is changed externally.
   */
  onViewPreferencesChange?: (prefs: ViewPreferences) => void;
  children: ReactNode;
}

/**
 * Serializable bundle of all runtime-toggleable view preferences for
 * the editor shell. Hosts can persist this verbatim (e.g. to
 * localStorage) and pass it back via {@link EditorProviderProps.viewPreferences}
 * to restore the user's last view configuration.
 */
export interface ViewPreferences {
  /** Whether the left-side outline pane is visible. */
  outline?: boolean;
  /** Whether the inline preview gutter (per-block cards) is visible. */
  inlinePreview?: boolean;
  /** Whether the bottom status bar is visible. */
  showStatusBar?: boolean;
  /** Whether inline block-template tags on headings are visible. */
  blockTags?: boolean;
  /** When inline block-template tags are shown. Takes precedence over `blockTags`. */
  blockTagVisibility?: BlockTagVisibility;
  /** How much of the active Squisq theme the WYSIWYG surface mirrors. */
  themeInheritance?: ThemeInheritance;
  /** Document vs. block-at-a-time layout. */
  layoutMode?: LayoutMode;
}

/**
 * Provides shared editor state to all child components.
 * Automatically parses markdown and generates a Doc whenever the source changes.
 */
const DEFAULT_PRUNE_POLICY: PrunePolicy = { type: 'keep-last-n', n: 50 };
const DEFAULT_AUTOSAVE_IDLE_MS = 5_000;

function normalizeBlockTagVisibility(
  value: BlockTagVisibility | boolean | undefined,
): BlockTagVisibility {
  if (value === false || value === 'none') return 'none';
  if (value === undefined || value === 'active') return 'active';
  return 'always';
}

export function EditorProvider({
  initialMarkdown = '',
  initialView = 'raw',
  articleId = 'untitled',
  colorScheme: initialColorScheme = 'light',
  workspaceContainer = null,
  allowVersioning = false,
  versionBasename,
  versioningPrunePolicy = DEFAULT_PRUNE_POLICY,
  versioningAutoSaveIdleMs = DEFAULT_AUTOSAVE_IDLE_MS,
  onSaveVersion,
  mediaProvider = null,
  imageDisplayMode = 'inline',
  mentionProvider = null,
  documentLinkProvider = null,
  allowRecording = true,
  allowNarrate = true,
  fileName,
  language,
  findMode: controlledFindMode,
  onFindModeChange,
  inlinePreview = false,
  showStatusBar = true,
  outline = false,
  blockTags,
  blockTagVisibility: initialBlockTagVisibility,
  themeInheritance = 'fonts',
  layoutMode = 'document',
  viewPreferences,
  onViewPreferencesChange,
  children,
}: EditorProviderProps) {
  // Resolve effective initial values: bundled `viewPreferences` wins over
  // individual props when both are passed. Individual props remain valid
  // for hosts that haven't migrated to the bundled API.
  const effectiveInlinePreview = viewPreferences?.inlinePreview ?? inlinePreview;
  const effectiveShowStatusBar = viewPreferences?.showStatusBar ?? showStatusBar;
  const effectiveOutline = viewPreferences?.outline ?? outline;
  const effectiveBlockTagVisibility = normalizeBlockTagVisibility(
    viewPreferences?.blockTagVisibility ??
      viewPreferences?.blockTags ??
      initialBlockTagVisibility ??
      blockTags,
  );
  const effectiveThemeInheritance = viewPreferences?.themeInheritance ?? themeInheritance;
  const effectiveLayoutMode = viewPreferences?.layoutMode ?? layoutMode;
  // Resolve once per provider mount. Changing fileName/language after mount
  // would require recreating the Monaco model anyway, so treat it as static.
  const { mode: editorMode, language: resolvedLanguage } = useMemo(
    () => resolveFileKind(fileName, language),
    [fileName, language],
  );
  // In code mode, WYSIWYG and Preview aren't rendered — force the starting
  // view to 'raw' so we don't boot into an unmounted surface. Image mode
  // has no text-editing surface at all; keep the same fallback so that any
  // host that switches into image mode doesn't end up in a stale view id.
  const [markdownSource, setMarkdownSourceRaw] = useState(initialMarkdown);
  const [markdownDoc, setMarkdownDocState] = useState<MarkdownDocument | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [activeView, setActiveViewRaw] = useState<EditorView>(
    editorMode === 'markdown' ? initialView : 'raw',
  );
  const [uncontrolledFindMode, setUncontrolledFindMode] = useState(false);
  const findMode = editorMode !== 'image' && (controlledFindMode ?? uncontrolledFindMode);
  const setFindMode = useCallback(
    (active: boolean) => {
      if (editorMode === 'image') return;
      if (controlledFindMode === undefined) setUncontrolledFindMode(active);
      onFindModeChange?.(active);
    },
    [controlledFindMode, editorMode, onFindModeChange],
  );
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const tiptapEditorRef = useRef<TiptapEditor | null>(null);
  const monacoEditorRef = useRef<MonacoEditor | null>(null);
  const pendingEditorScrollRef = useRef<{ view: 'raw' | 'wysiwyg'; ratio: number } | null>(null);
  const setActiveView = useCallback(
    (view: EditorView) => {
      // In code mode only the raw view is valid. In image mode no text view
      // is valid at all — ignore any switch attempt.
      if (editorMode === 'code' && view !== 'raw') return;
      if (editorMode === 'image') return;

      const currentView = activeViewRef.current;
      if (view === currentView) return;

      // Write and Source are separate editor instances and are unmounted as
      // their tabs are hidden. Capture a proportional document position
      // before the current instance disappears, then restore it after the
      // destination has mounted and completed layout.
      let ratio: number | null = null;
      let targetView: 'raw' | 'wysiwyg' | null = null;
      if (currentView === 'raw' && view === 'wysiwyg' && monacoEditorRef.current) {
        ratio = readMonacoScrollRatio(monacoEditorRef.current);
        targetView = 'wysiwyg';
      } else if (currentView === 'wysiwyg' && view === 'raw' && tiptapEditorRef.current) {
        ratio = readWysiwygScrollRatio(tiptapEditorRef.current);
        targetView = 'raw';
      }
      pendingEditorScrollRef.current =
        ratio === null || targetView === null ? null : { view: targetView, ratio };
      setActiveViewRaw(view);
    },
    [editorMode],
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [colorScheme, setColorScheme] = useState<EditorColorScheme>(initialColorScheme);
  const [inlinePreviewVisible, setInlinePreviewVisibleRaw] =
    useState<boolean>(effectiveInlinePreview);
  // Sync visibility when the host changes the prop (e.g., toggle from outside).
  useEffect(() => {
    if (viewPreferences?.inlinePreview === undefined) setInlinePreviewVisibleRaw(inlinePreview);
  }, [inlinePreview, viewPreferences?.inlinePreview]);
  const [statusBarVisible, setStatusBarVisibleRaw] = useState<boolean>(effectiveShowStatusBar);
  useEffect(() => {
    if (viewPreferences?.showStatusBar === undefined) setStatusBarVisibleRaw(showStatusBar);
  }, [showStatusBar, viewPreferences?.showStatusBar]);
  const [outlineVisible, setOutlineVisibleRaw] = useState<boolean>(effectiveOutline);
  useEffect(() => {
    if (viewPreferences?.outline === undefined) setOutlineVisibleRaw(outline);
  }, [outline, viewPreferences?.outline]);
  const [blockTagVisibilityState, setBlockTagVisibilityRaw] = useState<BlockTagVisibility>(
    effectiveBlockTagVisibility,
  );
  const blockTagsVisible = blockTagVisibilityState !== 'none';
  useEffect(() => {
    if (
      viewPreferences?.blockTagVisibility === undefined &&
      viewPreferences?.blockTags === undefined
    ) {
      setBlockTagVisibilityRaw(normalizeBlockTagVisibility(initialBlockTagVisibility ?? blockTags));
    }
  }, [blockTags, initialBlockTagVisibility, viewPreferences]);
  const [themeInheritanceState, setThemeInheritanceRaw] =
    useState<ThemeInheritance>(effectiveThemeInheritance);
  useEffect(() => {
    if (viewPreferences?.themeInheritance === undefined) {
      setThemeInheritanceRaw(themeInheritance);
    }
  }, [themeInheritance, viewPreferences?.themeInheritance]);
  const [layoutModeState, setLayoutModeRaw] = useState<LayoutMode>(effectiveLayoutMode);
  useEffect(() => {
    if (viewPreferences?.layoutMode === undefined) setLayoutModeRaw(layoutMode);
  }, [layoutMode, viewPreferences?.layoutMode]);
  const [imageEditTarget, setImageEditTarget] = useState<string | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const openImageEdit = useCallback((relativePath: string) => {
    setImageEditTarget(relativePath);
  }, []);
  const closeImageEdit = useCallback(() => {
    setImageEditTarget(null);
  }, []);
  const bumpMediaRevision = useCallback(() => {
    setMediaRevision((n) => n + 1);
  }, []);

  // Sync from the bundled `viewPreferences` prop. Runs in addition to the
  // individual prop syncs above. When both APIs are present, the bundled
  // values are applied here last, keeping `viewPreferences` authoritative.
  useEffect(() => {
    if (!viewPreferences) return;
    if (viewPreferences.inlinePreview !== undefined) {
      setInlinePreviewVisibleRaw(viewPreferences.inlinePreview);
    }
    if (viewPreferences.showStatusBar !== undefined) {
      setStatusBarVisibleRaw(viewPreferences.showStatusBar);
    }
    if (viewPreferences.outline !== undefined) {
      setOutlineVisibleRaw(viewPreferences.outline);
    }
    if (viewPreferences.blockTagVisibility !== undefined) {
      setBlockTagVisibilityRaw(normalizeBlockTagVisibility(viewPreferences.blockTagVisibility));
    } else if (viewPreferences.blockTags !== undefined) {
      setBlockTagVisibilityRaw(normalizeBlockTagVisibility(viewPreferences.blockTags));
    }
    if (viewPreferences.themeInheritance !== undefined) {
      setThemeInheritanceRaw(viewPreferences.themeInheritance);
    }
    if (viewPreferences.layoutMode !== undefined) {
      setLayoutModeRaw(viewPreferences.layoutMode);
    }
  }, [viewPreferences]);

  // Wrap the view setters so user-driven changes emit a snapshot via
  // `onViewPreferencesChange`. Refs hold the latest values + callback so
  // each wrapper can build a current snapshot without re-creating itself
  // on every state change (the setters are kept referentially stable for
  // the context value's memoization).
  const onViewPreferencesChangeRef = useRef(onViewPreferencesChange);
  onViewPreferencesChangeRef.current = onViewPreferencesChange;
  const inlinePreviewRef = useRef(inlinePreviewVisible);
  inlinePreviewRef.current = inlinePreviewVisible;
  const statusBarRef = useRef(statusBarVisible);
  statusBarRef.current = statusBarVisible;
  const outlineRef = useRef(outlineVisible);
  outlineRef.current = outlineVisible;
  const blockTagVisibilityRef = useRef(blockTagVisibilityState);
  blockTagVisibilityRef.current = blockTagVisibilityState;
  const themeInheritanceRef = useRef(themeInheritanceState);
  themeInheritanceRef.current = themeInheritanceState;
  const layoutModeRef = useRef(layoutModeState);
  layoutModeRef.current = layoutModeState;
  const setInlinePreviewVisible = useCallback((visible: boolean) => {
    setInlinePreviewVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: visible,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: blockTagVisibilityRef.current !== 'none',
      blockTagVisibility: blockTagVisibilityRef.current,
      themeInheritance: themeInheritanceRef.current,
      layoutMode: layoutModeRef.current,
    });
  }, []);
  const setStatusBarVisible = useCallback((visible: boolean) => {
    setStatusBarVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: visible,
      outline: outlineRef.current,
      blockTags: blockTagVisibilityRef.current !== 'none',
      blockTagVisibility: blockTagVisibilityRef.current,
      themeInheritance: themeInheritanceRef.current,
      layoutMode: layoutModeRef.current,
    });
  }, []);
  const setOutlineVisible = useCallback((visible: boolean) => {
    setOutlineVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: visible,
      blockTags: blockTagVisibilityRef.current !== 'none',
      blockTagVisibility: blockTagVisibilityRef.current,
      themeInheritance: themeInheritanceRef.current,
      layoutMode: layoutModeRef.current,
    });
  }, []);
  const setBlockTagVisibility = useCallback((visibility: BlockTagVisibility) => {
    setBlockTagVisibilityRaw(visibility);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: visibility !== 'none',
      blockTagVisibility: visibility,
      themeInheritance: themeInheritanceRef.current,
      layoutMode: layoutModeRef.current,
    });
  }, []);
  const setBlockTagsVisible = useCallback(
    (visible: boolean) => setBlockTagVisibility(visible ? 'always' : 'none'),
    [setBlockTagVisibility],
  );
  const setThemeInheritance = useCallback((mode: ThemeInheritance) => {
    setThemeInheritanceRaw(mode);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: blockTagVisibilityRef.current !== 'none',
      blockTagVisibility: blockTagVisibilityRef.current,
      themeInheritance: mode,
      layoutMode: layoutModeRef.current,
    });
  }, []);
  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeRaw(mode);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: blockTagVisibilityRef.current !== 'none',
      blockTagVisibility: blockTagVisibilityRef.current,
      themeInheritance: themeInheritanceRef.current,
      layoutMode: mode,
    });
  }, []);
  const [tiptapEditor, setTiptapEditorRaw] = useState<TiptapEditor | null>(null);
  const [monacoEditor, setMonacoEditorRaw] = useState<MonacoEditor | null>(null);
  const setTiptapEditor = useCallback((editor: TiptapEditor | null) => {
    tiptapEditorRef.current = editor;
    setTiptapEditorRaw(editor);
  }, []);
  const setMonacoEditor = useCallback((editor: MonacoEditor | null) => {
    monacoEditorRef.current = editor;
    setMonacoEditorRaw(editor);
  }, []);

  useEffect(() => {
    const pending = pendingEditorScrollRef.current;
    if (!pending || pending.view !== activeView) return;

    const restore =
      activeView === 'raw' && monacoEditor
        ? () => restoreMonacoScrollRatio(monacoEditor, pending.ratio)
        : activeView === 'wysiwyg' && tiptapEditor
          ? () => restoreWysiwygScrollRatio(tiptapEditor, pending.ratio)
          : null;
    if (!restore) return;

    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      restore();
      if (pendingEditorScrollRef.current === pending) pendingEditorScrollRef.current = null;
    };

    if (typeof requestAnimationFrame === 'function') {
      const frame = requestAnimationFrame(apply);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }

    const timeout = setTimeout(apply, 0);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeView, monacoEditor, tiptapEditor]);
  // Mirror the focused canvas textbox editor (published by the inline
  // SceneTextOverlay through a module channel, since the canvas renders in
  // a detached React root outside this provider) so the toolbar can target it.
  const [activeSceneText, setActiveSceneText] = useState<SceneTextHandle | null>(null);
  const sceneTextChannel = useMemo(createSceneTextChannel, []);
  useEffect(() => sceneTextChannel.subscribe(setActiveSceneText), [sceneTextChannel]);

  const articleIdRef = useRef(articleId);
  articleIdRef.current = articleId;

  // Sync color scheme when prop changes
  useEffect(() => {
    setColorScheme(initialColorScheme);
  }, [initialColorScheme]);

  // Debounced parse on markdown source change
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipInitialDebouncedParseRef = useRef(Boolean(initialMarkdown));

  const doParse = useCallback((source: string) => {
    setIsParsing(true);
    try {
      const parsed = parseMarkdown(source);
      setMarkdownDocState(parsed);
      setParseError(null);

      // Generate Doc from parsed markdown
      try {
        const generatedDoc = markdownToDoc(parsed, {
          articleId: articleIdRef.current,
        });
        setDoc(generatedDoc);
      } catch (docErr: unknown) {
        // Doc generation can fail but markdown parse succeeded
        setDoc(null);
        console.warn('Doc generation failed:', docErr instanceof Error ? docErr.message : docErr);
      }
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Parse error');
      setMarkdownDocState(null);
      setDoc(null);
    } finally {
      setIsParsing(false);
    }
  }, []);

  // Parse on source changes with debounce. Skipped in code/image mode —
  // the WYSIWYG/Preview surfaces that consume markdownDoc/doc aren't
  // mounted, so there's nothing to feed and no reason to run the markdown
  // parser on TypeScript / JSON / a binary image asset.
  useEffect(() => {
    if (editorMode !== 'markdown') return;
    if (skipInitialDebouncedParseRef.current) {
      skipInitialDebouncedParseRef.current = false;
      return;
    }
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }
    setIsParsing(true);
    parseTimeoutRef.current = setTimeout(() => {
      doParse(markdownSource);
    }, 150);
    return () => {
      if (parseTimeoutRef.current) {
        clearTimeout(parseTimeoutRef.current);
      }
    };
  }, [markdownSource, doParse, editorMode]);

  // Initial parse
  useEffect(() => {
    if (editorMode !== 'markdown') return;
    if (initialMarkdown) {
      doParse(initialMarkdown);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMarkdownSource = useCallback((source: string) => {
    setMarkdownSourceRaw(source);
  }, []);

  // Block-at-a-time navigation. In 'document' mode the channel passes
  // through to the full source; in 'block' mode `editorSource` is the active
  // block's slice and `setEditorSource` splices edits back in. Gated to
  // markdown mode — code/image surfaces always edit the whole file.
  const blockNav = useBlockNavigator(markdownSource, setMarkdownSource, {
    enabled:
      (layoutModeState === 'block' || layoutModeState === 'timeline') && editorMode === 'markdown',
  });
  const {
    editorSource,
    setEditorSource,
    blockCount,
    activeBlockKey,
    activeBlockStartLine,
    goToBlock,
    goToBlockByLine,
    prevBlock,
    nextBlock,
    addBlock,
  } = blockNav;

  const insertAtCursor = useCallback(
    (text: string) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        // Insert as HTML so formatting is preserved
        const html = markdownToTiptap(text);
        tiptapEditor.chain().focus().insertContent(html).run();
      } else if (activeView === 'raw' && monacoEditor) {
        const position = monacoEditor.getPosition();
        if (position) {
          const model = monacoEditor.getModel();
          if (model) {
            const range = {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            };
            monacoEditor.executeEdits('drop', [{ range, text }]);
          }
        } else {
          // No cursor — append
          setMarkdownSourceRaw((prev) => prev + '\n\n' + text);
        }
      } else {
        // Preview or no editor — append to end
        setMarkdownSourceRaw((prev) => prev + '\n\n' + text);
      }
    },
    [activeView, tiptapEditor, monacoEditor],
  );

  const replaceAll = useCallback(
    (text: string) => {
      setMarkdownSourceRaw(text);

      // Push to editors if mounted
      if (tiptapEditor) {
        const html = markdownToTiptap(text);
        tiptapEditor.commands.setContent(html);
      }
      if (monacoEditor) {
        monacoEditor.setValue(text);
      }
    },
    [tiptapEditor, monacoEditor],
  );

  // ── Versioning ─────────────────────────────────────────
  // Build a manager only when versioning is opted in *and* a workspace
  // container exists. A versioning request without one is a misconfiguration
  // — warn once so it surfaces in dev without breaking the editor.
  const versioningWarnedRef = useRef(false);
  useEffect(() => {
    if (allowVersioning && !workspaceContainer && !versioningWarnedRef.current) {
      console.warn(
        '[squisq-editor] allowVersioning requires a `workspaceContainer` prop; versioning is disabled.',
      );
      versioningWarnedRef.current = true;
    }
  }, [allowVersioning, workspaceContainer]);

  const versioning = useMemo<DocumentVersionManager | null>(() => {
    if (!allowVersioning || !workspaceContainer) return null;
    return new DocumentVersionManager(workspaceContainer, { basename: versionBasename });
  }, [allowVersioning, workspaceContainer, versionBasename]);

  const onSaveVersionRef = useRef(onSaveVersion);
  onSaveVersionRef.current = onSaveVersion;
  const prunePolicyRef = useRef(versioningPrunePolicy);
  prunePolicyRef.current = versioningPrunePolicy;

  const saveVersion = useCallback(
    async (options?: SaveVersionOptions): Promise<SaveVersionResult> => {
      if (!versioning) {
        const skipped: SaveVersionResult = { saved: false, version: null, reason: 'no-document' };
        onSaveVersionRef.current?.(skipped);
        return skipped;
      }
      const result = await versioning.saveVersion(options);
      onSaveVersionRef.current?.(result);
      if (result.saved) {
        // Fire-and-forget prune. Failures here shouldn't block the save.
        versioning.pruneVersions(prunePolicyRef.current).catch((err: unknown) => {
          console.warn(
            '[squisq-editor] pruneVersions failed:',
            err instanceof Error ? err.message : err,
          );
        });
      }
      return result;
    },
    [versioning],
  );

  // Auto-save: stamp a new snapshot after `versioningAutoSaveIdleMs` of
  // idle. The "only save if different" check inside `saveVersion` makes
  // most ticks no-ops, so this is cheap. Disabled when the idle delay is
  // 0 or versioning isn't active.
  //
  // We pass the live `markdownSource` explicitly so saveVersion never has
  // to fall back to `container.readDocument()`. That fallback would fail
  // in setups where the markdown file lives outside the versioning
  // container's scope (e.g. DocBlocks, where the container points at
  // `<basename>_files/` while the doc itself lives in the parent
  // directory). Using the editor's live state also ensures the snapshot
  // captures the most recent edit even if the host's autosave to the
  // container hasn't flushed yet.
  useEffect(() => {
    if (!versioning) return;
    if (versioningAutoSaveIdleMs <= 0) return;
    const timer = setTimeout(() => {
      saveVersion({ content: markdownSource }).catch((err: unknown) => {
        console.warn(
          '[squisq-editor] auto-save version failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }, versioningAutoSaveIdleMs);
    return () => clearTimeout(timer);
  }, [markdownSource, versioning, versioningAutoSaveIdleMs, saveVersion]);

  const setMarkdownDoc = useCallback((newDoc: MarkdownDocument) => {
    setMarkdownDocState(newDoc);
    // Stringify to update the raw source
    try {
      const newSource = stringifyMarkdown(newDoc);
      setMarkdownSourceRaw(newSource);
      setParseError(null);

      // Generate Doc
      try {
        const generatedDoc = markdownToDoc(newDoc, {
          articleId: articleIdRef.current,
        });
        setDoc(generatedDoc);
      } catch (docErr: unknown) {
        setDoc(null);
        console.warn('Doc generation failed:', docErr instanceof Error ? docErr.message : docErr);
      }
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Stringify error');
    }
  }, []);

  const value = useMemo<EditorContextValue>(
    () => ({
      markdownSource,
      markdownDoc,
      doc,
      activeView,
      parseError,
      isParsing,
      colorScheme,
      editorMode,
      findMode,
      language: resolvedLanguage,
      inlinePreviewVisible,
      statusBarVisible,
      outlineVisible,
      blockTagVisibility: blockTagVisibilityState,
      blockTagsVisible,
      themeInheritance: themeInheritanceState,
      layoutMode: layoutModeState,
      editorSource,
      blockCount,
      activeBlockKey,
      activeBlockStartLine,
      imageEditTarget,
      mediaRevision,
      allowRecording,
      allowNarrate,
      tiptapEditor,
      monacoEditor,
      activeSceneText,
      sceneTextChannel,
      workspaceContainer,
      versioning,
      saveVersion,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      documentLinkProvider,
      setMarkdownSource,
      setEditorSource,
      setLayoutMode,
      goToBlock,
      goToBlockByLine,
      prevBlock,
      nextBlock,
      addBlock,
      setMarkdownDoc,
      setActiveView,
      setFindMode,
      setTiptapEditor,
      setMonacoEditor,
      setColorScheme,
      setInlinePreviewVisible,
      setStatusBarVisible,
      setOutlineVisible,
      setBlockTagVisibility,
      setBlockTagsVisible,
      setThemeInheritance,
      insertAtCursor,
      replaceAll,
      openImageEdit,
      closeImageEdit,
      bumpMediaRevision,
    }),
    [
      markdownSource,
      markdownDoc,
      doc,
      activeView,
      parseError,
      isParsing,
      colorScheme,
      editorMode,
      findMode,
      resolvedLanguage,
      inlinePreviewVisible,
      statusBarVisible,
      outlineVisible,
      blockTagVisibilityState,
      blockTagsVisible,
      themeInheritanceState,
      layoutModeState,
      editorSource,
      blockCount,
      activeBlockKey,
      activeBlockStartLine,
      tiptapEditor,
      monacoEditor,
      activeSceneText,
      sceneTextChannel,
      workspaceContainer,
      versioning,
      saveVersion,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      documentLinkProvider,
      setMarkdownSource,
      setEditorSource,
      setLayoutMode,
      goToBlock,
      goToBlockByLine,
      prevBlock,
      nextBlock,
      addBlock,
      setMarkdownDoc,
      setActiveView,
      setFindMode,
      setTiptapEditor,
      setMonacoEditor,
      setColorScheme,
      setInlinePreviewVisible,
      setStatusBarVisible,
      setOutlineVisible,
      setBlockTagVisibility,
      setBlockTagsVisible,
      setThemeInheritance,
      insertAtCursor,
      replaceAll,
      imageEditTarget,
      mediaRevision,
      allowRecording,
      allowNarrate,
      openImageEdit,
      closeImageEdit,
      bumpMediaRevision,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
