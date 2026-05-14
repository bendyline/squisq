/**
 * TemplatePicker
 *
 * A custom popover that replaces the plain <select> for block templates.
 * Each template entry shows a mini wireframe SVG, a human-readable label,
 * and a one-sentence description so authors can quickly find the right layout.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Template metadata ─────────────────────────────────────────────

interface TemplateEntry {
  name: string;
  label: string;
  description: string;
  icon: JSX.Element;
}

const W = 56;
const H = 40;

/** Neutral fill for structural shapes */
const F1 = '#d1d5db';
/** Slightly darker fill for important / featured elements */
const F2 = '#9ca3af';
/** Accent fill (stat number, image, play button) */
const FA = '#818cf8';

function TemplateIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="squisq-template-picker-icon"
    >
      {children}
    </svg>
  );
}

const NONE_ENTRY: TemplateEntry = {
  name: '',
  label: '— none —',
  description: 'Plain heading block with no visual template.',
  icon: (
    <TemplateIcon>
      <rect
        x={4}
        y={4}
        width={48}
        height={32}
        rx={2}
        fill="none"
        stroke={F1}
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      <rect x={12} y={15} width={32} height={4} rx={1} fill={F1} />
      <rect x={16} y={22} width={24} height={3} rx={1} fill={F1} opacity={0.6} />
    </TemplateIcon>
  ),
};

