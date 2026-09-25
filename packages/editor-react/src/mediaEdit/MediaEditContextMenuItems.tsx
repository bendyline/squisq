/**
 * Registers "Edit audio…" in the editor's right-click menu when the click
 * lands on a media clip: a media node view or `{[audio …]}` annotation in the
 * Write view, or a media line in the Source view.
 */

import { useMemo } from 'react';
import { useEditorContext, type MediaEditTarget } from '../EditorContext';
import {
  useEditorContextMenuItems,
  type EditorContextMenuContext,
  type EditorContextMenuItem,
} from '../EditorContextMenu';
import { findEditableMedia, mediaTargetFromElement } from './mediaEditTargets';

export function MediaEditContextMenuItems(): null {
  const { doc, monacoEditor, mediaEditRenders, openMediaEdit } = useEditorContext();

  const items = useMemo<EditorContextMenuItem[]>(() => {
    if (!mediaEditRenders) return [];
    const resolve = (context: EditorContextMenuContext): MediaEditTarget | null => {
      if (!doc) return null;
      let target: MediaEditTarget | null = null;
      if (context.view === 'raw') {
        const line = monacoEditor?.getTargetAtClientPoint(context.clientX, context.clientY)
          ?.position?.lineNumber;
        if (line != null) {
          const item = findEditableMedia(doc, { src: '', kind: 'audio', sourceLine: line });
          target =
            item?.sourceLine === line ? { src: item.src, kind: item.kind, sourceLine: line } : null;
        }
      } else if (context.view === 'wysiwyg') {
        target = mediaTargetFromElement(context.target);
      }
      if (!target) return null;
      // Only offer the action for media the document actually schedules.
      return findEditableMedia(doc, target) ? target : null;
    };
    return [
      {
        id: 'media-edit-audio',
        label: 'Edit clip…',
        group: 'media',
        when: (context) => context.editable && resolve(context) != null,
        onSelect: (context) => {
          const target = resolve(context);
          if (target) openMediaEdit(target);
        },
      },
    ];
  }, [doc, monacoEditor, mediaEditRenders, openMediaEdit]);

  useEditorContextMenuItems(items);
  return null;
}
