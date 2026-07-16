/** Monaco inset mounted in place of an ordinary language-tagged code fence. */

import { useCallback, useEffect, useState } from 'react';
import MonacoEditor, { type OnChange, type OnMount } from '@monaco-editor/react';
import type { Editor } from '@tiptap/react';
import { Icon } from '../Icon';
import { useMonacoLoader } from '../useMonacoLoader';
import { replaceCodeSnippetText } from './codeSnippetCommands';
import { useCodeSnippetData } from './codeSnippetData';
import { focusCodeSnippetAtEnd } from './codeSnippetFocus';
import { codeSnippetFenceLanguageToken } from './codeSnippetLanguages';
import { CODE_SNIPPET_LINE_HEIGHT, codeSnippetAutoHeight } from './codeSnippetSizing';

export interface CodeSnippetWidgetProps {
  editor: Editor;
  blockId: string;
  host?: HTMLElement | null;
  /** Focus this newly inserted snippet after Monaco has mounted. */
  focusOnMount?: boolean;
}

function schemeFromHost(host: HTMLElement | null | undefined): 'light' | 'dark' {
  return host?.closest<HTMLElement>('[data-theme]')?.dataset.theme === 'dark' ? 'dark' : 'light';
}

function useHostColorScheme(host: HTMLElement | null | undefined): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() => schemeFromHost(host));
  useEffect(() => {
    const themedAncestor = host?.closest<HTMLElement>('[data-theme]');
    setScheme(schemeFromHost(host));
    if (!themedAncestor || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setScheme(schemeFromHost(host)));
    observer.observe(themedAncestor, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [host]);
  return scheme;
}

function useEditorEditable(editor: Editor): boolean {
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    editor.on('update', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('update', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);
  return editable;
}

export function CodeSnippetWidget({
  editor,
  blockId,
  host,
  focusOnMount = false,
}: CodeSnippetWidgetProps) {
  const data = useCodeSnippetData(editor, blockId);
  const { ready } = useMonacoLoader();
  const colorScheme = useHostColorScheme(host);
  const editable = useEditorEditable(editor);

  const handleChange: OnChange = useCallback(
    (value) => {
      if (!editable) return;
      replaceCodeSnippetText(editor, blockId, value ?? '');
    },
    [blockId, editable, editor],
  );
  const handleMount: OnMount = useCallback(
    (mountedEditor) => {
      if (focusOnMount && editable) focusCodeSnippetAtEnd(mountedEditor);
    },
    [editable, focusOnMount],
  );

  if (!data) return null;
  const modelSuffix = codeSnippetFenceLanguageToken(data.fenceLanguage).replace(
    /[^a-z0-9_-]/g,
    '-',
  );

  return (
    <div
      className="squisq-code-snippet-shell"
      data-language={data.fenceLanguage}
      style={{ height: codeSnippetAutoHeight(data.source) }}
    >
      <div className="squisq-code-snippet-header">
        <span className="squisq-code-snippet-title">
          <Icon icon="fa-solid fa-file-code" />
          <span>{data.label}</span>
        </span>
      </div>
      <div className="squisq-code-snippet-editor" aria-label={`${data.label} code editor`}>
        {ready ? (
          <MonacoEditor
            path={`inmemory://squisq/code-snippet/${blockId}.${modelSuffix || 'txt'}`}
            language={data.monacoLanguage}
            theme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
            value={data.source}
            onChange={handleChange}
            onMount={handleMount}
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
    </div>
  );
}

export default CodeSnippetWidget;