const TEMPLATE_ENTRIES: TemplateEntry[] = [
  {
    name: 'title',
    label: 'Title',
    description: 'A bold opening slide with large title text, perfect for covers and chapters.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={4} width={48} height={32} rx={2} fill={F1} opacity={0.3} />
        <rect x={8} y={11} width={40} height={8} rx={1} fill={FA} />
        <rect x={14} y={23} width={28} height={3} rx={1} fill={F2} />
        <rect x={20} y={29} width={16} height={2} rx={1} fill={F1} />
      </TemplateIcon>
    ),
  },
  {
    name: 'sectionHeader',
    label: 'Section Header',
    description: 'A clean section break with a prominent title and optional subtitle.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={4} width={3} height={32} rx={1} fill={FA} />
        <rect x={11} y={8} width={36} height={6} rx={1} fill={F2} />
        <rect x={11} y={18} width={28} height={3} rx={1} fill={F1} />
        <rect x={11} y={24} width={20} height={2.5} rx={1} fill={F1} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'statHighlight',
    label: 'Stat Highlight',
    description: 'Showcases a single key number or metric with supporting context.',
    icon: (
      <TemplateIcon>
        <rect x={14} y={4} width={28} height={16} rx={2} fill={FA} />
        <rect x={10} y={24} width={36} height={3.5} rx={1} fill={F2} />
        <rect x={16} y={30} width={24} height={2.5} rx={1} fill={F1} />
      </TemplateIcon>
    ),
  },
  {
    name: 'quote',
    label: 'Quote',
    description: 'Displays a stylized pull quote with decorative marks and attribution.',
    icon: (
      <TemplateIcon>
        <text
          x={5}
          y={18}
          fontSize={18}
          fill={FA}
          fontFamily="serif"
          fontWeight="bold"
          opacity={0.7}
        >
          "
        </text>
        <rect x={16} y={8} width={36} height={4} rx={1} fill={F2} />
        <rect x={16} y={15} width={32} height={4} rx={1} fill={F2} />
        <rect x={16} y={22} width={24} height={4} rx={1} fill={F2} />
        <rect x={16} y={31} width={18} height={2.5} rx={1} fill={F1} />
      </TemplateIcon>
    ),
  },
  {
    name: 'factCard',
    label: 'Fact Card',
    description: 'Presents a focused fact or insight with a labeled header and body text.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={4} width={20} height={6} rx={3} fill={FA} opacity={0.8} />
        <rect x={4} y={14} width={48} height={5} rx={1} fill={F2} />
        <rect x={4} y={22} width={44} height={3.5} rx={1} fill={F1} />
        <rect x={4} y={28} width={36} height={3} rx={1} fill={F1} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'twoColumn',
    label: 'Two Column',
    description: 'Divides the slide into two equal side-by-side content columns.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={4} width={23} height={32} rx={2} fill={F1} opacity={0.4} />
        <rect x={3} y={4} width={23} height={7} rx={2} fill={F2} opacity={0.6} />
        <rect x={6} y={15} width={17} height={3} rx={1} fill={F1} />
        <rect x={6} y={21} width={14} height={2.5} rx={1} fill={F1} opacity={0.7} />
        <rect x={30} y={4} width={23} height={32} rx={2} fill={F1} opacity={0.4} />
        <rect x={30} y={4} width={23} height={7} rx={2} fill={F2} opacity={0.6} />
        <rect x={33} y={15} width={17} height={3} rx={1} fill={F1} />
        <rect x={33} y={21} width={14} height={2.5} rx={1} fill={F1} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'dateEvent',
    label: 'Date Event',
    description: 'Highlights a date-based event or milestone with a prominent date display.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={4} width={18} height={18} rx={3} fill={FA} opacity={0.85} />
        <rect x={6} y={8} width={12} height={2} rx={1} fill="white" opacity={0.7} />
        <rect x={6} y={13} width={12} height={6} rx={1} fill="white" opacity={0.5} />
        <rect x={25} y={6} width={27} height={5} rx={1} fill={F2} />
        <rect x={25} y={15} width={22} height={3} rx={1} fill={F1} />
        <rect x={25} y={21} width={16} height={2.5} rx={1} fill={F1} opacity={0.7} />
        <rect x={3} y={27} width={50} height={2.5} rx={1} fill={F1} opacity={0.5} />
        <rect x={3} y={32} width={40} height={2} rx={1} fill={F1} opacity={0.4} />
      </TemplateIcon>
    ),
  },
  {
    name: 'imageWithCaption',
    label: 'Image with Caption',
    description: 'Displays a full-bleed image with an optional caption below.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={50} height={28} rx={2} fill={F2} opacity={0.5} />
        <line x1={3} y1={14} x2={53} y2={14} stroke="white" strokeWidth={0.5} opacity={0.3} />
        <polygon points="22,10 22,20 32,15" fill="white" opacity={0.4} />
        <rect x={10} y={35} width={36} height={2.5} rx={1} fill={F1} />
      </TemplateIcon>
    ),
  },
  {
    name: 'leftFeature',
    label: 'Left Feature',
    description: 'Image on the left, title and body text stacked on the right.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={4} width={24} height={32} rx={2} fill={F2} opacity={0.55} />
        <polygon points="11,16 11,24 19,20" fill="white" opacity={0.5} />
        <rect x={31} y={9} width={20} height={4} rx={1} fill={FA} />
        <rect x={31} y={17} width={22} height={2.5} rx={1} fill={F1} />
        <rect x={31} y={22} width={22} height={2.5} rx={1} fill={F1} opacity={0.75} />
        <rect x={31} y={27} width={16} height={2.5} rx={1} fill={F1} opacity={0.6} />
      </TemplateIcon>
    ),
  },
  {
    name: 'rightFeature',
    label: 'Right Feature',
    description: 'Image on the right, title and body text stacked on the left.',
    icon: (
      <TemplateIcon>
        <rect x={29} y={4} width={24} height={32} rx={2} fill={F2} opacity={0.55} />
        <polygon points="37,16 37,24 45,20" fill="white" opacity={0.5} />
        <rect x={3} y={9} width={20} height={4} rx={1} fill={FA} />
        <rect x={3} y={17} width={22} height={2.5} rx={1} fill={F1} />
        <rect x={3} y={22} width={22} height={2.5} rx={1} fill={F1} opacity={0.75} />
        <rect x={3} y={27} width={16} height={2.5} rx={1} fill={F1} opacity={0.6} />
      </TemplateIcon>
    ),
  },
  {
    name: 'map',
    label: 'Map',
    description: 'Embeds an interactive map centered on a geographic location.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={50} height={34} rx={2} fill={F1} opacity={0.3} />
        <line x1={3} y1={13} x2={53} y2={13} stroke={F1} strokeWidth={1} />
        <line x1={3} y1={23} x2={53} y2={23} stroke={F1} strokeWidth={1} />
        <line x1={18} y1={3} x2={18} y2={37} stroke={F1} strokeWidth={1} />
        <line x1={38} y1={3} x2={38} y2={37} stroke={F1} strokeWidth={1} />
        <circle cx={28} cy={18} r={4} fill={FA} opacity={0.8} />
        <line x1={28} y1={22} x2={28} y2={26} stroke={FA} strokeWidth={1.5} opacity={0.6} />
      </TemplateIcon>
    ),
  },
  {
    name: 'fullBleedQuote',
    label: 'Full Bleed Quote',
    description: 'A full-width quote that spans the entire slide for maximum impact.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={4} width={48} height={32} rx={2} fill={F2} opacity={0.2} />
        <text
          x={5}
          y={15}
          fontSize={16}
          fill={FA}
          fontFamily="serif"
          fontWeight="bold"
          opacity={0.8}
        >
          "
        </text>
        <rect x={4} y={14} width={48} height={5} rx={1} fill={F2} />
        <rect x={4} y={22} width={44} height={5} rx={1} fill={F2} />
        <rect x={4} y={30} width={30} height={4} rx={1} fill={F2} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'list',
    label: 'List',
    description: 'Renders a bulleted or numbered list in a clean, card-style layout.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={5} width={6} height={5} rx={3} fill={FA} opacity={0.8} />
        <rect x={14} y={6} width={38} height={4} rx={1} fill={F2} />
        <rect x={4} y={17} width={6} height={5} rx={3} fill={FA} opacity={0.8} />
        <rect x={14} y={18} width={34} height={4} rx={1} fill={F2} />
        <rect x={4} y={29} width={6} height={5} rx={3} fill={FA} opacity={0.8} />
        <rect x={14} y={30} width={36} height={4} rx={1} fill={F2} />
      </TemplateIcon>
    ),
  },
  {
    name: 'photoGrid',
    label: 'Photo Grid',
    description: 'Arranges multiple photos in a 2×2 or 3×3 mosaic grid.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={23} height={16} rx={1.5} fill={F2} opacity={0.55} />
        <rect x={30} y={3} width={23} height={16} rx={1.5} fill={F2} opacity={0.7} />
        <rect x={3} y={22} width={23} height={16} rx={1.5} fill={F2} opacity={0.8} />
        <rect x={30} y={22} width={23} height={16} rx={1.5} fill={F2} opacity={0.5} />
      </TemplateIcon>
    ),
  },
  {
    name: 'definitionCard',
    label: 'Definition Card',
    description: 'Shows a term and its definition in a structured, dictionary-style card.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={6} width={32} height={6} rx={1} fill={FA} opacity={0.8} />
        <rect x={4} y={17} width={48} height={3.5} rx={1} fill={F1} />
        <rect x={4} y={23} width={44} height={3} rx={1} fill={F1} opacity={0.8} />
        <rect x={4} y={29} width={36} height={3} rx={1} fill={F1} opacity={0.6} />
      </TemplateIcon>
    ),
  },
  {
    name: 'comparisonBar',
    label: 'Comparison Bar',
    description: 'Visualizes two or more values side-by-side with labeled horizontal bars.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={5} width={14} height={3} rx={1} fill={F1} />
        <rect x={20} y={4} width={32} height={5} rx={1} fill={FA} opacity={0.85} />
        <rect x={4} y={16} width={14} height={3} rx={1} fill={F1} />
        <rect x={20} y={15} width={22} height={5} rx={1} fill={F2} opacity={0.7} />
        <rect x={4} y={27} width={14} height={3} rx={1} fill={F1} />
        <rect x={20} y={26} width={28} height={5} rx={1} fill={F2} opacity={0.5} />
      </TemplateIcon>
    ),
  },
  {
    name: 'pullQuote',
    label: 'Pull Quote',
    description: 'A stylized pull quote with large decorative marks and centered text.',
    icon: (
      <TemplateIcon>
        <text x={3} y={20} fontSize={26} fill={FA} fontFamily="serif" opacity={0.5}>
          "
        </text>
        <rect x={16} y={7} width={36} height={4.5} rx={1} fill={F2} />
        <rect x={16} y={15} width={34} height={4.5} rx={1} fill={F2} />
        <rect x={16} y={23} width={28} height={4.5} rx={1} fill={F2} />
        <rect x={32} y={31} width={20} height={3} rx={1} fill={F1} />
        <text x={44} y={42} fontSize={26} fill={FA} fontFamily="serif" opacity={0.3}>
          "
        </text>
      </TemplateIcon>
    ),
  },
  {
    name: 'videoWithCaption',
    label: 'Video with Caption',
    description: 'Embeds a video player with an optional caption below.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={50} height={28} rx={2} fill={F1} opacity={0.4} />
        <rect x={3} y={3} width={50} height={28} rx={2} fill={F2} opacity={0.25} />
        <circle cx={28} cy={17} r={8} fill={FA} opacity={0.7} />
        <polygon points="25,13 25,21 33,17" fill="white" />
        <rect x={10} y={35} width={36} height={2.5} rx={1} fill={F1} />
      </TemplateIcon>
    ),
  },
  {
    name: 'videoPullQuote',
    label: 'Video Pull Quote',
    description: 'Combines a video panel with a highlighted pull quote side-by-side.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={4} width={23} height={32} rx={2} fill={F2} opacity={0.35} />
        <circle cx={14.5} cy={20} r={6} fill={FA} opacity={0.65} />
        <polygon points="12,17 12,23 18,20" fill="white" />
        <rect x={30} y={4} width={23} height={32} rx={2} fill={F1} opacity={0.3} />
        <text x={32} y={16} fontSize={12} fill={FA} fontFamily="serif" opacity={0.6}>
          "
        </text>
        <rect x={30} y={17} width={20} height={3.5} rx={1} fill={F2} />
        <rect x={30} y={23} width={18} height={3} rx={1} fill={F1} />
        <rect x={30} y={29} width={14} height={2.5} rx={1} fill={F1} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'dataTable',
    label: 'Data Table',
    description: 'Renders tabular data in a clean, styled table with a header row.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={50} height={8} rx={1.5} fill={FA} opacity={0.7} />
        <rect x={3} y={13} width={50} height={6} rx={1} fill={F1} opacity={0.5} />
        <rect x={3} y={21} width={50} height={6} rx={1} fill={F1} opacity={0.35} />
        <rect x={3} y={29} width={50} height={6} rx={1} fill={F1} opacity={0.5} />
        <line x1={20} y1={3} x2={20} y2={35} stroke="white" strokeWidth={1} opacity={0.4} />
        <line x1={37} y1={3} x2={37} y2={35} stroke="white" strokeWidth={1} opacity={0.4} />
      </TemplateIcon>
    ),
  },
];

