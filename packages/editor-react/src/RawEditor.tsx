/**
 * RawEditor
 *
 * Monaco-based raw markdown editor. Provides full VS Code-like editing
 * experience with syntax highlighting, minimap, and bracket matching.
 * Syncs changes back to EditorContext on every keystroke (debounced).
 */

import { useRef, useCallback, useEffect } from 'react';
import Editor, { loader, type OnMount, type OnChange } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { useEditorContext } from './EditorContext';
import { getAvailableTemplates } from '@bendyline/squisq/doc';
import { SQUISQ_MEDIA_MIME, parseSquisqMediaPayload } from './mediaDragMime';

// Use locally installed monaco-editor instead of CDN.
//
// NOTE: By default this imports the full monaco-editor with all 80+ languages
// and workers (~9MB). Consumers can dramatically reduce bundle size by aliasing
// 'monaco-editor' to a slim entry in their bundler config. For example with Vite:
//
//   resolve: { alias: [{ find: /^monaco-editor$/, replacement: './monaco-slim.ts' }] }
//
// Where monaco-slim.ts re-exports 'monaco-editor/esm/vs/editor/editor.api' plus
// only the language contributions needed (e.g. markdown, javascript, etc.).
loader.config({ monaco });

export interface RawEditorProps {
  /** Monaco editor theme (default: 'vs-dark') */
  theme?: string;
  /** Show minimap (default: false) */
  minimap?: boolean;
  /** Font size in pixels (default: 14) */
  fontSize?: number;
  /** Word wrap setting (default: 'on') */
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  /** Additional class name for the container */
  className?: string;
  /**
   * Chat-composer mode: Enter fires this callback (submit) and Cmd/Ctrl+Enter
   * inserts a newline. When undefined, behaves normally.
   */
  submitOnEnter?: () => void;
}

/**
 * Raw markdown editor using Monaco Editor.
 * Binds to the shared EditorContext for source synchronization.
 */
export function RawEditor({
  theme = 'vs',
  minimap = false,
  fontSize = 14,
  wordWrap = 'on',
  className,
  submitOnEnter,
}: RawEditorProps) {
  const { markdownSource, setMarkdownSource, setMonacoEditor } = useEditorContext();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const isExternalUpdate = useRef(false);
  const completionDisposable = useRef<monaco.IDisposable | null>(null);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const keyDisposable = useRef<monaco.IDisposable | null>(null);
  // Ref so the keydown handler always sees the latest callback.
  const submitOnEnterRef = useRef(submitOnEnter);
  useEffect(() => {
    submitOnEnterRef.current = submitOnEnter;
  }, [submitOnEnter]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      setMonacoEditor(editor);
      editor.focus();

      // Dispose any previous completion provider (from a prior mount)
      completionDisposable.current?.dispose();

      // Register template annotation completion provider for {[ trigger
      const templates = getAvailableTemplates();
      completionDisposable.current = monaco.languages.registerCompletionItemProvider('markdown', {
        triggerCharacters: ['['],
        provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position) {
          const lineContent = model.getLineContent(position.lineNumber);

          // Only trigger inside a heading line that has {[ before the cursor
          if (!/^#{1,6}\s/.test(lineContent)) return { suggestions: [] };

          const textBeforeCursor = lineContent.substring(0, position.column - 1);
          const bracketIdx = textBeforeCursor.lastIndexOf('{[');
          if (bracketIdx === -1) return { suggestions: [] };

          // The range to replace: from after {[ to the cursor
          const startCol = bracketIdx + 3; // after {[
          const range = new monaco.Range(
            position.lineNumber,
            startCol,
            position.lineNumber,
            position.column,
          );

          const suggestions = templates.map((name) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: name + ']}',
            range,
            detail: 'Block template',
            sortText: name,
          }));

          return { suggestions };
        },
      });

      // Chat-composer mode: intercept Enter before Monaco inserts a newline.
      // Cmd/Ctrl+Enter falls through so the native newline still works.
      keyDisposable.current?.dispose();
      keyDisposable.current = editor.onKeyDown((e) => {
        if (e.keyCode !== monaco.KeyCode.Enter) return;
        if (!submitOnEnterRef.current) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        submitOnEnterRef.current();
      });

      // Attach native drop listeners for in-app MediaBin drags. Monaco's own
      // drop handling doesn't know about our custom MIME type, so we insert
      // markdown image syntax explicitly in the capture phase.
      dropCleanupRef.current?.();
      const domNode = editor.getDomNode();
      if (domNode) {
        const onDragOver = (e: DragEvent) => {
          if (e.dataTransfer?.types.includes(SQUISQ_MEDIA_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        };
        const onDrop = (e: DragEvent) => {
          const dt = e.dataTransfer;
          if (!dt) return;
          const raw = dt.getData(SQUISQ_MEDIA_MIME);
          if (!raw) return;
          const payload = parseSquisqMediaPayload(raw);
          if (!payload || !payload.mimeType.startsWith('image/')) return;

          e.preventDefault();
          e.stopPropagation();

          const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
          const position = target?.position ?? editor.getPosition();
          if (!position) return;

          const markdown = `![${payload.alt}](${payload.name})`;
          editor.executeEdits('squisq-media-drop', [
            {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
              text: markdown,
              forceMoveMarkers: true,
            },
          ]);
          editor.focus();
        };
        domNode.addEventListener('dragover', onDragOver, true);
        domNode.addEventListener('drop', onDrop, true);
        dropCleanupRef.current = () => {
          domNode.removeEventListener('dragover', onDragOver, true);
          domNode.removeEventListener('drop', onDrop, true);
        };
      }
    },
    [setMonacoEditor],
  );

  // Unregister on unmount
  useEffect(() => {
    return () => {
      setMonacoEditor(null);
      completionDisposable.current?.dispose();
      completionDisposable.current = null;
      dropCleanupRef.current?.();
      dropCleanupRef.current = null;
      keyDisposable.current?.dispose();
      keyDisposable.current = null;
    };
  }, [setMonacoEditor]);

  const handleChange: OnChange = useCallback(
    (value) => {
      if (isExternalUpdate.current) return;
      if (value !== undefined) {
        setMarkdownSource(value);
      }
    },
    [setMarkdownSource],
  );

  // When external changes happen (e.g. from WYSIWYG), update Monaco
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      const currentValue = editor.getValue();
      if (currentValue !== markdownSource) {
        isExternalUpdate.current = true;
        editor.setValue(markdownSource);
        isExternalUpdate.current = false;
      }
    }
  }, [markdownSource]);

  return (
    <div className={className} style={{ width: '100%', height: '100%' }} data-testid="raw-editor">
      <Editor
        defaultLanguage="markdown"
        value={markdownSource}
        theme={theme}
        onMount={handleMount}
        onChange={handleChange}
        options={{
          fontSize,
          wordWrap,
          minimap: { enabled: minimap },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { indentation: true },
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
