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
export type EditorTheme = 'light' | 'dark';
/**
 * How much of the active Squisq theme the WYSIWYG editing surface
 * mirrors. `'fonts'` is the historical default — body and heading
 * fonts only. `'fonts-colors'` also borrows the theme canvas / text
 * colors. `'none'` opts out completely.
 */
export type ThemeInheritance = 'none' | 'fonts' | 'fonts-colors';
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
  /** Current color theme */
  theme: EditorTheme;
  /** Operating mode — 'markdown' for the full shell, 'code' for Monaco-only. */
  editorMode: EditorMode;
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
  /**
   * Whether inline block-template tags (the chip next to each templated
   * heading in the WYSIWYG view, plus the subtle affordance chip on plain
   * headings) are currently visible. Initialized from the EditorShell
   * `blockTags` prop (default true); the View menu in the toolbar can
   * toggle it at runtime.
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
}

export interface EditorActions {
  /** Set markdown source and trigger re-parse */
  setMarkdownSource: (source: string) => void;
  /** Set markdown from a MarkdownDocument (e.g. from WYSIWYG) */
  setMarkdownDoc: (doc: MarkdownDocument) => void;
  /** Switch the active view */
  setActiveView: (view: EditorView) => void;
  /** Register / unregister the Tiptap editor instance (called by WysiwygEditor) */
  setTiptapEditor: (editor: TiptapEditor | null) => void;
  /** Register / unregister the Monaco editor instance (called by RawEditor) */
  setMonacoEditor: (editor: MonacoEditor | null) => void;
  /** Set the color theme */
  setTheme: (theme: EditorTheme) => void;
  /** Show or hide the inline preview gutter at runtime (driven by the View menu). */
  setInlinePreviewVisible: (visible: boolean) => void;
  /** Show or hide the bottom status bar at runtime (driven by the View menu). */
  setStatusBarVisible: (visible: boolean) => void;
  /** Show or hide the left-side outline pane at runtime (driven by the View menu). */
  setOutlineVisible: (visible: boolean) => void;
  /** Show or hide inline block-template tags at runtime (driven by the View menu). */
  setBlockTagsVisible: (visible: boolean) => void;
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
  /** Color theme */
  theme?: EditorTheme;
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
   * File name (e.g. `foo.ts`) or bare extension — used to pick a Monaco
   * language and decide between markdown vs. code mode.
   */
  fileName?: string;
  /** Explicit Monaco language ID — wins over the fileName-derived one. */
  language?: string;
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
   * Initial visibility of inline block-template tags on headings.
   * Defaults to true. The toolbar's View menu can toggle it at runtime.
   */
  blockTags?: boolean;
  /**
   * Initial value for how much of the active Squisq theme the WYSIWYG
   * editing surface should mirror. Defaults to `'fonts'` — the
   * historical behavior of inheriting body / heading fonts only. The
   * toolbar's View menu can change it at runtime.
   */
  themeInheritance?: ThemeInheritance;
  /**
   * Bundled view preferences — a serializable JSON blob covering all
   * runtime-toggleable view options. When provided, individual values
   * here override the matching individual props (`inlinePreview`,
   * `showStatusBar`, `outline`). Hosts wiring this up typically load
   * the blob from their own preferences storage and pair it with
   * {@link onViewPreferencesChange}.
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
  /** How much of the active Squisq theme the WYSIWYG surface mirrors. */
  themeInheritance?: ThemeInheritance;
}

/**
 * Provides shared editor state to all child components.
 * Automatically parses markdown and generates a Doc whenever the source changes.
 */
const DEFAULT_PRUNE_POLICY: PrunePolicy = { type: 'keep-last-n', n: 50 };
const DEFAULT_AUTOSAVE_IDLE_MS = 5_000;

