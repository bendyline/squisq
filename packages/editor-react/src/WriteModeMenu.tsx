import type { RefObject } from 'react';
import { useEditorContext } from './EditorContext';
import { ViewModeMenu } from './toolbar/ViewModeMenu';
import { WRITE_MENU_OPTIONS } from './writeModes';

/**
 * Dropdown trigger rendered directly beside the editing tab. It lists the
 * Write layouts with Source right under Write. Choosing a layout enters the
 * Write view in it, so the menu works from Source and Use too; choosing Source
 * enters Source, which always shows the whole file and leaves the layout as it
 * was for the return to Write.
 */
export interface WriteModeMenuProps {
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
  /** The editing tab, which the menu lines up under. */
  alignWith?: RefObject<HTMLElement | null>;
}

export function WriteModeMenu({ openRequest = 0, alignWith }: WriteModeMenuProps) {
  const { layoutMode, setLayoutMode, editingView, setActiveView } = useEditorContext();
  return (
    <ViewModeMenu
      label="Write mode"
      options={WRITE_MENU_OPTIONS}
      selected={editingView === 'raw' ? 'source' : layoutMode}
      onSelect={(mode) => {
        if (mode === 'source') {
          setActiveView('raw');
          return;
        }
        setLayoutMode(mode);
        setActiveView('wysiwyg');
      }}
      openRequest={openRequest}
      alignWith={alignWith}
    />
  );
}
