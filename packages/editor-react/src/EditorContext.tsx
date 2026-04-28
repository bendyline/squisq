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

// ─── Types ───────────────────────────────────────────────

export type EditorView = 'raw' | 'wysiwyg' | 'preview';
export type EditorTheme = 'light' | 'dark';
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
  /** Insert text at the current cursor position in the active editor */
  insertAtCursor: (text: string) => void;
  /** Replace all editor content with the given text */
  replaceAll: (text: string) => void;
}

export interface EditorContextValue extends EditorState, EditorActions {
  /** The live Tiptap editor instance (null when WYSIWYG is not mounted) */
  tiptapEditor: TiptapEditor | null;
  /** The live Monaco editor instance (null when Raw is not mounted) */
  monacoEditor: MonacoEditor | null;
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
   * File name (e.g. `foo.ts`) or bare extension — used to pick a Monaco
   * language and decide between markdown vs. code mode.
   */
  fileName?: string;
  /** Explicit Monaco language ID — wins over the fileName-derived one. */
  language?: string;
  children: ReactNode;
}

/**
 * Provides shared editor state to all child components.
 * Automatically parses markdown and generates a Doc whenever the source changes.
 */
export function EditorProvider({
  initialMarkdown = '',
  initialView = 'raw',
  articleId = 'untitled',
  theme: initialTheme = 'light',
  mediaProvider = null,
  imageDisplayMode = 'inline',
  mentionProvider = null,
  fileName,
  language,
  children,
}: EditorProviderProps) {
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
      tiptapEditor,
      monacoEditor,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      setMarkdownSource,
      setMarkdownDoc,
      setActiveView,
      setTiptapEditor,
      setMonacoEditor,
      setTheme,
      insertAtCursor,
      replaceAll,
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
      tiptapEditor,
      monacoEditor,
      mediaProvider,
      imageDisplayMode,
      mentionProvider,
      setMarkdownSource,
      setMarkdownDoc,
      setActiveView,
      setTiptapEditor,
      setMonacoEditor,
      setTheme,
      insertAtCursor,
      replaceAll,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
