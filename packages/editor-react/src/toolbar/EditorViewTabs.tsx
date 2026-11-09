/** View selection and the Write/Use mode menus stay together across hosts. */
import { useEffect, useReducer, useRef, useState } from 'react';
import { useEditorContext, type EditorView } from '../EditorContext';
import { PreviewModeMenu } from '../PreviewModeMenu';
import { WriteModeMenu } from '../WriteModeMenu';
import { writeModeLabel } from '../writeModes';
import { displayModeLabel, usePreviewSettingsOptional } from '../PreviewControls';
import { platformShortcut } from '../platformShortcuts';
import type { EditorHostMode } from '../editorHostMode';
import { navigateViewTabs } from '../viewTabKeyboard';
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
  const { editorMode, activeView, setActiveView, layoutMode } = useEditorContext();
  const [focusedView, setFocusedView] = useState(activeView);
  useEffect(() => setFocusedView(activeView), [activeView]);
  const previewSettings = usePreviewSettingsOptional();
  const [useModeMenuRequest, requestUseModeMenu] = useReducer((count: number) => count + 1, 0);
  const [writeModeMenuRequest, requestWriteModeMenu] = useReducer((count: number) => count + 1, 0);
  const writeTabRef = useRef<HTMLDivElement>(null);
  // In code mode only the raw view is meaningful; the WYSIWYG and Preview
  // surfaces aren't mounted, so hide their tabs.
  const visibleViews = VIEWS.filter((v) => {
    if (hostMode === 'chat') return v.id === 'wysiwyg';
    if (editorMode === 'code') return v.id === 'raw';
    if (v.id === 'preview' && !showPlayTab) return false;
    return true;
  });
  const showViewTabs = visibleViews.length > 1;
  // Only markdown documents have block and timeline layouts to choose from.
  const hasWriteModes = editorMode === 'markdown';
  const modeMenuOf = (id: EditorView): 'write' | 'use' | null => {
    if (id === 'wysiwyg' && hasWriteModes) return 'write';
    if (id === 'preview' && previewSettings) return 'use';
    return null;
  };
  const isVisible = (id: EditorView) => visibleViews.some((view) => view.id === id);
  return (
    <>
      {/* View tabs — hidden when only one view is available (e.g. code mode). */}
      {showViewTabs && (
        <div className="squisq-toolbar-view-tabs">
          <div className="squisq-toolbar-view-tab-list" role="tablist" aria-label="Editor view">
            {visibleViews.map((view) => {
              const modeMenu = modeMenuOf(view.id);
              const viewLabel =
                modeMenu === 'use' && previewSettings
                  ? displayModeLabel(previewSettings.activeDisplayMode)
                  : modeMenu === 'write'
                    ? writeModeLabel(layoutMode)
                    : view.label;
              const tab = (
                <button
                  type="button"
                  role="tab"
                  tabIndex={focusedView === view.id ? 0 : -1}
                  onFocus={() => setFocusedView(view.id)}
                  data-view={view.id}
                  aria-selected={activeView === view.id}
                  onKeyDown={(event) => {
                    navigateViewTabs(event);
                  }}
                  className={`squisq-toolbar-view-tab${activeView === view.id ? ' squisq-toolbar-view-tab--active' : ''}`}
                  onClick={() => {
                    // Clicking the tab you're already on opens its mode menu.
                    if (activeView === view.id && modeMenu) {
                      if (modeMenu === 'write') requestWriteModeMenu();
                      else requestUseModeMenu();
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

              const wrapClass = `squisq-toolbar-view-tab-wrap squisq-toolbar-view-tab-wrap--${view.id}`;
              if (!modeMenu) {
                return (
                  <div key={view.id} className={wrapClass} role="presentation">
                    {tab}
                  </div>
                );
              }

              return (
                <div
                  key={view.id}
                  ref={modeMenu === 'write' ? writeTabRef : undefined}
                  className={`${wrapClass} squisq-toolbar-mode-tab squisq-toolbar-${modeMenu}-tab${activeView === view.id ? ' squisq-toolbar-mode-tab--active' : ''}`}
                  role="presentation"
                >
                  {tab}
                </div>
              );
            })}
          </div>
          {/* The ▾ buttons sit outside the tablist, which may own only tabs; the
              stylesheet places each one beside its tab. */}
          {hasWriteModes && isVisible('wysiwyg') && (
            <div
              className={`squisq-toolbar-mode-menu squisq-toolbar-write-menu${activeView === 'wysiwyg' ? ' squisq-toolbar-mode-tab--active' : ''}`}
            >
              <WriteModeMenu openRequest={writeModeMenuRequest} alignWith={writeTabRef} />
            </div>
          )}
          {previewSettings && isVisible('preview') && (
            <div
              className={`squisq-toolbar-mode-menu squisq-toolbar-use-menu${activeView === 'preview' ? ' squisq-toolbar-mode-tab--active' : ''}`}
            >
              <PreviewModeMenu openRequest={useModeMenuRequest} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