/**
 * Convert a camelCase template id to a human-readable label. Accepts both
 * the canonical short ids (`title`, `quote`, `map`, `list`) and the
 * legacy long ones (`titleBlock`, `quoteBlock`, `mapBlock`, `listBlock`)
 * so existing documents keep showing a friendly label without first
 * normalizing their annotations.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function templateLabel(name: string): string {
  if (!name) return '— none —';
  const resolved = TEMPLATE_NAME_ALIASES[name] ?? name;
  const entry = TEMPLATE_ENTRIES.find((e) => e.name === resolved);
  if (entry) return entry.label;
  // Fallback: split camelCase
  return resolved.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

/**
 * Legacy template id → canonical short id. Kept inline to avoid pulling
 * the core package's runtime registry into the picker's bundle — the
 * picker only needs this for label resolution.
 */
const TEMPLATE_NAME_ALIASES: Readonly<Record<string, string>> = {
  titleBlock: 'title',
  quoteBlock: 'quote',
  mapBlock: 'map',
  listBlock: 'list',
};

// ── Component ─────────────────────────────────────────────────────

export interface TemplatePickerProps {
  value: string;
  onChange: (name: string) => void;
  /** When true, shows only the trigger button (no popover) — used in the overflow menu. */
  compact?: boolean;
}

