/**
 * TemplatePicker
 *
 * A custom popover that replaces the plain <select> for block templates.
 * Each template entry shows a mini wireframe SVG, a human-readable label,
 * and a one-sentence description so authors can quickly find the right layout.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import { TEMPLATE_METADATA, resolveTemplateName } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { useCustomTemplates } from './customTemplates/CustomTemplateContext';
import { TemplateThumbnail } from './customTemplates/thumbnail';
import { TemplateContentPreview } from './TemplateContentPreview';
import {
  resolveTemplateContentPreviewResult,
  type TemplatePreviewSource,
} from './templateContentPreviewResolver';
import { useModalDialog } from './modal/useModalDialog';

// ── Template metadata ─────────────────────────────────────────────
//
// The canonical list of built-in templates (which ids exist, their labels,
// and their descriptions) lives in core's `TEMPLATE_METADATA`. The entries
// below add the one thing core can't hold — a React/SVG preview icon per id —
// and MUST stay 1:1 with `TEMPLATE_METADATA` (same ids, same order, same
// label/description). `templatePickerMetadata.test.ts` enforces this, so a
// template added to the core registry without a picker icon (or vice versa)
// fails the build instead of silently disappearing from the gallery.

interface TemplateEntry {
  name: string;
  label: string;
  description: string;
  icon: JSX.Element;
}

/** Matches every gallery when multiple editor instances are mounted. */
export const TEMPLATE_GALLERY_PORTAL_SELECTOR = '[data-squisq-template-gallery-portal]';

const TEMPLATE_GALLERY_DIALOG_ID = 'squisq-template-gallery-dialog';
const TEMPLATE_GALLERY_PORTAL_ID_PREFIX = 'squisq-template-gallery-portal';

/**
 * Give each portaled gallery a stable, collision-free id. Hosts should match
 * galleries through {@link TEMPLATE_GALLERY_PORTAL_SELECTOR}; a process-wide
 * singleton id cannot identify the right editor when several are mounted.
 */
