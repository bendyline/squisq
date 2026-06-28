/**
 * ShapePalette — a categorized, searchable gallery of drawing shapes.
 *
 * Mirrors `EmojiPicker`'s structure (search + category sections + grid of
 * thumbnails). Picking a shape calls `onPick(kind)`; the host then sets the
 * draw tool's pending kind and activates it. Thumbnails render via the same
 * `shapePath` geometry the canvas uses, so the gallery previews exactly what
 * gets drawn.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { shapePath } from '@bendyline/squisq/doc';

interface ShapePaletteProps {
  onPick: (kind: string) => void;
  onClose: () => void;
  /**
   * CSS selector for an ancestor that should NOT count as an "outside"
   * click — typically the toolbar button that owns opening/closing the
   * palette. Defaults to the scene block toolbar.
   */
  ignoreOutsideSelector?: string;
}

interface ShapeItem {
  kind: string;
  label: string;
}

const CATALOG: { category: string; items: ShapeItem[] }[] = [
  {
    category: 'Lines',
    items: [
      { kind: 'line', label: 'Line' },
      { kind: 'arrow', label: 'Line Arrow' },
      { kind: 'text', label: 'Text' },
    ],
  },
  {
    category: 'Basic Shapes',
    items: [
      { kind: 'rectangle', label: 'Rectangle' },
      { kind: 'circle', label: 'Ellipse' },
      { kind: 'triangle', label: 'Triangle' },
      { kind: 'right-triangle', label: 'Right Triangle' },
      { kind: 'diamond', label: 'Diamond' },
      { kind: 'pentagon', label: 'Pentagon' },
      { kind: 'hexagon', label: 'Hexagon' },
      { kind: 'octagon', label: 'Octagon' },
      { kind: 'parallelogram', label: 'Parallelogram' },
      { kind: 'trapezoid', label: 'Trapezoid' },
      { kind: 'plus', label: 'Cross' },
      { kind: 'chevron', label: 'Chevron' },
      { kind: 'cylinder', label: 'Cylinder' },
      { kind: 'callout', label: 'Speech Bubble' },
      { kind: 'cloud', label: 'Cloud' },
      { kind: 'heart', label: 'Heart' },
      { kind: 'lightning', label: 'Lightning' },
    ],
  },
  {
    category: 'Stars',
    items: [
      { kind: 'star', label: '5-Point Star' },
      { kind: 'star4', label: '4-Point Star' },
      { kind: 'star6', label: '6-Point Star' },
    ],
  },
  {
    category: 'Block Arrows',
    items: [
      { kind: 'arrow-right', label: 'Arrow Right' },
      { kind: 'arrow-left', label: 'Arrow Left' },
      { kind: 'arrow-up', label: 'Arrow Up' },
      { kind: 'arrow-down', label: 'Arrow Down' },
      { kind: 'double-arrow', label: 'Double Arrow' },
    ],
  },
];

export function ShapePalette({
  onPick,
  onClose,
  ignoreOutsideSelector = '.squisq-scene-block-toolbar',
}: ShapePaletteProps) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      // Don't treat a click on the toolbar (where the Shape trigger lives)
      // as "outside" — that button owns opening/closing the palette.
      const target = e.target as Element | null;
      if (ignoreOutsideSelector && target?.closest?.(ignoreOutsideSelector)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, ignoreOutsideSelector]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.map((s) => ({
      category: s.category,
      items: s.items.filter((i) => i.label.toLowerCase().includes(q) || i.kind.includes(q)),
    })).filter((s) => s.items.length > 0);
  }, [query]);

  return (
    <div className="squisq-shape-palette" ref={ref} role="dialog" aria-label="Shapes">
      <input
        className="squisq-shape-palette-search"
        type="text"
        placeholder="Search shapes…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="squisq-shape-palette-scroll">
        {sections.map((section) => (
          <div key={section.category} className="squisq-shape-palette-section">
            <div className="squisq-shape-palette-heading">{section.category}</div>
            <div className="squisq-shape-palette-grid">
              {section.items.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  className="squisq-shape-palette-item"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => onPick(item.kind)}
                >
                  <ShapeThumb kind={item.kind} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A 40×30 SVG thumbnail of a shape, inside a 48×38 button viewport. */
function ShapeThumb({ kind }: { kind: string }) {
  const d = shapePath(kind, 4, 4, 40, 30);
  return (
    <svg viewBox="0 0 48 38" width={36} height={28} aria-hidden="true">
      {d ? (
        <path d={d} className="squisq-shape-thumb" />
      ) : kind === 'circle' ? (
        <ellipse cx={24} cy={19} rx={20} ry={15} className="squisq-shape-thumb" />
      ) : kind === 'line' ? (
        <line x1={4} y1={34} x2={44} y2={4} className="squisq-shape-thumb-line" />
      ) : kind === 'arrow' ? (
        <line
          x1={4}
          y1={34}
          x2={44}
          y2={4}
          className="squisq-shape-thumb-line"
          markerEnd="url(#squisq-edge-arrow-end)"
        />
      ) : kind === 'text' ? (
        <text x={24} y={26} textAnchor="middle" className="squisq-shape-thumb-text">
          T
        </text>
      ) : (
        <rect x={4} y={6} width={40} height={26} rx={3} className="squisq-shape-thumb" />
      )}
    </svg>
  );
}
