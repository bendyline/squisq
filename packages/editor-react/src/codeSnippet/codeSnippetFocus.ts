import type { editor as MonacoEditor } from 'monaco-editor';

/** Transaction metadata used to focus only a newly inserted code-snippet widget. */
export const CODE_SNIPPET_FOCUS_INSERTED_META = 'squisq-code-snippet-focus-inserted';

/** Place Monaco's primary caret immediately after the snippet body. */
export function focusCodeSnippetAtEnd(editor: MonacoEditor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  if (!model) return;
  const endPosition = model.getPositionAt(model.getValueLength());
  editor.setPosition(endPosition);
  editor.revealPositionInCenterIfOutsideViewport(endPosition);
  editor.focus();
}
