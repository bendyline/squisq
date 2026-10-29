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
    description: 'A clean section break with a prominent title and optional background image.',
  },
  bigText: {
    label: 'Big Text',
    description:
      'Gigantic uppercase display text — thumbnail-style — on a theme surface or over an image with a contrast bloom.',
  },
  transcript: {
    label: 'Transcript',
    description:
      'A conversational beat: speaker avatar and message bubble, with thought, tool, and two-speaker handoff variants.',
  },
  content: {
    label: 'Content',
    description: 'Shows a heading and the complete body in a loss-averse content-first layout.',
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
  topFeature: {
    label: 'Top Feature',
    description: 'Image or video across the full width at the top, title and body text below.',
  },
  bottomFeature: {
    label: 'Bottom Feature',
    description: 'Title and body text at the top, image or video across the full width below.',
  },
  mediaOnly: {
    label: 'Media Only',
    description: 'The image or video fills the slide, with no title, text or caption.',
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
    description: 'Arranges up to four photos in a mosaic grid.',
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
    description: 'A highlighted pull quote over a full-bleed background video.',
  },
  dataTable: {
    label: 'Data Table',
    description: 'Renders tabular data in a clean, styled table with a header row.',
  },
  barChart: {
    label: 'Bar Chart',
    description: "Horizontal bars from the block's markdown table — one bar per row.",
  },
  columnChart: {
    label: 'Column Chart',
    description: "Vertical columns from the block's markdown table — one column per row.",
  },
  pieChart: {
    label: 'Pie Chart',
    description: "A pie of the block's markdown table — each row becomes a labeled slice.",
  },
  donutChart: {
    label: 'Donut Chart',
    description: "A donut of the block's markdown table — each row becomes a labeled slice.",
  },
  lineChart: {
    label: 'Line Chart',
    description: "Lines from the block's markdown table — one line per value column.",
  },
  areaChart: {
    label: 'Area Chart',
    description: "Filled area lines from the block's markdown table — one area per value column.",
  },
  scatterChart: {
    label: 'Scatter Chart',
    description: "An x/y scatter plot from the block's markdown table's numeric columns.",
  },
  diagram: {
    label: 'Diagram',
    description:
      'Draws a box-and-line diagram fence as connected nodes — edit it visually on a canvas.',
  },
  tree: {
    label: 'Tree',
    description:
      'Renders an ASCII file-tree / outline fence as a filesystem-style treeview — edit as an outline.',
  },
  timeline: {
    label: 'Timeline',
    description:
      'Plots events across one or more horizontal tracks with callouts and optional branching links.',
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
