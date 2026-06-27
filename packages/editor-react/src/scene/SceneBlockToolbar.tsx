/**
 * SceneBlockToolbar — the shared chrome that sits *above* a diagram /
 * drawing / layout canvas (right-aligned, outside the canvas box) and
 * hosts the tools for CRUDing the block's shapes.
 *
 * It renders two groups:
 *   - **Tools** — mode buttons that drive the Scene's `activeToolId`
 *     (Select / Shape / Pen / Text / Connect …). Hidden when a block has
 *     only one tool (e.g. layout's Select-only set), since a lone mode
 *     button is noise.
 *   - **Actions** — one-shot buttons (Create a shape, Delete the
 *     selection, …). These are domain commands, not modes.
 *
 * Each host (DiagramWidget / SceneBlockWidget) owns the active-tool and
 * selection state and supplies the tools + actions appropriate to its
 * block type, so the bar looks and behaves consistently everywhere while
 * the vocabulary differs per block.
 */

import type { ReactNode } from 'react';
import type { SceneTool } from './tools/SceneTool';
import { Icon } from '../Icon';

export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Text alignment controls shown when a textbox is the current selection. */
export interface SceneAlignment {
  textAlign: HAlign;
  verticalAlign: VAlign;
  onTextAlign: (v: HAlign) => void;
  onVerticalAlign: (v: VAlign) => void;
}

export interface SceneBlockAction {
  id: string;
  label: string;
  /** Optional glyph/icon; falls back to the label text. */
  icon?: ReactNode;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Render with the destructive (red) treatment — used for Delete. */
  danger?: boolean;
}

export interface SceneBlockToolbarProps {
  /** Mode tools that drive the Scene's active tool. */
  tools?: readonly SceneTool[];
  activeToolId?: string;
  onSelectTool?: (id: string) => void;
  /** One-shot command buttons (create / delete / …). */
  actions?: readonly SceneBlockAction[];
  /** Text-alignment controls — shown when a textbox is the selection. */
  alignment?: SceneAlignment;
  /**
   * A popover anchored *below* a specific tool button (e.g. the shape
   * palette under the Shape tool). Rendered as a dropdown so it pops down
   * from the button in the toolbar.
   */
  toolPopover?: { toolId: string; content: ReactNode };
  /** Extra controls rendered at the start of the bar (e.g. a shape palette). */
  leading?: ReactNode;
}

const H_ALIGNS: { value: HAlign; icon: string; label: string }[] = [
  { value: 'left', icon: 'fa-solid fa-align-left', label: 'Align left' },
  { value: 'center', icon: 'fa-solid fa-align-center', label: 'Align center' },
  { value: 'right', icon: 'fa-solid fa-align-right', label: 'Align right' },
];

/** Vertical-align glyph: a box with a bar pinned to top / middle / bottom. */
function VAlignIcon({ pos }: { pos: VAlign }) {
  const y = pos === 'top' ? 3.5 : pos === 'middle' ? 7.5 : 11.5;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <line
        x1="5"
        y1={y}
        x2="11"
        y2={y}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const V_ALIGNS: { value: VAlign; label: string }[] = [
  { value: 'top', label: 'Align top' },
  { value: 'middle', label: 'Align middle' },
  { value: 'bottom', label: 'Align bottom' },
];

export function SceneBlockToolbar({
  tools = [],
  activeToolId,
  onSelectTool,
  actions = [],
  alignment,
  toolPopover,
  leading,
}: SceneBlockToolbarProps) {
  // A single mode (e.g. layout's Select) isn't worth a button — there's
  // nothing to switch to. Still render the bar for its actions/leading.
  const showTools = tools.length > 1;
  if (!showTools && actions.length === 0 && !leading && !alignment) return null;

  return (
    <div className="squisq-scene-block-toolbar" role="toolbar" aria-label="Canvas tools">
      {leading}
      {alignment && (
        <div className="squisq-scene-block-tools" aria-label="Text alignment">
          {H_ALIGNS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={`squisq-scene-tool${alignment.textAlign === a.value ? ' squisq-scene-tool--active' : ''}`}
              onClick={() => alignment.onTextAlign(a.value)}
              title={a.label}
              aria-label={a.label}
              aria-pressed={alignment.textAlign === a.value}
            >
              <Icon icon={a.icon} />
            </button>
          ))}
          {V_ALIGNS.map((a) => (
            <button
              key={a.value}
              type="button"
              className={`squisq-scene-tool${alignment.verticalAlign === a.value ? ' squisq-scene-tool--active' : ''}`}
              onClick={() => alignment.onVerticalAlign(a.value)}
              title={a.label}
              aria-label={a.label}
              aria-pressed={alignment.verticalAlign === a.value}
            >
              <VAlignIcon pos={a.value} />
            </button>
          ))}
        </div>
      )}
      {showTools && (
        <div className="squisq-scene-block-tools">
          {tools.map((t) => {
            const button = (
              <button
                key={t.id}
                type="button"
                className={`squisq-scene-tool${activeToolId === t.id ? ' squisq-scene-tool--active' : ''}`}
                onClick={() => onSelectTool?.(t.id)}
                title={t.shortcut ? `${t.label} (${t.shortcut.toUpperCase()})` : t.label}
                aria-pressed={activeToolId === t.id}
              >
                {t.icon ?? <span className="squisq-scene-tool-label">{t.label}</span>}
              </button>
            );
            // Anchor a dropdown (e.g. the shape palette) below this button.
            if (toolPopover && toolPopover.toolId === t.id) {
              return (
                <span key={t.id} className="squisq-scene-tool-popover-anchor">
                  {button}
                  {toolPopover.content}
                </span>
              );
            }
            return button;
          })}
        </div>
      )}
      {actions.length > 0 && (
        <div className="squisq-scene-block-actions">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`squisq-scene-action${a.danger ? ' squisq-scene-action--danger' : ''}`}
              onClick={a.onClick}
              disabled={a.disabled}
              title={a.title ?? a.label}
              aria-label={a.title ?? a.label}
            >
              {a.icon && <span className="squisq-scene-action-icon">{a.icon}</span>}
              <span className="squisq-scene-action-label">{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SceneBlockToolbar;
