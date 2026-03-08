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

// Use locally installed monaco-editor instead of CDN
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
}: RawEditorProps) {
  const { markdownSource, setMarkdownSource, setMonacoEditor } = useEditorContext();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const isExternalUpdate = useRef(false);
  const completionDisposable = useRef<monaco.IDisposable | null>(null);

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
    },
    [setMonacoEditor],
  );

  // Unregister on unmount
  useEffect(() => {
    return () => {
      setMonacoEditor(null);
      completionDisposable.current?.dispose();
      completionDisposable.current = null;
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