export function TemplatePicker({ value, onChange, compact }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Position the portal popover below the trigger button. Clamp the
  // left edge so the gallery (up to 780px wide) doesn't overflow the
  // viewport when the toolbar trigger sits near the right edge of the
  // window — previously the popover was left-aligned to the trigger,
  // which pushed half the cards off-screen at narrow widths.
  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverEl = document.getElementById('squisq-template-gallery-portal');
    // Use the actual rendered width if the popover is already mounted;
    // otherwise fall back to the CSS-defined max so the first paint
    // doesn't overflow either. Measure the portal element directly —
    // its `firstElementChild` is the (small) "(none)" option, not the
    // gallery itself.
    const popoverWidth = popoverEl?.getBoundingClientRect().width ?? 780;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - popoverWidth - margin);
    const left = Math.min(Math.max(margin, rect.left), maxLeft);
    setPopoverStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      zIndex: 9999,
    });
  };

  const handleOpen = () => {
    updatePosition();
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inPopover = document.getElementById('squisq-template-gallery-portal')?.contains(target);
      if (!inTrigger && !inPopover) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    // Reposition once on the next frame so the clamp uses the actual
    // rendered popover width (the initial open() runs before mount).
    requestAnimationFrame(updatePosition);
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const currentLabel = templateLabel(value);
  const currentEntry: TemplateEntry =
    (value && TEMPLATE_ENTRIES.find((e) => e.name === value)) || NONE_ENTRY;

  if (compact) {
    // In overflow menu, use a simple select for space efficiency
    const all: TemplateEntry[] = [NONE_ENTRY, ...TEMPLATE_ENTRIES];
    return (
      <select
        className="squisq-template-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {all.map((e) => (
          <option key={e.name} value={e.name}>
            {e.label}
          </option>
        ))}
      </select>
    );
  }

  const gallery = open
    ? createPortal(
        <TemplateGalleryBody value={value} onSelect={handleSelect} style={popoverStyle} />,
        document.body,
      )
    : null;

  return (
    <div className="squisq-template-picker-popover-host" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-template-picker-trigger${open ? ' squisq-template-picker-trigger--open' : ''}`}
        onClick={handleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose block template"
      >
        <span className="squisq-template-picker-trigger-label">Block:</span>
        <span className="squisq-template-picker-trigger-thumb" aria-hidden="true">
          {currentEntry.icon}
        </span>
        <span className="squisq-template-picker-trigger-value">
          {value ? currentLabel : '(No visual)'}
        </span>
        <svg
          className="squisq-template-picker-trigger-caret"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {gallery}
    </div>
  );
}

// ── Reusable gallery body ──────────────────────────────────────────

/**
 * The popover/grid markup shared by the toolbar `TemplatePicker` and the
 * inline `TemplateBadgeMenu`. Renders all template cards plus the
 * "(none)" option; no positioning logic — callers supply `style` (typically
 * a `position: fixed` rect from `getBoundingClientRect()`).
 */
function TemplateGalleryBody({
  value,
  onSelect,
  style,
}: {
  value: string;
  onSelect: (name: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      id="squisq-template-gallery-portal"
      className="squisq-template-gallery"
      role="listbox"
      aria-label="Block templates"
      style={style}
    >
      <button
        type="button"
        role="option"
        aria-selected={value === ''}
        className={`squisq-template-gallery-none${value === '' ? ' squisq-template-gallery-card--selected' : ''}`}
        onClick={() => onSelect('')}
      >
        {NONE_ENTRY.icon}
        <span className="squisq-template-gallery-none-label">{NONE_ENTRY.label}</span>
        <span className="squisq-template-gallery-none-desc">{NONE_ENTRY.description}</span>
      </button>

      <div className="squisq-template-gallery-grid">
        {TEMPLATE_ENTRIES.map((entry) => (
          <button
            key={entry.name}
            type="button"
            role="option"
            aria-selected={value === entry.name}
            className={`squisq-template-gallery-card${value === entry.name ? ' squisq-template-gallery-card--selected' : ''}`}
            onClick={() => onSelect(entry.name)}
            title={entry.description}
          >
            <div className="squisq-template-gallery-card-icon">{entry.icon}</div>
            <div className="squisq-template-gallery-card-body">
              <span className="squisq-template-gallery-card-name">{entry.label}</span>
              <span className="squisq-template-gallery-card-desc">{entry.description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Inline badge popover (anchored at a heading badge) ─────────────

export interface TemplateBadgePopoverProps {
  /** DOMRect of the badge that triggered the popover (in viewport coords). */
  anchorRect: DOMRect;
  /** Currently active template name (empty string for none). */
  value: string;
  onChange: (name: string) => void;
  onClose: () => void;
}

/**
 * Standalone popover that mirrors the toolbar `TemplatePicker`'s gallery,
 * but is anchored to a caller-supplied DOM rect (typically a clicked
 * `.squisq-template-badge` span). Handles its own positioning, outside
 * clicks, Escape, and viewport-edge clamping.
 */
export function TemplateBadgePopover({
  anchorRect,
  value,
  onChange,
  onClose,
}: TemplateBadgePopoverProps) {
  const [style, setStyle] = useState<React.CSSProperties>(() => computePopoverStyle(anchorRect));

  // Reposition once after mount using the actual rendered popover width.
  useEffect(() => {
    requestAnimationFrame(() => setStyle(computePopoverStyle(anchorRect)));
  }, [anchorRect]);

  // Outside click + Escape close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPopover = document.getElementById('squisq-template-gallery-portal')?.contains(target);
      if (!inPopover) onClose();
    };
    // Defer the mousedown listener by one frame so the click that opened
    // us doesn't immediately close us.
    const id = requestAnimationFrame(() => {
      document.addEventListener('mousedown', onMouse);
    });
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleSelect = (name: string) => {
    onChange(name);
    onClose();
  };

  return createPortal(
    <TemplateGalleryBody value={value} onSelect={handleSelect} style={style} />,
    document.body,
  );
}

function computePopoverStyle(rect: DOMRect): React.CSSProperties {
  // The portal *is* the gallery (`#squisq-template-gallery-portal` is the
  // outer `.squisq-template-gallery` div). Measure it directly — using
  // `firstElementChild` returns the "(none)" option, which is ~50px tall
  // and made the "fits below" check incorrectly pass on tall galleries.
  const popoverEl = document.getElementById('squisq-template-gallery-portal');
  const popoverRect = popoverEl?.getBoundingClientRect();
  const popoverWidth = popoverRect?.width ?? 780;
  const popoverHeight = popoverRect?.height ?? 520;
  const margin = 8;
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical placement: prefer below the badge, fall back to above.
  // If neither fits, center the popover in the viewport (dialog-style)
  // so the gallery is always fully visible no matter where the chip
  // sits in the editor (top, middle, bottom).
  const spaceBelow = vh - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top: number;
  let left: number;
  if (popoverHeight + gap <= spaceBelow) {
    top = rect.bottom + gap;
    const maxLeft = Math.max(margin, vw - popoverWidth - margin);
    left = Math.min(Math.max(margin, rect.left), maxLeft);
  } else if (popoverHeight + gap <= spaceAbove) {
    top = rect.top - popoverHeight - gap;
    const maxLeft = Math.max(margin, vw - popoverWidth - margin);
    left = Math.min(Math.max(margin, rect.left), maxLeft);
  } else {
    // Center it.
    top = Math.max(margin, Math.floor((vh - popoverHeight) / 2));
    left = Math.max(margin, Math.floor((vw - popoverWidth) / 2));
  }

  return {
    position: 'fixed',
    top,
    left,
    // Cap height so an oversized gallery still fits and scrolls
    // gracefully instead of pushing past the viewport.
    maxHeight: `${vh - 2 * margin}px`,
    overflowY: 'auto',
    zIndex: 9999,
  };
}