export function EditorProvider({
  initialMarkdown = '',
  initialView = 'raw',
  articleId = 'untitled',
  theme: initialTheme = 'light',
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
  fileName,
  language,
  inlinePreview = false,
  showStatusBar = true,
  outline = false,
  blockTags = true,
  themeInheritance = 'fonts',
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
  const effectiveBlockTags = viewPreferences?.blockTags ?? blockTags;
  const effectiveThemeInheritance = viewPreferences?.themeInheritance ?? themeInheritance;
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
  const setActiveView = useCallback(
    (view: EditorView) => {
      // In code mode only the raw view is valid. In image mode no text view
      // is valid at all — ignore any switch attempt.
      if (editorMode === 'code' && view !== 'raw') return;
      if (editorMode === 'image') return;
      setActiveViewRaw(view);
    },
    [editorMode],
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [theme, setTheme] = useState<EditorTheme>(initialTheme);
  const [inlinePreviewVisible, setInlinePreviewVisibleRaw] =
    useState<boolean>(effectiveInlinePreview);
  // Sync visibility when the host changes the prop (e.g., toggle from outside).
  useEffect(() => {
    setInlinePreviewVisibleRaw(inlinePreview);
  }, [inlinePreview]);
  const [statusBarVisible, setStatusBarVisibleRaw] = useState<boolean>(effectiveShowStatusBar);
  useEffect(() => {
    setStatusBarVisibleRaw(showStatusBar);
  }, [showStatusBar]);
  const [outlineVisible, setOutlineVisibleRaw] = useState<boolean>(effectiveOutline);
  useEffect(() => {
    setOutlineVisibleRaw(outline);
  }, [outline]);
  const [blockTagsVisible, setBlockTagsVisibleRaw] = useState<boolean>(effectiveBlockTags);
  useEffect(() => {
    setBlockTagsVisibleRaw(blockTags);
  }, [blockTags]);
  const [themeInheritanceState, setThemeInheritanceRaw] =
    useState<ThemeInheritance>(effectiveThemeInheritance);
  useEffect(() => {
    setThemeInheritanceRaw(themeInheritance);
  }, [themeInheritance]);
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
    if (viewPreferences.blockTags !== undefined) {
      setBlockTagsVisibleRaw(viewPreferences.blockTags);
    }
    if (viewPreferences.themeInheritance !== undefined) {
      setThemeInheritanceRaw(viewPreferences.themeInheritance);
    }
  }, [viewPreferences]);

  // Wrap the three setters so user-driven toggles emit a snapshot via
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
  const blockTagsRef = useRef(blockTagsVisible);
  blockTagsRef.current = blockTagsVisible;
  const themeInheritanceRef = useRef(themeInheritanceState);
  themeInheritanceRef.current = themeInheritanceState;
  const setInlinePreviewVisible = useCallback((visible: boolean) => {
    setInlinePreviewVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: visible,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: blockTagsRef.current,
      themeInheritance: themeInheritanceRef.current,
    });
  }, []);
  const setStatusBarVisible = useCallback((visible: boolean) => {
    setStatusBarVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: visible,
      outline: outlineRef.current,
      blockTags: blockTagsRef.current,
      themeInheritance: themeInheritanceRef.current,
    });
  }, []);
  const setOutlineVisible = useCallback((visible: boolean) => {
    setOutlineVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: visible,
      blockTags: blockTagsRef.current,
      themeInheritance: themeInheritanceRef.current,
    });
  }, []);
  const setBlockTagsVisible = useCallback((visible: boolean) => {
    setBlockTagsVisibleRaw(visible);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: visible,
      themeInheritance: themeInheritanceRef.current,
    });
  }, []);
  const setThemeInheritance = useCallback((mode: ThemeInheritance) => {
    setThemeInheritanceRaw(mode);
    onViewPreferencesChangeRef.current?.({
      inlinePreview: inlinePreviewRef.current,
      showStatusBar: statusBarRef.current,
      outline: outlineRef.current,
      blockTags: blockTagsRef.current,
      themeInheritance: mode,
    });
  }, []);
  const [tiptapEditor, setTiptapEditor] = useState<TiptapEditor | null>(null);
  const [monacoEditor, setMonacoEditor] = useState<MonacoEditor | null>(null);

  const articleIdRef = useRef(articleId);
  articleIdRef.current = articleId;

  // Sync theme when prop changes
  useEffect(() => {
    setTheme(initialTheme);
  }, [initialTheme]);

  // Debounced parse on markdown source change
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }
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
      theme,
      editorMode,
      language: resolvedLanguage,
      inlinePreviewVisible,
      statusBarVisible,
      outlineVisible,
      blockTagsVisible,
      themeInheritance: themeInheritanceState,
      imageEditTarget,
      mediaRevision,
      allowRecording,
      tiptapEditor,
      monacoEditor,
      workspaceContainer,
      versioning,
      saveVersion,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      documentLinkProvider,
      setMarkdownSource,
      setMarkdownDoc,
      setActiveView,
      setTiptapEditor,
      setMonacoEditor,
      setTheme,
      setInlinePreviewVisible,
      setStatusBarVisible,
      setOutlineVisible,
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
      theme,
      editorMode,
      resolvedLanguage,
      inlinePreviewVisible,
      statusBarVisible,
      outlineVisible,
      blockTagsVisible,
      themeInheritanceState,
      tiptapEditor,
      monacoEditor,
      workspaceContainer,
      versioning,
      saveVersion,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      documentLinkProvider,
      setMarkdownSource,
      setMarkdownDoc,
      setActiveView,
      setTiptapEditor,
      setMonacoEditor,
      setTheme,
      setInlinePreviewVisible,
      setStatusBarVisible,
      setOutlineVisible,
      setBlockTagsVisible,
      setThemeInheritance,
      insertAtCursor,
      replaceAll,
      imageEditTarget,
      mediaRevision,
      allowRecording,
      openImageEdit,
      closeImageEdit,
      bumpMediaRevision,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
