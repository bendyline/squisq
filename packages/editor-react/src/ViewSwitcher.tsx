/**
 * ViewSwitcher
 *
 * Tab bar for switching between Raw, WYSIWYG, and Preview editor views.
 */

import { useEditorContext, type EditorView } from './EditorContext';

const VIEWS: { id: EditorView; label: string; shortLabel?: string; shortcut: string }[] = [
  { id: 'raw', label: 'Markdown', shortLabel: 'MD', shortcut: '⌘1' },
  { id: 'wysiwyg', label: 'Editor', shortcut: '⌘2' },
  { id: 'preview', label: 'Preview', shortcut: '⌘3' },
];

export interface ViewSwitcherProps {
  /** Additional class name */
  className?: string;
}

/**
 * Tab-style view switcher for the three editor modes.
 */
export function ViewSwitcher({ className }: ViewSwitcherProps) {
  const { activeView, setActiveView, editorMode } = useEditorContext();
  // In code mode, only the raw view is meaningful. With just one entry in
  // the tab list there's nothing to switch between, so suppress the whole
  // switcher rather than render a single lonely tab.
  const visibleViews = editorMode === 'code' ? VIEWS.filter((v) => v.id === 'raw') : VIEWS;
  if (visibleViews.length <= 1) return null;

  return (
    <div
      className={`squisq-view-switcher ${className || ''}`}
      role="tablist"
      aria-label="Editor view"
    >
      {visibleViews.map((view) => (
        <button
          key={view.id}
          role="tab"
          aria-selected={activeView === view.id}
          className={`squisq-view-tab ${activeView === view.id ? 'squisq-view-tab--active' : ''}`}
          onClick={() => setActiveView(view.id)}
          title={`${view.label} (${view.shortcut})`}
        >
          <span className="squisq-view-tab-label squisq-view-tab-label--long">{view.label}</span>
          {view.shortLabel && view.shortLabel !== view.label && (
            <span className="squisq-view-tab-label squisq-view-tab-label--short">
              {view.shortLabel}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
