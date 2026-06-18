/**
 * Token palette — sidebar of placeholder tokens shown inside the
 * TemplateDesigner. Each entry can be placed two ways:
 *
 *   - drag it onto the canvas and drop where it should go, or
 *   - click it to arm the matching TokenTool, then click the canvas.
 *
 * Both paths end up adding the same placeholder layer (see
 * `buildTokenLayer`); the drag carries the token id on `dataTransfer`
 * under {@link TOKEN_DRAG_MIME}.
 */

import { TOKEN_DEFS, TOKEN_DRAG_MIME } from './tokenDefs';

interface TokenPaletteProps {
  /**
   * Currently active tool id. The palette highlights the matching
   * button so the user sees which tool is armed.
   */
  activeToolId: string;
  /** Switch the Scene's active tool. */
  onActivate: (toolId: string) => void;
}

export function TokenPalette({ activeToolId, onActivate }: TokenPaletteProps) {
  return (
    <aside className="squisq-template-designer-palette" aria-label="Placeholder tokens">
      <h3 className="squisq-template-designer-palette-title">Placeholders</h3>
      <p className="squisq-template-designer-palette-hint">
        Drag a placeholder onto the canvas — or click it, then click the canvas.
      </p>
      <div className="squisq-template-designer-palette-list">
        {TOKEN_DEFS.map((t) => (
          <button
            key={t.id}
            type="button"
            draggable
            className={`squisq-template-designer-palette-item${
              activeToolId === t.id ? ' squisq-template-designer-palette-item--active' : ''
            }`}
            onDragStart={(e) => {
              e.dataTransfer.setData(TOKEN_DRAG_MIME, t.id);
              // Some browsers require text/plain to be set for the drag to
              // start reliably; mirror the id there too.
              e.dataTransfer.setData('text/plain', t.token);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onActivate(t.id)}
            title={t.desc}
          >
            <span className="squisq-template-designer-palette-item-preview">{t.token}</span>
            <span className="squisq-template-designer-palette-item-label">{t.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
