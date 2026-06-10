/**
 * Canonical, framework-free UI metadata for every built-in block template.
 *
 * This is the single source of truth for the human-readable label and the
 * one-sentence description of each template id in {@link templateRegistry}.
 * The editor's `TemplatePicker` renders its gallery from this map (joining
 * each id with a locally-defined SVG icon, which can't live in this
 * framework-free package), so a template only has to be added here and to
 * `templateRegistry` for it to surface in the editor.
 *
 * `templateMetadata.test.ts` asserts this map and `templateRegistry` stay
 * exactly 1:1 — adding a template to one without the other fails the build.
 *
 * Order matters: pickers iterate this object's insertion order, so it doubles
 * as the canonical gallery order.
 */

export interface TemplateMetadata {
  /** Human-readable label shown in pickers (e.g. "Image with Caption"). */
  label: string;
  /** One-sentence description of when to reach for this template. */
  description: string;
}

export const TEMPLATE_METADATA: Record<string, TemplateMetadata> = {
  title: {
    label: 'Title',
    description: 'A bold opening slide with large title text, perfect for covers and chapters.',
  },
  sectionHeader: {
    label: 'Section Header',
    description: 'A clean section break with a prominent title and optional subtitle.',
  },
  statHighlight: {
    label: 'Stat Highlight',
    description: 'Showcases a single key number or metric with supporting context.',
  },
  quote: {
    label: 'Quote',
    description: 'Displays a stylized pull quote with decorative marks and attribution.',
  },
  factCard: {
    label: 'Fact Card',
    description: 'Presents a focused fact or insight with a labeled header and body text.',
  },
  twoColumn: {
    label: 'Two Column',
    description: 'Divides the slide into two equal side-by-side content columns.',
  },
  dateEvent: {
    label: 'Date Event',
    description: 'Highlights a date-based event or milestone with a prominent date display.',
  },
  imageWithCaption: {
    label: 'Image with Caption',
    description: 'Displays a full-bleed image with an optional caption below.',
  },
  leftFeature: {
    label: 'Left Feature',
    description: 'Image on the left, title and body text stacked on the right.',
  },
  rightFeature: {
    label: 'Right Feature',
    description: 'Image on the right, title and body text stacked on the left.',
  },
  map: {
    label: 'Map',
    description: 'Embeds an interactive map centered on a geographic location.',
  },
  fullBleedQuote: {
    label: 'Full Bleed Quote',
    description: 'A full-width quote that spans the entire slide for maximum impact.',
  },
  list: {
    label: 'List',
    description: 'Renders a bulleted or numbered list in a clean, card-style layout.',
  },
  photoGrid: {
    label: 'Photo Grid',
    description: 'Arranges multiple photos in a 2×2 or 3×3 mosaic grid.',
  },
  definitionCard: {
    label: 'Definition Card',
    description: 'Shows a term and its definition in a structured, dictionary-style card.',
  },
  comparisonBar: {
    label: 'Comparison Bar',
    description: 'Visualizes two or more values side-by-side with labeled horizontal bars.',
  },
  pullQuote: {
    label: 'Pull Quote',
    description: 'A stylized pull quote with large decorative marks and centered text.',
  },
  videoWithCaption: {
    label: 'Video with Caption',
    description: 'Embeds a video player with an optional caption below.',
  },
  videoPullQuote: {
    label: 'Video Pull Quote',
    description: 'Combines a video panel with a highlighted pull quote side-by-side.',
  },
  dataTable: {
    label: 'Data Table',
    description: 'Renders tabular data in a clean, styled table with a header row.',
  },
  diagram: {
    label: 'Diagram',
    description:
      'Renders sub-headings as connected nodes — edit visually as a node-and-edge diagram.',
  },
  layout: {
    label: 'Layout',
    description:
      "Free-form 2D canvas — drag layers into place. Use for one-off block layouts that don't fit a template.",
  },
  drawing: {
    label: 'Drawing',
    description: 'Free-form sketches — draw shapes, paths, and text directly on a 2D surface.',
  },
};
