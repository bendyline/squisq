/**
 * AddBin — the template designer's "things you can add" sidebar.
 *
 * Three sections, all feeding the same canvas:
 *   - Placeholders: dynamic tokens ({title}, {content}, …) substituted at
 *     render time. See {@link TOKEN_DEFS}.
 *   - Shapes: Squisq's standard shape library. See {@link SHAPE_DEFS}.
 *   - Media: drop an image to pin as a static, full-bleed background.
 *
 * Tokens and shapes can be placed two ways — drag onto the canvas, or
 * click to arm the matching tool and then click the canvas. The drag
 * carries the entry id under {@link TOKEN_DRAG_MIME} / {@link SHAPE_DRAG_MIME};
 * the TemplateDesigner's drop handler reads it (see `buildTokenLayer` /
 * `buildShapeLayer`). Media is upload-backed and handled by the designer.
 */

import { useRef } from 'react';
import { TOKEN_DEFS, TOKEN_DRAG_MIME } from './tokenDefs';
import { SHAPE_DEFS, SHAPE_DRAG_MIME } from './shapeDefs';
import { ShapeGlyph } from './ShapeGlyph';

interface AddBinProps {
  /** Currently active tool id — the matching button is highlighted. */
  activeToolId: string;
  /** Switch the Scene's active tool (a token or shape place tool). */
  onActivate: (toolId: string) => void;
  /** Whether media can be added (a MediaProvider is wired up). */
  canAddMedia: boolean;
  /** Add picked image files as static background layer(s). */
  onAddMediaFiles: (files: File[]) => void;
}

export function AddBin({ activeToolId, onActivate, canAddMedia, onAddMediaFiles }: AddBinProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="squisq-template-designer-palette" aria-label="Add to layout">
      <h3 className="squisq-template-designer-palette-title">Add</h3>

      {/* Placeholders — dynamic tokens substituted at render time. */}
      <div className="squisq-template-designer-palette-section">
        <div className="squisq-template-designer-palette-section-title">Placeholders</div>
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
                // Some browsers require text/plain for the drag to start.
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
      </div>

      {/* Shapes — the standard shape library. */}
      <div className="squisq-template-designer-palette-section">
        <div className="squisq-template-designer-palette-section-title">Shapes</div>
        <div className="squisq-template-designer-palette-shapes">
          {SHAPE_DEFS.map((s) => (
            <button
              key={s.id}
              type="button"
              draggable
              className={`squisq-template-designer-shape-item${
                activeToolId === s.id ? ' squisq-template-designer-shape-item--active' : ''
              }`}
              onDragStart={(e) => {
                e.dataTransfer.setData(SHAPE_DRAG_MIME, s.id);
                e.dataTransfer.setData('text/plain', s.label);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onActivate(s.id)}
              title={s.label}
              aria-label={s.label}
            >
              <ShapeGlyph kind={s.kind} rounded={s.rounded} />
            </button>
          ))}
        </div>
      </div>

      {/* Media — drop an image to pin a static background. */}
      <div className="squisq-template-designer-palette-section">
        <div className="squisq-template-designer-palette-section-title">Media</div>
        <p className="squisq-template-designer-palette-hint">
          {canAddMedia
            ? 'Drop an image on the canvas to add a full-bleed background.'
            : 'Connect media storage to add image backgrounds.'}
        </p>
        <button
          type="button"
          className="squisq-template-designer-palette-media-add"
          disabled={!canAddMedia}
          onClick={() => fileInputRef.current?.click()}
        >
          Add image…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onAddMediaFiles(files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </div>
    </aside>
  );
}
