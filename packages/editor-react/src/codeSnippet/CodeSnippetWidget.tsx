/** Monaco inset mounted in place of an ordinary language-tagged code fence. */

import { useCallback, useEffect, useRef, useState } from 'react';
import MonacoEditor, { type OnChange, type OnMount } from '@monaco-editor/react';
import type { Editor } from '@tiptap/react';
import type { CodeBlockCopyHandler } from '@bendyline/squisq-react';
import { Icon } from '../Icon';
import { useMonacoLoader } from '../useMonacoLoader';
import { replaceCodeSnippetText } from './codeSnippetCommands';
import { useCodeSnippetData } from './codeSnippetData';
import { focusCodeSnippetAtEnd } from './codeSnippetFocus';
import { codeSnippetFenceLanguageToken } from './codeSnippetLanguages';
import { CODE_SNIPPET_LINE_HEIGHT, codeSnippetAutoHeight } from './codeSnippetSizing';

// A block id is stable only within one Tiptap editor. Old decoration roots
// unmount asynchronously, so two editor generations can briefly overlap.
// Give each widget mount its own Monaco model namespace; otherwise the old
// widget's cleanup can dispose the replacement widget's same-path model.
let nextCodeSnippetModelInstanceId = 0;

function allocateCodeSnippetModelInstanceId(): number {
  nextCodeSnippetModelInstanceId += 1;
  return nextCodeSnippetModelInstanceId;
}

export interface CodeSnippetWidgetProps {
  editor: Editor;
  blockId: string;
  host?: HTMLElement | null;
  /** Focus this newly inserted snippet after Monaco has mounted. */
  focusOnMount?: boolean;
  /**
   * Getter for the host clipboard adapter. Read at click time so a host can
   * swap its implementation without remounting the widget. When it yields
   * nothing, the button falls back to `navigator.clipboard`.
   */
  onCopyCode?: () => CodeBlockCopyHandler | undefined;
}

function schemeFromHost(host: HTMLElement | null | undefined): 'light' | 'dark' {
  return host?.closest<HTMLElement>('[data-theme]')?.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Resolve the color scheme from the widget's host element, or `null` when the
 * host is detached from the document.
 *
 * `null` matters because Monaco's theme is page-global: every mounted
 * `<MonacoEditor>` re-applies its own `theme` prop to every editor on the
 * page. ProseMirror can rebuild widget decorations during a view-mode switch,
 * producing a widget whose DOM is torn down again within milliseconds — but
 * whose React root still renders once. By then the host tree is detached, so
 * `closest('[data-theme]')` finds nothing and the scheme would fall back to
 * `'light'`, restyling the Source editor that just mounted dark. A `null`
 * scheme tells the widget to keep its placeholder and never mount Monaco.
 *
 * A host that was merely rendered a frame before its editor view attached
 * flips to a real scheme on the follow-up check; a teardown zombie never
 * does. A missing host (`undefined`/`null`) keeps the historical light
 * default so host-less mounts still render.
 */
function useHostColorScheme(host: HTMLElement | null | undefined): 'light' | 'dark' | null {
  const [scheme, setScheme] = useState<'light' | 'dark' | null>(() =>
    host != null && !host.isConnected ? null : schemeFromHost(host),
  );
  useEffect(() => {
    if (host != null && !host.isConnected) {
      setScheme(null);
      const raf = requestAnimationFrame(() => {
        if (host.isConnected) setScheme(schemeFromHost(host));
      });
      return () => cancelAnimationFrame(raf);
    }
    const themedAncestor = host?.closest<HTMLElement>('[data-theme]');
    setScheme(schemeFromHost(host));
    if (!themedAncestor || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => setScheme(schemeFromHost(host)));
    observer.observe(themedAncestor, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [host]);
  return scheme;
}

type CopyStatus = 'idle' | 'copied' | 'failed';

const COPY_LABELS: Record<CopyStatus, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Copy failed',
};

const COPY_ICONS: Record<CopyStatus, string> = {
  idle: 'fa-regular fa-copy',
  copied: 'fa-solid fa-check',
  failed: 'fa-solid fa-triangle-exclamation',
};

async function writeSnippetToClipboard(
  source: string,
  language: string,
  handler: CodeBlockCopyHandler | undefined,
): Promise<void> {
  if (handler) {
    await handler(source, language ? { language } : {});
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this host');
  }
  await navigator.clipboard.writeText(source);
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
  onCopyCode,
}: CodeSnippetWidgetProps) {
  const data = useCodeSnippetData(editor, blockId);
  const { ready } = useMonacoLoader(data?.monacoLanguage);
  const colorScheme = useHostColorScheme(host);
  const editable = useEditorEditable(editor);
  const [modelInstanceId] = useState(allocateCodeSnippetModelInstanceId);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>();
  // Source and language are read through refs so the click handler survives
  // every keystroke the author makes inside the snippet.
  const sourceRef = useRef('');
  sourceRef.current = data?.source ?? '';
  const languageRef = useRef('');
  languageRef.current = data?.fenceLanguage ?? '';

  useEffect(
    () => () => {
      if (copyResetTimer.current !== undefined) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await writeSnippetToClipboard(sourceRef.current, languageRef.current, onCopyCode?.());
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    if (copyResetTimer.current !== undefined) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopyStatus('idle'), 1600);
  }, [onCopyCode]);

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
        <button
          type="button"
          className="squisq-code-snippet-copy"
          data-copy-state={copyStatus}
          onClick={() => void handleCopy()}
          // The widget host swallows mousedown to keep ProseMirror from moving
          // the selection; preventing it here also keeps focus where it was.
          onMouseDown={(event) => event.preventDefault()}
          title={COPY_LABELS[copyStatus]}
          aria-label={'Copy ' + data.label + ' snippet to clipboard'}
        >
          <Icon icon={COPY_ICONS[copyStatus]} />
          <span>{COPY_LABELS[copyStatus]}</span>
        </button>
      </div>
      <div className="squisq-code-snippet-editor" aria-label={`${data.label} code editor`}>
        {ready && colorScheme !== null ? (
          <MonacoEditor
            path={`inmemory://squisq/code-snippet/${modelInstanceId}/${blockId}.${modelSuffix || 'txt'}`}
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
