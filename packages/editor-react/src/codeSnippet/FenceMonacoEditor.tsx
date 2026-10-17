/**
 * The Monaco editor a fenced block shows its source in: the code-snippet
 * inset's editor, shared with the SVG island widget's Source view so both
 * load, theme and size Monaco the same way.
 */

import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { useMonacoLoader } from '../useMonacoLoader';
import { CODE_SNIPPET_LINE_HEIGHT } from './codeSnippetSizing';

export interface FenceMonacoEditorProps {
  /**
   * A model path unique to this mount (old decoration roots unmount
   * asynchronously, and a shared path would let one dispose the other's model).
   */
  modelPath: string;
  /** Monaco language id. */
  language: string;
  source: string;
  editable: boolean;
  /** From `useHostColorScheme`; null keeps the placeholder up. */
  colorScheme: 'light' | 'dark' | null;
  onChange: (value: string) => void;
  onMount?: OnMount;
  ariaLabel: string;
}

export function FenceMonacoEditor({
  modelPath,
  language,
  source,
  editable,
  colorScheme,
  onChange,
  onMount,
  ariaLabel,
}: FenceMonacoEditorProps) {
  const { ready } = useMonacoLoader(language);
  return (
    <div className="squisq-code-snippet-editor" aria-label={ariaLabel}>
      {ready && colorScheme !== null ? (
        <MonacoEditor
          path={modelPath}
          language={language}
          theme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
          value={source}
          onChange={(value) => onChange(value ?? '')}
          onMount={onMount}
          options={{
            automaticLayout: true,
            contextmenu: true,
            folding: true,
            fontSize: 13,
            lineHeight: CODE_SNIPPET_LINE_HEIGHT,
            lineNumbers: 'on',
            minimap: { enabled: false },
            padding: { top: 10, bottom: 10 },
            readOnly: !editable,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'off',
          }}
        />
      ) : (
        <div className="squisq-code-snippet-loading">Loading code editor…</div>
      )}
    </div>
  );
}
