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

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditorContext, type ThemeInheritance, type LayoutMode } from './EditorContext';
import { Icon } from './Icon';
import { useEscapeDismissal } from './useEscapeDismissal';

export function ViewMenuPanel() {
  const {
    inlinePreviewVisible,
    setInlinePreviewVisible,
    statusBarVisible,
    setStatusBarVisible,
    outlineVisible,
    setOutlineVisible,
    blockTagVisibility,
    setBlockTagVisibility,
    themeInheritance,
    setThemeInheritance,
    layoutMode,
    setLayoutMode,
  } = useEditorContext();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEscapeDismissal(open, close, triggerRef);

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

  return (
    <div className="squisq-view-menu" ref={containerRef}>
      <button
        ref={triggerRef}
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
        <Icon icon="fa-solid fa-eye" />
      </button>
      {open && (
        <div className="squisq-view-menu-popover" role="menu" aria-label="View options">
          <MenuRadioGroup
            label="View"
            value={layoutMode}
            onChange={(v) => setLayoutMode(v as LayoutMode)}
            options={[
              { value: 'document', label: 'Document' },
              { value: 'block', label: 'Block-at-a-time' },
              { value: 'timeline', label: 'Timeline' },
            ]}
          />
          <div className="squisq-view-menu-separator" role="separator" />
          <MenuToggle label="Show outline" checked={outlineVisible} onChange={toggleOutline} />
          <MenuToggle
            label="Show block previews"
            checked={inlinePreviewVisible}
            onChange={toggleInlinePreview}
          />
          <MenuRadioGroup
            label="Show block tags"
            value={blockTagVisibility}
            onChange={(v) => setBlockTagVisibility(v as typeof blockTagVisibility)}
            options={[
              { value: 'none', label: 'No inline block tags' },
              { value: 'active', label: 'Selected/hovered block' },
              { value: 'always', label: 'Always show' },
            ]}
          />
          <MenuToggle
            label="Show status bar"
            checked={statusBarVisible}
            onChange={toggleStatusBar}
          />
          <div className="squisq-view-menu-separator" role="separator" />
          <MenuRadioGroup
            label="Editor styling from theme"
            value={themeInheritance}
            onChange={(v) => setThemeInheritance(v as ThemeInheritance)}
            options={[
              { value: 'none', label: "Don't inherit" },
              { value: 'fonts', label: 'Fonts only' },
              { value: 'fonts-colors', label: 'Fonts & colors' },
            ]}
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

function MenuRadioGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const name = useId();
  return (
    <div
      className="squisq-view-menu-row squisq-view-menu-row--radios"
      role="radiogroup"
      aria-label={label}
    >
      <span className="squisq-view-menu-label">{label}</span>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            className="squisq-view-menu-radio-row"
            role="menuitemradio"
            aria-checked={checked}
          >
            <input
              type="radio"
              className="squisq-view-menu-radio"
              name={name}
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
            />
            <span className="squisq-view-menu-radio-label">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
