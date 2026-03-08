/**
 * ViewSwitcher
 *
 * Tab bar for switching between Raw, WYSIWYG, and Preview editor views.
 */

import { useEditorContext, type EditorView } from './EditorContext';

const VIEWS: { id: EditorView; label: string; shortcut: string }[] = [
  { id: 'raw', label: 'Raw', shortcut: '⌘1' },
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
  const { activeView, setActiveView } = useEditorContext();

  return (
    <div
      className={`prodcore-view-switcher ${className || ''}`}
      role="tablist"
      aria-label="Editor view"
    >
      {VIEWS.map((view) => (
        <button
          key={view.id}
          role="tab"
          aria-selected={activeView === view.id}
          className={`prodcore-view-tab ${activeView === view.id ? 'prodcore-view-tab--active' : ''}`}
          onClick={() => setActiveView(view.id)}
          title={`${view.label} (${view.shortcut})`}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
