/** Monaco inset mounted in place of an ordinary language-tagged code fence. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import type { Editor } from '@tiptap/react';
import type { CodeBlockCopyHandler } from '@bendyline/squisq-react';
import { Icon } from '../Icon';
import { replaceCodeSnippetText } from './codeSnippetCommands';
import { useCodeSnippetData } from './codeSnippetData';
import { focusCodeSnippetAtEnd } from './codeSnippetFocus';
import { codeSnippetFenceLanguageToken } from './codeSnippetLanguages';
import { codeSnippetAutoHeight } from './codeSnippetSizing';
import { FenceMonacoEditor } from './FenceMonacoEditor';
import { useEditorEditable, useHostColorScheme } from './fenceEditorHooks';

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

export function CodeSnippetWidget({
  editor,
  blockId,
  host,
  focusOnMount = false,
  onCopyCode,
}: CodeSnippetWidgetProps) {
  const data = useCodeSnippetData(editor, blockId);
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

  const handleChange = useCallback(
    (value: string) => {
      if (!editable) return;
      replaceCodeSnippetText(editor, blockId, value);
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
      <FenceMonacoEditor
        modelPath={`inmemory://squisq/code-snippet/${modelInstanceId}/${blockId}.${modelSuffix || 'txt'}`}
        language={data.monacoLanguage}
        source={data.source}
        editable={editable}
        colorScheme={colorScheme}
        onChange={handleChange}
        onMount={handleMount}
        ariaLabel={`${data.label} code editor`}
      />
    </div>
  );
}

export default CodeSnippetWidget;
