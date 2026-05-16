/**
 * ViewMenuPanel
 *
 * Toolbar overflow menu (`…` button) for view-related toggles. Currently
 * houses the inline preview gutter toggle; new view options can be added
 * as additional `<MenuToggle>` rows without restructuring.
 *
 * State lives in EditorContext so the toggle survives view switches and
 * the host doesn't need to manage it. The initial value comes from the
 * EditorShell `inlinePreview` prop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorContext } from './EditorContext';

export function ViewMenuPanel() {
  const {
    inlinePreviewVisible,
    setInlinePreviewVisible,
    statusBarVisible,
    setStatusBarVisible,
    outlineVisible,
    setOutlineVisible,
    blockTagsVisible,
    setBlockTagsVisible,
  } = useEditorContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside to close, mirroring VersionHistoryPanel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleInlinePreview = useCallback(() => {
    setInlinePreviewVisible(!inlinePreviewVisible);
  }, [inlinePreviewVisible, setInlinePreviewVisible]);

  const toggleStatusBar = useCallback(() => {
    setStatusBarVisible(!statusBarVisible);
  }, [statusBarVisible, setStatusBarVisible]);

  const toggleOutline = useCallback(() => {
    setOutlineVisible(!outlineVisible);
  }, [outlineVisible, setOutlineVisible]);

  const toggleBlockTags = useCallback(() => {
    setBlockTagsVisible(!blockTagsVisible);
  }, [blockTagsVisible, setBlockTagsVisible]);

  return (
    <div className="squisq-view-menu" ref={containerRef}>
      <button
        type="button"
        className={`squisq-toolbar-button squisq-view-menu-trigger${
          open ? ' squisq-toolbar-button--active' : ''
        }`}
        data-tooltip="View options"
        aria-label="View options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 8 C 3 4.5 5.5 3 8 3 S 13 4.5 14.5 8 C 13 11.5 10.5 13 8 13 S 3 11.5 1.5 8 Z" />
          <circle cx="8" cy="8" r="2.2" />
        </svg>
      </button>
      {open && (
        <div className="squisq-view-menu-popover" role="menu" aria-label="View options">
          <MenuToggle label="Show outline" checked={outlineVisible} onChange={toggleOutline} />
          <MenuToggle
            label="Show block previews"
            checked={inlinePreviewVisible}
            onChange={toggleInlinePreview}
          />
          <MenuToggle
            label="Show block tags"
            checked={blockTagsVisible}
            onChange={toggleBlockTags}
          />
          <MenuToggle
            label="Show status bar"
            checked={statusBarVisible}
            onChange={toggleStatusBar}
          />
        </div>
      )}
    </div>
  );
}

function MenuToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="squisq-view-menu-row" role="menuitemcheckbox" aria-checked={checked}>
      <input
        type="checkbox"
        className="squisq-view-menu-checkbox"
        checked={checked}
        onChange={onChange}
      />
      <span className="squisq-view-menu-label">{label}</span>
    </label>
  );
}
