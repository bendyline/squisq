/** Live read-direction adapter from a registered timeline fence to React. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { AsciiTimeline } from '@bendyline/squisq/doc';
import { findTimelineBlockPos, parseTimelineForNode } from './TimelineViewExtension';

export interface TimelineViewData {
  timeline: AsciiTimeline;
  text: string;
  warnings: string[];
}

export function useTimelineData(editor: Editor, blockId: string): TimelineViewData | null {
  const [version, setVersion] = useState(0);
  const dataCache = useRef<{
    text: string;
    language: string | null;
    data: TimelineViewData;
  } | null>(null);
  useEffect(() => {
    const onEditorChange = () => setVersion((value) => value + 1);
    editor.on('transaction', onEditorChange);
    // setEditable() updates editor options and emits `update`, but does not
    // necessarily dispatch a ProseMirror transaction. Keep mounted widgets in
    // sync when a host toggles read-only mode at runtime.
    editor.on('update', onEditorChange);
    return () => {
      editor.off('transaction', onEditorChange);
      editor.off('update', onEditorChange);
    };
  }, [editor]);

  return useMemo(() => {
    const pos = findTimelineBlockPos(editor, blockId);
    if (pos === null) return null;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'codeBlock') return null;
    const text = node.textContent;
    const rawLanguage = (node.attrs as { language?: unknown }).language;
    const language = typeof rawLanguage === 'string' ? rawLanguage : null;
    const cached = dataCache.current;
    // ProseMirror can rebuild ancestor nodes for an unrelated edit. Source
    // text + language fully determine the timeline parse, so retain the data
    // and model identities across those transactions (and editable updates).
    if (cached?.text === text && cached.language === language) return cached.data;
    const timeline = parseTimelineForNode(node);
    if (!timeline) return null;
    const data = { timeline, text, warnings: timeline.warnings };
    dataCache.current = { text, language, data };
    return data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, blockId, version]);
}
