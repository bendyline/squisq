import { useRef } from 'react';
import { useEditorContext } from './EditorContext';
import { useEditorContextMenuItems, type EditorContextMenuContext } from './EditorContextMenu';
import { sourceWikiLink, wikiLinkAtElement, type WikiLinkEdit } from './wikiLinkEditing';

/** Mounted only under the shell's shared context-menu owner. */
export function WikiLinkMenuItems({ onEdit }: { onEdit: () => void }) {
  const { tiptapEditor, monacoEditor } = useEditorContext();
  const targets = useRef(new WeakMap<EditorContextMenuContext, WikiLinkEdit | null>());
  const find = (context: EditorContextMenuContext) => {
    if (!context.editable) return null;
    if (context.view === 'wysiwyg' && tiptapEditor)
      return wikiLinkAtElement(tiptapEditor, context.target);
    const model = monacoEditor?.getModel();
    const position = monacoEditor?.getDomNode()?.contains(context.target)
      ? monacoEditor.getTargetAtClientPoint(context.clientX, context.clientY)?.position
      : null;
    return context.view === 'raw' && model && position
      ? sourceWikiLink(model.getValue(), model.getOffsetAt(position))
      : null;
  };
  useEditorContextMenuItems([
    {
      id: 'squisq.wiki.edit',
      label: 'Edit wiki link',
      group: 'link',
      when: (context) => {
        const link = find(context);
        // Capture before the menu overlays Monaco's hit-test coordinates.
        targets.current.set(context, link);
        return link !== null;
      },
      onSelect: (context) => {
        const link = targets.current.get(context);
        if (!link) return;
        if (context.view === 'wysiwyg') tiptapEditor?.commands.setNodeSelection(link.from);
        else {
          const model = monacoEditor?.getModel();
          // Place the caret inside this link even when a wider selection was kept.
          if (!model) return;
          const current = sourceWikiLink(model.getValue(), link.from + 2);
          if (current?.target !== link.target || current.label !== link.label) return;
          monacoEditor?.setPosition(model.getPositionAt(link.from + 2));
        }
        onEdit();
      },
    },
  ]);
  return null;
}
