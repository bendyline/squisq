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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from './useAnchoredPopover';
import { useEditorContext, type ThemeInheritance, type LayoutMode } from './EditorContext';
import { Icon } from './Icon';
import { useEscapeDismissal } from './useEscapeDismissal';
import { useProofingState } from './proofing/ProofingContext';

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
    colorScheme,
    layoutMode,
    setLayoutMode,
  } = useEditorContext();
  const proofingState = useProofingState();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const popoverStyle = useAnchoredPopover(open, triggerRef, menuRef);
  const close = useCallback(() => setOpen(false), []);

  useEscapeDismissal(open, close, triggerRef);

  useLayoutEffect(() => {
    if (!open || popoverStyle.visibility === 'hidden') return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    if (items?.length) items[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
  }, [open, popoverStyle.visibility]);

  // Click-outside to close, mirroring VersionHistoryPanel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
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
        onClick={() => {
          initialFocus.current = 'first';
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }}
      >
        <Icon icon="fa-solid fa-eye" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={popoverStyle}
            data-theme={colorScheme}
            className="squisq-view-menu-popover"
            role="menu"
            aria-label="View options"
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                close();
                triggerRef.current?.focus();
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'),
              ];
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowUp'
                      ? (current - 1 + items.length) % items.length
                      : (current + 1) % items.length;
              items[next]?.focus();
            }}
          >
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
            {proofingState && (
              <MenuToggle
                label="Check spelling & grammar"
                checked={proofingState.enabled}
                onChange={() => proofingState.setEnabled(!proofingState.enabled)}
              />
            )}
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
          </div>,
          triggerRef.current?.closest('[role="dialog"][aria-modal="true"]') ?? document.body,
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
    <button
      type="button"
      tabIndex={-1}
      className="squisq-view-menu-row"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onChange}
    >
      <span className="squisq-view-menu-checkbox" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="squisq-view-menu-label">{label}</span>
    </button>
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
  return (
    <div
      className="squisq-view-menu-row squisq-view-menu-row--radios"
      role="group"
      aria-label={label}
    >
      <span className="squisq-view-menu-label">{label}</span>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            tabIndex={-1}
            className="squisq-view-menu-radio-row"
            role="menuitemradio"
            aria-checked={checked}
            onClick={() => onChange(o.value)}
          >
            <span className="squisq-view-menu-radio" aria-hidden="true">
              {checked ? '●' : ''}
            </span>
            <span className="squisq-view-menu-radio-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
