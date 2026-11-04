import { useEditorContext } from './EditorContext';
import { usePreviewSettings, DISPLAY_MODE_OPTIONS } from './PreviewControls';
import { ViewModeMenu } from './toolbar/ViewModeMenu';

/**
 * Dropdown trigger rendered directly beside the Use tab. Selecting a mode
 * also enters the Use view, so the menu works from Write and Source as well
 * as from an already-active preview.
 */
export interface PreviewModeMenuProps {
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
}

export function PreviewModeMenu({ openRequest = 0 }: PreviewModeMenuProps) {
  const s = usePreviewSettings();
  const { allowNarrate, setActiveView } = useEditorContext();
  const options = DISPLAY_MODE_OPTIONS.filter((opt) => opt.key !== 'narrate' || allowNarrate);
  return (
    <ViewModeMenu
      label="Use mode"
      options={options}
      selected={s.activeDisplayMode}
      onSelect={(mode) => {
        s.setSelectedDisplayMode(mode);
        setActiveView('preview');
      }}
      openRequest={openRequest}
    />
  );
}
