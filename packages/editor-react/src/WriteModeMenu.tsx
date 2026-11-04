import type { RefObject } from 'react';
import { useEditorContext } from './EditorContext';
import { ViewModeMenu } from './toolbar/ViewModeMenu';
import { WRITE_MODE_OPTIONS } from './writeModes';

/**
 * Dropdown trigger rendered directly beside the Write tab. Selecting a layout
 * also enters the Write view, so the menu works from Source and Use too. The
 * layout still applies to Source, which scopes to the same block.
 */
export interface WriteModeMenuProps {
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
  /** The Write tab, which the menu lines up under. */
  alignWith?: RefObject<HTMLElement | null>;
}

export function WriteModeMenu({ openRequest = 0, alignWith }: WriteModeMenuProps) {
  const { layoutMode, setLayoutMode, setActiveView } = useEditorContext();
  return (
    <ViewModeMenu
      label="Write mode"
      options={WRITE_MODE_OPTIONS}
      selected={layoutMode}
      onSelect={(mode) => {
        setLayoutMode(mode);
        setActiveView('wysiwyg');
      }}
      openRequest={openRequest}
      alignWith={alignWith}
    />
  );
}
