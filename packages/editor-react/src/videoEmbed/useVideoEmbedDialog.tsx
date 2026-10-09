/**
 * Insert → Online Video, as one hook the toolbar mounts (the toolbar is at its
 * size budget, so the whole flow lives here).
 *
 * `open()` reads the caret: on an existing video paragraph — in the Write
 * view, or a standalone video line in the Source view — the dialog opens in
 * edit mode and confirming REPLACES that paragraph; anywhere else it inserts a
 * new one through `insertVideoEmbedReference`. `element` is the dialog while it
 * is open, for the toolbar to render.
 */

import { useCallback, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import { findBlockVideoEmbed, parseMarkdown, type VideoEmbed } from '@bendyline/squisq/markdown';
import { useEditorContext, type EditorView } from '../EditorContext';
import { insertVideoEmbedReference } from '../mediaInsertion';
import { VideoEmbedDialog } from './VideoEmbedDialog';
import {
  videoEmbedMarkdown,
  videoEmbedOfParagraph,
  videoEmbedParagraphJson,
} from './videoEmbedParagraph';

type EditTarget = { view: 'wysiwyg'; from: number; to: number } | { view: 'raw'; line: number };

interface DialogState {
  initialInput: string;
  initialTitle: string;
  target: EditTarget | null;
}

function isBlank(line: string | null): boolean {
  return line === null || line.trim() === '';
}

/** The video paragraph under the caret, if any, and how to replace it. */
export function videoEmbedAtCaret(
  activeView: EditorView,
  tiptapEditor: Editor | null,
  monacoEditor: MonacoEditorNs.IStandaloneCodeEditor | null,
): DialogState | null {
  if (activeView === 'wysiwyg' && tiptapEditor) {
    const { $from } = tiptapEditor.state.selection;
    if ($from.depth < 1) return null;
    const found = videoEmbedOfParagraph($from.node(1));
    if (!found) return null;
    return {
      initialInput: found.embed.watchUrl,
      initialTitle: found.title ?? '',
      target: { view: 'wysiwyg', from: $from.before(1), to: $from.after(1) },
    };
  }
  if (activeView === 'raw' && monacoEditor) {
    const model = monacoEditor.getModel();
    const line = monacoEditor.getSelection()?.startLineNumber;
    if (!model || !line) return null;
    const text = model.getLineContent(line);
    // Its own paragraph: a line glued to prose is part of that paragraph.
    const previous = line > 1 ? model.getLineContent(line - 1) : null;
    const next = line < model.getLineCount() ? model.getLineContent(line + 1) : null;
    if (!text.trim() || !isBlank(previous) || !isBlank(next)) return null;
    const nodes = parseMarkdown(text).children;
    const found = nodes.length === 1 ? findBlockVideoEmbed(nodes[0]!) : null;
    if (!found) return null;
    return {
      initialInput: found.embed.watchUrl,
      initialTitle: found.title ?? '',
      target: { view: 'raw', line },
    };
  }
  return null;
}

export function useVideoEmbedDialog(): { open: () => void; element: ReactNode } {
  const { activeView, tiptapEditor, monacoEditor, insertAtCursor } = useEditorContext();
  const [state, setState] = useState<DialogState | null>(null);

  const open = useCallback(() => {
    setState(
      videoEmbedAtCaret(activeView, tiptapEditor, monacoEditor) ?? {
        initialInput: '',
        initialTitle: '',
        target: null,
      },
    );
  }, [activeView, tiptapEditor, monacoEditor]);

  const confirm = useCallback(
    (embed: VideoEmbed, title: string) => {
      const target = state?.target ?? null;
      setState(null);
      if (target?.view === 'wysiwyg' && tiptapEditor) {
        tiptapEditor
          .chain()
          .focus()
          .insertContentAt(
            { from: target.from, to: target.to },
            videoEmbedParagraphJson(embed.watchUrl, title),
          )
          .run();
        return;
      }
      const model = monacoEditor?.getModel();
      if (target?.view === 'raw' && monacoEditor && model) {
        monacoEditor.executeEdits('video-embed', [
          {
            range: {
              startLineNumber: target.line,
              startColumn: 1,
              endLineNumber: target.line,
              endColumn: model.getLineMaxColumn(target.line),
            },
            text: videoEmbedMarkdown(embed.watchUrl, title),
          },
        ]);
        monacoEditor.focus();
        return;
      }
      insertVideoEmbedReference(
        { activeView, tiptapEditor, monacoEditor, appendMarkdown: insertAtCursor },
        embed.watchUrl,
        title,
      );
    },
    [state, activeView, tiptapEditor, monacoEditor, insertAtCursor],
  );

  const close = useCallback(() => setState(null), []);

  const element = state ? (
    <VideoEmbedDialog
      mode={state.target ? 'update' : 'insert'}
      initialInput={state.initialInput}
      initialTitle={state.initialTitle}
      onConfirm={confirm}
      onClose={close}
    />
  ) : null;

  return { open, element };
}
