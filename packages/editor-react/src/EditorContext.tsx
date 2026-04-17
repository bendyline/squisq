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

/** Monaco standalone code editor instance type */
type MonacoEditor = MonacoEditorNs.IStandaloneCodeEditor;

// ─── Types ───────────────────────────────────────────────

export type EditorView = 'raw' | 'wysiwyg' | 'preview';
export type EditorTheme = 'light' | 'dark';

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
  children,
}: EditorProviderProps) {
  const [markdownSource, setMarkdownSourceRaw] = useState(initialMarkdown);
  const [markdownDoc, setMarkdownDocState] = useState<MarkdownDocument | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [activeView, setActiveView] = useState<EditorView>(initialView);
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

  // Parse on source changes with debounce
  useEffect(() => {
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
  }, [markdownSource, doParse]);

  // Initial parse
  useEffect(() => {
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
      tiptapEditor,
      monacoEditor,
      mediaProvider,
      imageDisplayMode,
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
      tiptapEditor,
      monacoEditor,
      mediaProvider,
      imageDisplayMode,
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
