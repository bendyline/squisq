import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MERMAID_FLOWCHART_SHAPES, type MermaidFlowchartShapeId } from './mermaidShapes';

export interface MermaidShapePaletteProps {
  selected?: MermaidFlowchartShapeId;
  onPick: (shape: MermaidFlowchartShapeId) => void;
  onClose: () => void;
}

const CATEGORIES = ['Basic', 'Process', 'Data', 'Documents', 'Symbols'] as const;
const PALETTE_WIDTH = 360;
const PALETTE_MAX_HEIGHT = 520;
const PALETTE_GAP = 6;
const VIEWPORT_GUTTER = 8;

interface PalettePosition extends CSSProperties {
  position: 'fixed';
  top: number;
  left: number;
  right: 'auto';
  width: number;
  maxHeight: number;
}

export function MermaidShapePalette({ selected, onPick, onClose }: MermaidShapePaletteProps) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PalettePosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.squisq-scene-block-toolbar')) return;
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const sections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return CATEGORIES.map((category) => ({
      category,
      shapes: MERMAID_FLOWCHART_SHAPES.filter(
        (shape) =>
          shape.category === category &&
          (!normalized ||
            shape.label.toLowerCase().includes(normalized) ||
            shape.id.includes(normalized) ||
            ('aliases' in shape &&
              (shape.aliases as readonly string[]).some((alias) => alias.includes(normalized)))),
      ),
    })).filter((section) => section.shapes.length > 0);
  }, [query]);

  useLayoutEffect(() => {
    const palette = ref.current;
    const anchor = palette?.parentElement;
    if (!palette || !anchor) return;

    const editorShell = palette.closest('.squisq-editor-shell') as HTMLElement | null;
    const statusBar = editorShell?.querySelector('.squisq-status-bar') as HTMLElement | null;

    const measure = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const shellRect = editorShell?.getBoundingClientRect();
      const statusRect = statusBar?.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const boundaryTop = Math.max(VIEWPORT_GUTTER, (shellRect?.top ?? 0) + VIEWPORT_GUTTER);
      const boundaryBottom =
        Math.min(viewportHeight, statusRect?.top ?? viewportHeight) - VIEWPORT_GUTTER;
      const targetHeight = Math.min(PALETTE_MAX_HEIGHT, Math.floor(viewportHeight * 0.7));
      const belowTop = anchorRect.bottom + PALETTE_GAP;
      const roomBelow = Math.max(0, boundaryBottom - belowTop);
      const roomAbove = Math.max(0, anchorRect.top - PALETTE_GAP - boundaryTop);
      const opensAbove = roomBelow < Math.min(targetHeight, 220) && roomAbove > roomBelow;
      const availableHeight = opensAbove ? roomAbove : roomBelow;
      const maxHeight = Math.max(0, Math.min(targetHeight, Math.floor(availableHeight)));
      const top = opensAbove
        ? Math.max(boundaryTop, anchorRect.top - PALETTE_GAP - maxHeight)
        : belowTop;

      const width = Math.max(0, Math.min(PALETTE_WIDTH, viewportWidth - VIEWPORT_GUTTER * 2));
      const opensLeft = Boolean(anchor.closest('.squisq-scene-side-toolbar'));
      const preferredLeft = opensLeft ? anchorRect.left - PALETTE_GAP - width : anchorRect.left;
      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(preferredLeft, viewportWidth - width - VIEWPORT_GUTTER),
      );

      const next: PalettePosition = {
        position: 'fixed',
        top: Math.round(top),
        left: Math.round(left),
        right: 'auto',
        width: Math.round(width),
        maxHeight,
      };
      setPosition((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(anchor);
    if (editorShell) observer?.observe(editorShell);
    if (statusBar) observer?.observe(statusBar);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="squisq-mermaid-shape-palette"
      role="dialog"
      aria-label="Mermaid node shapes"
      style={position ?? undefined}
    >
      <input
        className="squisq-mermaid-shape-search"
        type="search"
        value={query}
        placeholder="Search 48 Mermaid shapes…"
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="squisq-mermaid-shape-scroll">
        {sections.map((section) => (
          <section key={section.category}>
            <div className="squisq-mermaid-shape-heading">{section.category}</div>
            <div className="squisq-mermaid-shape-grid">
              {section.shapes.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  className={`squisq-mermaid-shape-item${selected === shape.id ? ' squisq-mermaid-shape-item--selected' : ''}`}
                  onClick={() => onPick(shape.id)}
                  title={`${shape.label} (${shape.id})`}
                  aria-label={`${shape.label} shape`}
                  aria-pressed={selected === shape.id}
                >
                  <MermaidShapeThumb shape={shape.id} />
                  <span>{shape.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {sections.length === 0 && (
          <div className="squisq-mermaid-shape-empty">No matching Mermaid shape.</div>
        )}
      </div>
    </div>
  );
}

function MermaidShapeThumb({ shape }: { shape: MermaidFlowchartShapeId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;
  if (shape.includes('circ') || shape === 'circle') {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <ellipse cx="17" cy="12" rx="10" ry="9" {...common} />
        {(shape === 'dbl-circ' || shape === 'fr-circ' || shape === 'cross-circ') && (
          <ellipse cx="17" cy="12" rx="7" ry="6" {...common} />
        )}
      </svg>
    );
  }
  if (shape === 'diam' || shape === 'hourglass' || shape === 'bow-rect') {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <path
          d={shape === 'diam' ? 'M17 2 31 12 17 22 3 12Z' : 'M4 3 30 3 20 12 30 21 4 21 14 12Z'}
          {...common}
        />
      </svg>
    );
  }
  if (shape === 'tri' || shape === 'flip-tri') {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <path d={shape === 'tri' ? 'M17 2 31 21 3 21Z' : 'M3 3 31 3 17 22Z'} {...common} />
      </svg>
    );
  }
  if (shape === 'cloud') {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <path d="M8 20c-7 0-7-9-1-10C7 3 16 1 20 6c6-2 10 3 8 7 6 4 1 8-4 8Z" {...common} />
      </svg>
    );
  }
  if (shape === 'cyl' || shape === 'h-cyl' || shape === 'lin-cyl') {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <path d="M5 5c0-4 24-4 24 0v14c0 4-24 4-24 0ZM5 5c0 4 24 4 24 0" {...common} />
      </svg>
    );
  }
  if (shape === 'hex' || shape.includes('pent') || shape.startsWith('trap')) {
    return (
      <svg viewBox="0 0 34 24" aria-hidden="true">
        <path d="M8 3h18l5 9-5 9H8l-5-9Z" {...common} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 34 24" aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="28"
        height="16"
        rx={shape === 'rounded' || shape === 'stadium' || shape === 'delay' ? 8 : 1}
        {...common}
      />
      {(shape.startsWith('lin-') || shape.startsWith('fr-') || shape.startsWith('div-')) && (
        <path d="M8 4v16M26 4v16" {...common} />
      )}
    </svg>
  );
}

export default MermaidShapePalette;