function useTemplateGalleryPortalId(): string {
  return `${TEMPLATE_GALLERY_PORTAL_ID_PREFIX}-${useId().replace(/:/g, '')}`;
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
  description: 'Plain heading block with no visual treatment.',
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

// eslint-disable-next-line react-refresh/only-export-components
export const TEMPLATE_ENTRIES: TemplateEntry[] = [
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
  {
    name: 'diagram',
    label: 'Diagram',
    description:
      'Renders sub-headings as connected nodes — edit visually as a node-and-edge diagram.',
    icon: (
      <TemplateIcon>
        <rect x={4} y={6} width={16} height={10} rx={2} fill={FA} opacity={0.85} />
        <rect x={36} y={6} width={16} height={10} rx={2} fill={F2} opacity={0.8} />
        <rect x={20} y={24} width={16} height={10} rx={2} fill={F2} opacity={0.8} />
        <path d="M 20 11 L 36 11" stroke={FA} strokeWidth={1.5} fill="none" opacity={0.7} />
        <path d="M 36 11 L 32 8.5 L 32 13.5 Z" fill={FA} opacity={0.7} />
        <path
          d="M 12 16 C 12 22, 24 22, 24 24"
          stroke={FA}
          strokeWidth={1.5}
          fill="none"
          opacity={0.7}
        />
        <path
          d="M 44 16 C 44 22, 32 22, 32 24"
          stroke={FA}
          strokeWidth={1.5}
          fill="none"
          opacity={0.7}
        />
      </TemplateIcon>
    ),
  },
  {
    name: 'tree',
    label: 'Tree',
    description:
      'Renders an ASCII file-tree / outline fence as a filesystem-style treeview — edit as an outline.',
    icon: (
      <TemplateIcon>
        <rect x={6} y={5} width={16} height={7} rx={1.5} fill={FA} opacity={0.85} />
        <path
          d="M 12 12 L 12 34 M 12 20 L 22 20 M 12 34 L 22 34"
          stroke={F1}
          strokeWidth={1.5}
          fill="none"
          opacity={0.7}
        />
        <rect x={24} y={16} width={14} height={7} rx={1.5} fill={F2} opacity={0.8} />
        <rect x={24} y={30} width={14} height={7} rx={1.5} fill={F2} opacity={0.8} />
        <rect x={26} y={2} width={14} height={7} rx={1.5} fill={F2} opacity={0.6} />
      </TemplateIcon>
    ),
  },
  {
    name: 'timeline',
    label: 'Timeline',
    description:
      'Plots events across one or more horizontal tracks with callouts and optional branching links.',
    icon: (
      <TemplateIcon>
        <path d="M 5 21 L 51 21" stroke={F1} strokeWidth={1.8} fill="none" />
        <path d="M 47 18 L 52 21 L 47 24" stroke={F1} strokeWidth={1.5} fill="none" />
        <circle cx={13} cy={21} r={3} fill={FA} />
        <circle cx={29} cy={21} r={3} fill={F2} />
        <circle cx={44} cy={21} r={3} fill={FA} />
        <path d="M 13 18 L 13 10 M 29 24 L 29 32 M 44 18 L 44 8" stroke={F1} strokeWidth={1} />
        <rect x={7} y={5} width={12} height={3} rx={1} fill={F2} opacity={0.8} />
        <rect x={23} y={33} width={12} height={3} rx={1} fill={F2} opacity={0.8} />
        <rect x={38} y={3} width={12} height={3} rx={1} fill={F2} opacity={0.8} />
      </TemplateIcon>
    ),
  },
  {
    name: 'layout',
    label: 'Layout',
    description:
      "Free-form 2D canvas — drag layers into place. Use for one-off block layouts that don't fit a template.",
    icon: (
      <TemplateIcon>
        <rect
          x={3}
          y={3}
          width={50}
          height={34}
          rx={2}
          fill="none"
          stroke={F1}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
        <rect x={7} y={7} width={20} height={12} rx={1.5} fill={FA} opacity={0.85} />
        <rect x={30} y={7} width={20} height={26} rx={1.5} fill={F2} opacity={0.7} />
        <rect x={7} y={22} width={20} height={11} rx={1.5} fill={F1} opacity={0.7} />
      </TemplateIcon>
    ),
  },
  {
    name: 'drawing',
    label: 'Drawing',
    description: 'Free-form sketches — draw shapes, paths, and text directly on a 2D surface.',
    icon: (
      <TemplateIcon>
        <rect x={3} y={3} width={50} height={34} rx={2} fill="none" stroke={F1} strokeWidth={1} />
        <path
          d="M 8 28 C 14 12, 26 14, 30 22 S 44 32, 50 14"
          stroke={FA}
          strokeWidth={2}
          fill="none"
          opacity={0.85}
          strokeLinecap="round"
        />
        <circle cx={10} cy={10} r={2.5} fill={F2} />
        <rect x={40} y={28} width={8} height={6} rx={1} fill={F2} opacity={0.7} />
      </TemplateIcon>
    ),
  },
];

/**
 * Canonical template names known to the picker, in the order they
 * appear in the gallery. Exported so callers can hand the same list to
 * `recommendTemplatesForBlock()` and stay in sync with the visual
 * order.
 */
export const TEMPLATE_NAMES: readonly string[] = TEMPLATE_ENTRIES.map((e) => e.name);

/**
 * Convert a camelCase template id to a human-readable label. Accepts both
 * the canonical short ids (`title`, `quote`, `map`, `list`) and the
 * legacy long ones (`titleBlock`, `quoteBlock`, `mapBlock`, `listBlock`)
 * so existing documents keep showing a friendly label without first
 * normalizing their annotations.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function templateLabel(
  name: string,
  customTemplates?: readonly CustomTemplateDefinition[],
): string {
  if (!name) return '— none —';
  // `resolveTemplateName` + `TEMPLATE_METADATA` are the canonical source of
  // truth in core; both legacy long ids (`titleBlock`) and short ids resolve
  // through it, so the picker never has to maintain its own alias/label table.
  const resolved = resolveTemplateName(name);
  const meta = TEMPLATE_METADATA[resolved];
  if (meta) return meta.label;
  const custom = customTemplates?.find((t) => t.name === resolved);
  if (custom) return custom.label;
  // Fallback: split camelCase
  return resolved.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

// ── Component ─────────────────────────────────────────────────────

export interface TemplatePickerProps {
  value: string;
  onChange: (name: string) => void;
  /** Active editor chrome theme, used by the portaled dialog. */
  colorScheme?: 'light' | 'dark';
  /** When true, shows only the trigger button (no popover) — used in the overflow menu. */
  compact?: boolean;
  /**
   * Template names to surface in a "Recommended for this block" section
   * above the full list. When omitted or empty, the gallery renders as a
   * single ungrouped grid (legacy behavior).
   */
  recommended?: readonly string[];
  /**
   * Optional callback fired when the user clicks the "+ New custom
   * template" card pinned at the top of the gallery. The host wires this
   * to open the modal `TemplateDesigner`. When omitted, the card is
   * hidden.
   */
  onOpenDesigner?: () => void;
  /**
   * Active block content used to render live template thumbnails. When omitted,
   * or when a template cannot be meaningfully derived from the block, cards use
   * their static wireframe icons.
   */
  previewSource?: TemplatePreviewSource;
}

