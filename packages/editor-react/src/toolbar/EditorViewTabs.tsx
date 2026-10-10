/** View selection and the Slideshow/Video menu stay together across hosts. */
import { useReducer } from 'react';
import { useEditorContext, type EditorView } from '../EditorContext';
import { PreviewModeMenu } from '../PreviewModeMenu';
import { displayModeLabel, usePreviewSettingsOptional } from '../PreviewControls';
import { platformShortcut } from '../platformShortcuts';
import type { EditorHostMode } from '../editorHostMode';
const VIEWS: { id: EditorView; label: string; shortLabel?: string; shortcutKey: string }[] = [
  { id: 'wysiwyg', label: 'Write', shortcutKey: '1' },
  { id: 'raw', label: 'Source', shortcutKey: '2' },
  { id: 'preview', label: 'Use', shortcutKey: '3' },
];

export function EditorViewTabs({
  showPlayTab,
  hostMode,
}: {
  showPlayTab: boolean;
  hostMode: EditorHostMode;
}) {
  const { editorMode, activeView, setActiveView } = useEditorContext();
  const previewSettings = usePreviewSettingsOptional();
  const [useModeMenuRequest, requestUseModeMenu] = useReducer((count: number) => count + 1, 0);
  // In code mode only the raw view is meaningful; the WYSIWYG and Preview
  // surfaces aren't mounted, so hide their tabs.
  const visibleViews = VIEWS.filter((v) => {
    if (hostMode === 'chat') return v.id === 'wysiwyg';
    if (editorMode === 'code') return v.id === 'raw';
    if (v.id === 'preview' && !showPlayTab) return false;
    return true;
  });
  const showViewTabs = visibleViews.length > 1;
  return (
    <>
      {/* View tabs — hidden when only one view is available (e.g. code mode). */}
      {showViewTabs && (
        <div className="squisq-toolbar-view-tabs" role="tablist" aria-label="Editor view">
          {visibleViews.map((view) => {
            const viewLabel =
              view.id === 'preview' && previewSettings
                ? displayModeLabel(previewSettings.activeDisplayMode)
                : view.label;
            const tab = (
              <button
                role="tab"
                data-view={view.id}
                aria-selected={activeView === view.id}
                className={`squisq-toolbar-view-tab${activeView === view.id ? ' squisq-toolbar-view-tab--active' : ''}`}
                onClick={() => {
                  if (view.id === 'preview' && activeView === 'preview' && previewSettings) {
                    requestUseModeMenu();
                    return;
                  }
                  setActiveView(view.id);
                }}
                data-tooltip={`${viewLabel} (${platformShortcut(`Shift+${view.shortcutKey}`)})`}
              >
                <span
                  className="squisq-toolbar-view-tab-label squisq-toolbar-view-tab-label--long"
                  data-label={viewLabel}
                >
                  {viewLabel}
                </span>
                {view.shortLabel && view.shortLabel !== view.label && (
                  <span
                    className="squisq-toolbar-view-tab-label squisq-toolbar-view-tab-label--short"
                    data-label={view.shortLabel}
                  >
                    {view.shortLabel}
                  </span>
                )}
              </button>
            );

            if (view.id !== 'preview' || !previewSettings) {
              return (
                <div key={view.id} className="squisq-toolbar-view-tab-wrap" role="presentation">
                  {tab}
                </div>
              );
            }

            return (
              <div
                key={view.id}
                className={`squisq-toolbar-view-tab-wrap squisq-toolbar-use-tab${activeView === 'preview' ? ' squisq-toolbar-use-tab--active' : ''}`}
                role="presentation"
              >
                {tab}
                <PreviewModeMenu openRequest={useModeMenuRequest} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
