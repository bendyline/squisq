import type { EditorMode } from '../EditorContext';
import type { EditorHostMode } from '../editorHostMode';

/** What the toolbar offers for switching views, given the host's settings. */
export interface ViewChoices {
  /**
   * The toolbar shows the view button — the active view's name, opening the
   * View menu — because there is a view to switch to.
   */
  button: boolean;
  /** The View menu lists the Edit views (and Ctrl/Cmd+Shift+1/2 reach them). */
  editViews: boolean;
  /** The View menu lists the Use views (and Ctrl/Cmd+Shift+3 reaches Use). */
  useViews: boolean;
}

export function viewChoices({
  editorMode,
  hostMode,
  showPlayTab,
  showViewTabs,
}: {
  editorMode: EditorMode;
  hostMode: EditorHostMode;
  showPlayTab: boolean;
  showViewTabs: boolean;
}): ViewChoices {
  // A chat composer only writes; code mode edits only source.
  const offered = showViewTabs && hostMode !== 'chat';
  // Only markdown documents have Source, block, timeline and summary views.
  const editViews = offered && editorMode === 'markdown';
  const useViews = offered && editorMode !== 'code' && showPlayTab;
  return { button: editViews || useViews, editViews, useViews };
}