export function TemplatePicker({
  value,
  onChange,
  colorScheme = 'light',
  compact,
  recommended,
  onOpenDesigner,
  previewSource,
}: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [dialogStyle, setDialogStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogId = `${TEMPLATE_GALLERY_DIALOG_ID}-${useId().replace(/:/g, '')}`;

  const updateDialogBounds = () => {
    if (!triggerRef.current) return;
    setDialogStyle(computeDialogStyle(triggerRef.current));
  };

  const handleOpen = () => {
    updateDialogBounds();
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inDialog = dialogRef.current?.contains(target);
      if (!inTrigger && !inDialog) {
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
    requestAnimationFrame(updateDialogBounds);
    const handler = () => updateDialogBounds();
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
  const dialogTitle = templateDialogTitle(previewSource);

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
        <TemplateGalleryDialog
          dialogRef={dialogRef}
          returnFocusRef={triggerRef}
          dialogId={dialogId}
          title={dialogTitle}
          colorScheme={colorScheme}
          style={dialogStyle}
          onClose={() => setOpen(false)}
        >
          <TemplateGalleryBody
            value={value}
            onSelect={handleSelect}
            style={{}}
            recommended={recommended}
            onOpenDesigner={onOpenDesigner}
            previewSource={previewSource}
          />
        </TemplateGalleryDialog>,
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
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title="Choose block type"
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

function TemplateGalleryDialog({
  dialogRef,
  returnFocusRef,
  dialogId,
  children,
  title,
  colorScheme,
  style,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDivElement>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  dialogId: string;
  children: React.ReactNode;
  title: string;
  colorScheme: 'light' | 'dark';
  style: React.CSSProperties;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalDialog({ rootRef: dialogRef, dialogRef: panelRef, returnFocusRef, onClose });

  return (
    <div
      ref={dialogRef}
      id={dialogId}
      className="squisq-template-gallery-dialog"
      data-theme={colorScheme}
      style={style}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="squisq-template-gallery-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="squisq-template-gallery-dialog-header">
          <h2 id={titleId} className="squisq-template-gallery-dialog-title">
            {title}
          </h2>
          <button
            type="button"
            className="squisq-template-gallery-dialog-close"
            onClick={onClose}
            aria-label="Close block type picker"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3.2 3.2l7.6 7.6M10.8 3.2l-7.6 7.6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="squisq-template-gallery-dialog-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * The dialog/grid markup shared by the toolbar `TemplatePicker` and the
 * inline `TemplateBadgeMenu`. Renders all template cards plus the
 * "(none)" option; no positioning logic — callers supply `style` (typically
 * a `position: fixed` rect from `getBoundingClientRect()`).
 */
function TemplateCard({
  entry,
  value,
  onSelect,
  previewSource,
}: {
  entry: TemplateEntry;
  value: string;
  onSelect: (name: string) => void;
  previewSource?: TemplatePreviewSource;
}) {
  return (
    <button
      type="button"
      aria-pressed={value === entry.name}
      className={`squisq-template-gallery-card${value === entry.name ? ' squisq-template-gallery-card--selected' : ''}`}
      onClick={() => onSelect(entry.name)}
      title={entry.description}
    >
      <div className="squisq-template-gallery-card-icon">
        <TemplateContentPreview
          templateName={entry.name}
          source={previewSource}
          fallback={entry.icon}
        />
      </div>
      <div className="squisq-template-gallery-card-body">
        <span className="squisq-template-gallery-card-name">{entry.label}</span>
        <span className="squisq-template-gallery-card-desc">{entry.description}</span>
      </div>
    </button>
  );
}

function splitBlockTypeEntriesByContent(
  entries: readonly TemplateEntry[],
  previewSource?: TemplatePreviewSource,
): { blockTypeEntries: TemplateEntry[]; contentNeededEntries: TemplateEntry[] } {
  if (!previewSource) return { blockTypeEntries: [...entries], contentNeededEntries: [] };

  const blockTypeEntries: TemplateEntry[] = [];
  const contentNeededEntries: TemplateEntry[] = [];

  for (const entry of entries) {
    const result = resolveTemplateContentPreviewResult(entry.name, previewSource);
    if (result.warning) contentNeededEntries.push(entry);
    else blockTypeEntries.push(entry);
  }

  return { blockTypeEntries, contentNeededEntries };
}

function TemplateGalleryBody({
  value,
  onSelect,
  style,
  recommended,
  onOpenDesigner,
  previewSource,
}: {
  value: string;
  onSelect: (name: string) => void;
  style: React.CSSProperties;
  recommended?: readonly string[];
  onOpenDesigner?: () => void;
  previewSource?: TemplatePreviewSource;
}) {
  const galleryId = useTemplateGalleryPortalId();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Pull merged doc + library templates from the surrounding context.
  // When the host hasn't wrapped the editor in a CustomTemplateProvider
  // we silently degrade to "no custom templates", which preserves the
  // legacy behaviour for any caller that hasn't opted in.
  const customCtx = useCustomTemplates();
  const customTemplates = useMemo(() => customCtx?.allTemplates ?? [], [customCtx]);

  // Auto-focus the search input when the gallery mounts so the user can
  // start typing immediately to filter templates.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const trimmedQuery = query.trim().toLowerCase();
  const hasQuery = trimmedQuery.length > 0;

  // For search results we match both built-in entries and custom
  // templates by label/name/description so the user can find a custom
  // template by typing its name.
  const matches = useMemo(() => {
    if (!hasQuery) return null;
    const built = TEMPLATE_ENTRIES.filter(
      (e) =>
        e.label.toLowerCase().includes(trimmedQuery) ||
        e.description.toLowerCase().includes(trimmedQuery) ||
        e.name.toLowerCase().includes(trimmedQuery),
    );
    const custom = customTemplates.filter(
      (t) =>
        t.label.toLowerCase().includes(trimmedQuery) ||
        t.name.toLowerCase().includes(trimmedQuery) ||
        (t.description ?? '').toLowerCase().includes(trimmedQuery),
    );
    return { built, custom };
  }, [hasQuery, trimmedQuery, customTemplates]);

  const recommendedSet = useMemo(
    () => (recommended && recommended.length > 0 ? new Set(recommended) : null),
    [recommended],
  );
  const recommendedEntries = useMemo(
    () => (recommendedSet ? TEMPLATE_ENTRIES.filter((e) => recommendedSet.has(e.name)) : []),
    [recommendedSet],
  );
  const restEntries = useMemo(
    () =>
      recommendedSet
        ? TEMPLATE_ENTRIES.filter((e) => !recommendedSet.has(e.name))
        : TEMPLATE_ENTRIES,
    [recommendedSet],
  );
  const { blockTypeEntries, contentNeededEntries } = useMemo(
    () => splitBlockTypeEntriesByContent(restEntries, previewSource),
    [restEntries, previewSource],
  );
  const grouped = !hasQuery && (recommendedEntries.length > 0 || contentNeededEntries.length > 0);

  return (
    <div
      id={galleryId}
      data-squisq-template-gallery-portal=""
      className={`squisq-template-gallery${grouped ? ' squisq-template-gallery--segmented' : ''}`}
      role="region"
      aria-label="Block types"
      style={style}
    >
      <div className="squisq-template-gallery-search">
        <svg
          className="squisq-template-gallery-search-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          className="squisq-template-gallery-search-input"
          placeholder="Search block types…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search block types"
        />
      </div>

      {!hasQuery && (
        <button
          type="button"
          aria-pressed={value === ''}
          className={`squisq-template-gallery-none${value === '' ? ' squisq-template-gallery-card--selected' : ''}`}
          onClick={() => onSelect('')}
        >
          {NONE_ENTRY.icon}
          <span className="squisq-template-gallery-none-label">{NONE_ENTRY.label}</span>
          <span className="squisq-template-gallery-none-desc">{NONE_ENTRY.description}</span>
        </button>
      )}

      {hasQuery ? (
        matches && (matches.built.length > 0 || matches.custom.length > 0) ? (
          <>
            {matches.custom.length > 0 && (
              <div className="squisq-template-gallery-section">
                <h3 className="squisq-template-gallery-section-title">Custom</h3>
                <div className="squisq-template-gallery-grid">
                  {matches.custom.map((def) => (
                    <CustomTemplateCard
                      key={def.name}
                      def={def}
                      value={value}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            )}
            {matches.built.length > 0 && (
              <div className="squisq-template-gallery-grid">
                {matches.built.map((entry) => (
                  <TemplateCard
                    key={entry.name}
                    entry={entry}
                    value={value}
                    onSelect={onSelect}
                    previewSource={previewSource}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="squisq-template-gallery-empty">No block types match "{query}".</div>
        )
      ) : (
        <>
          {/* "+ New custom template" card pinned at the top — only shown
              when the host has wired up `onOpenDesigner`. */}
          {onOpenDesigner && (
            <button type="button" className="squisq-template-gallery-new" onClick={onOpenDesigner}>
              <span className="squisq-template-gallery-new-plus" aria-hidden="true">
                +
              </span>
              <span className="squisq-template-gallery-new-body">
                <span className="squisq-template-gallery-new-label">New block type</span>
                <span className="squisq-template-gallery-new-desc">
                  Design a reusable block type with placeholders for {'{title}'} and {'{content}'}.
                </span>
              </span>
            </button>
          )}

          {customTemplates.length > 0 && (
            <div className="squisq-template-gallery-section">
              <h3 className="squisq-template-gallery-section-title">Custom</h3>
              <div className="squisq-template-gallery-grid">
                {customTemplates.map((def) => (
                  <CustomTemplateCard key={def.name} def={def} value={value} onSelect={onSelect} />
                ))}
              </div>
            </div>
          )}

          {recommendedEntries.length > 0 && (
            <div className="squisq-template-gallery-section">
              <h3 className="squisq-template-gallery-section-title">Suggested Block Types</h3>
              <div className="squisq-template-gallery-grid">
                {recommendedEntries.map((entry) => (
                  <TemplateCard
                    key={entry.name}
                    entry={entry}
                    value={value}
                    onSelect={onSelect}
                    previewSource={previewSource}
                  />
                ))}
              </div>
            </div>
          )}

          {grouped ? (
            <>
              {blockTypeEntries.length > 0 && (
                <div className="squisq-template-gallery-section">
                  <h3 className="squisq-template-gallery-section-title">Block Types</h3>
                  <div className="squisq-template-gallery-grid">
                    {blockTypeEntries.map((entry) => (
                      <TemplateCard
                        key={entry.name}
                        entry={entry}
                        value={value}
                        onSelect={onSelect}
                        previewSource={previewSource}
                      />
                    ))}
                  </div>
                </div>
              )}

              {contentNeededEntries.length > 0 && (
                <div className="squisq-template-gallery-section">
                  <h3 className="squisq-template-gallery-section-title">Block Types for Content</h3>
                  <div className="squisq-template-gallery-grid">
                    {contentNeededEntries.map((entry) => (
                      <TemplateCard
                        key={entry.name}
                        entry={entry}
                        value={value}
                        onSelect={onSelect}
                        previewSource={previewSource}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="squisq-template-gallery-grid">
              {blockTypeEntries.map((entry) => (
                <TemplateCard
                  key={entry.name}
                  entry={entry}
                  value={value}
                  onSelect={onSelect}
                  previewSource={previewSource}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Picker card for a user-authored template. Mirrors `TemplateCard`'s
 * shape so it slots into the gallery grid, but draws the thumbnail by
 * rendering the template's layers via `<TemplateThumbnail>`. Selecting
 * it dispatches the template name; the host's `applyTemplate` (called
 * separately by the badge update flow) inlines the def into the doc.
 */
function CustomTemplateCard({
  def,
  value,
  onSelect,
}: {
  def: CustomTemplateDefinition;
  value: string;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={value === def.name}
      className={`squisq-template-gallery-card${
        value === def.name ? ' squisq-template-gallery-card--selected' : ''
      }`}
      onClick={() => onSelect(def.name)}
      title={def.description ?? def.label}
    >
      <div className="squisq-template-gallery-card-icon">
        <TemplateThumbnail def={def} />
      </div>
      <div className="squisq-template-gallery-card-body">
        <span className="squisq-template-gallery-card-name">{def.label}</span>
        <span className="squisq-template-gallery-card-desc">
          {def.description ?? 'Custom block type'}
        </span>
      </div>
    </button>
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
  /** Active editor chrome theme, used by the portaled dialog. */
  colorScheme?: 'light' | 'dark';
  /** Optional list of template names to surface as "Recommended for this block". */
  recommended?: readonly string[];
  /**
   * Optional callback for the "+ New custom template" card. When
   * supplied, the gallery shows the card pinned at the top; clicking
   * it closes the popover and opens the designer.
   */
  onOpenDesigner?: () => void;
  /**
   * Active block content used to render live template thumbnails. Falls back to
   * static icons when a candidate cannot be derived.
   */
  previewSource?: TemplatePreviewSource;
}

/**
 * Standalone dialog that mirrors the toolbar `TemplatePicker`'s gallery
 * when opened from an inline heading badge.
 */
export function TemplateBadgePopover({
  anchorRect,
  value,
  onChange,
  onClose,
  colorScheme = 'light',
  recommended,
  onOpenDesigner,
  previewSource,
}: TemplateBadgePopoverProps) {
  const [style, setStyle] = useState<React.CSSProperties>(() => computeDialogStyle(anchorRect));
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogId = `${TEMPLATE_GALLERY_DIALOG_ID}-${useId().replace(/:/g, '')}`;

  // Reposition once after mount so the dialog covers the current editor shell.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStyle(computeDialogStyle(anchorRect)));
    return () => cancelAnimationFrame(frame);
  }, [anchorRect]);

  // Outside click + Escape close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDialog = dialogRef.current?.contains(target);
      if (!inDialog) onClose();
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

  const dialogTitle = templateDialogTitle(previewSource);

  return createPortal(
    <TemplateGalleryDialog
      dialogRef={dialogRef}
      dialogId={dialogId}
      title={dialogTitle}
      colorScheme={colorScheme}
      style={style}
      onClose={onClose}
    >
      <TemplateGalleryBody
        value={value}
        onSelect={handleSelect}
        style={{}}
        recommended={recommended}
        onOpenDesigner={onOpenDesigner}
        previewSource={previewSource}
      />
    </TemplateGalleryDialog>,
    document.body,
  );
}

function templateDialogTitle(previewSource?: TemplatePreviewSource): string {
  return `Block Type for ${templateDialogBlockTitle(previewSource)}`;
}

function templateDialogBlockTitle(previewSource?: TemplatePreviewSource): string {
  const block = previewSource?.block;
  if (!block) return 'this block';

  const headingText = block.sourceHeading ? extractPlainText(block.sourceHeading).trim() : '';
  const title = (headingText || block.title || '').replace(/\s+/g, ' ').trim();
  return title || 'this block';
}

function computeDialogStyle(anchor: Element | DOMRect): React.CSSProperties {
  const shellRect = findEditorShellRect(anchor);
  const left = Math.max(0, shellRect.left);
  const top = Math.max(0, shellRect.top);
  const right = Math.min(window.innerWidth, shellRect.right);
  const bottom = Math.min(window.innerHeight, shellRect.bottom);

  return {
    position: 'fixed',
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    zIndex: 9999,
  };
}

function findEditorShellRect(anchor: Element | DOMRect): DOMRect {
  if (anchor instanceof Element) {
    const shell = anchor.closest('.squisq-editor-shell');
    if (shell) return shell.getBoundingClientRect();
  } else {
    const x = anchor.left + anchor.width / 2;
    const y = anchor.top + anchor.height / 2;
    for (const element of document.elementsFromPoint(x, y)) {
      const shell = element.closest('.squisq-editor-shell');
      if (shell) return shell.getBoundingClientRect();
    }
  }

  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}
