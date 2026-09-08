/**
 * Content library for the swatch harness.
 *
 * A swatch is one built-in block template × one built-in theme × one
 * "content variant" — a realistic Markdown body an author might type under
 * a `{[template]}` heading. The matrix exists so a reviewer can scan for
 * places where authored content stops looking right (overflow, overlap,
 * clipped tables, silently dropped body text) in a particular theme.
 *
 * Everything here is plain data; `buildSwatchMarkdown` assembles the
 * document that the harness feeds through the real parser, so what is
 * captured is exactly what the player, exports and host apps render.
 */

/** Structural features a variant body carries — the applicability signal. */
export type ContentFeature =
  | 'text'
  | 'long'
  | 'list'
  | 'nested'
  | 'table'
  | 'numeric-table'
  | 'blockquote'
  | 'code'
  | 'image'
  | 'mermaid'
  | 'long-title'
  | 'intl'
  | 'tree-fence'
  | 'diagram-fence'
  | 'timeline-fence';

export interface ContentVariant {
  id: string;
  label: string;
  description: string;
  /** Markdown body placed under the block heading (may be empty). */
  body: string;
  features: readonly ContentFeature[];
  /** Replaces the template seed's heading when set (title-length stress). */
  heading?: string;
  /** Restrict the variant to these template ids (structural fences). */
  onlyFor?: readonly string[];
}

/** How much of the authored body a template is designed to show. */
export type BodyExpectation = 'full' | 'partial' | 'none';

export interface TemplateSeed {
  /** Heading text that suits the template's primary slot. */
  heading: string;
  /** `{[template key=value]}` params required for the template to render. */
  params?: Readonly<Record<string, string>>;
  /** Markdown inserted before the variant body (media prerequisites). */
  mediaPrefix?: string;
  /** Sub-heading children appended after the body (layout/drawing/diagram). */
  children?: (variant: ContentVariant) => string | undefined;
  /**
   * Features the template needs to render its primary content from the body.
   * A variant with none of them yields the fallback card, so it is reported
   * as "inapplicable" and skipped unless `--all-variants` is passed.
   */
  needsAny?: readonly ContentFeature[];
  bodyExpectation: BodyExpectation;
  /** Explicit variant whitelist for templates that ignore body prose. */
  variants?: readonly string[];
}

export const ASSET_BASE = '/swatch-assets';

const HERO = `${ASSET_BASE}/hero.svg`;
const DETAIL = `${ASSET_BASE}/detail.svg`;
const GRID = ['grid-a', 'grid-b', 'grid-c', 'grid-d'].map((n) => `${ASSET_BASE}/${n}.svg`);
const MAP = `${ASSET_BASE}/map.svg`;
const POSTER = `${ASSET_BASE}/poster.svg`;
const CLIP = `${ASSET_BASE}/clip.mp4`;

const P_SHORT =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';

const P_MEDIUM =
  'The waterfront redesign replaced a four-lane arterial with a shared promenade, a protected cycle track, and a tidal garden that floods twice a day. Early counts show weekend foot traffic more than doubling, while vehicle throughput on the parallel bypass held steady. Merchants along the promenade report longer dwell times, and the harbor authority has already extended ferry hours to match the new evening crowds.';

const P_LONG_A =
  'When the harbor authority first proposed closing the arterial, the loudest objection was congestion: four lanes of traffic had to go somewhere, and the bypass was already busy at the evening peak. The counts told a different story. Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre. The bypass gained about two hundred vehicles an hour, well inside its capacity, and average speeds there did not change in a measurable way.';

const P_LONG_B =
  'What changed most was how long people stayed. Before the redesign the median visit to the promenade lasted fourteen minutes; afterwards it stretched to thirty-one, and the evening ferry — once nearly empty after nine — now runs full on Fridays and Saturdays. The tidal garden survived its first storm season with minor planting losses, the merchants voted to extend their hours, and the authority is now drafting the same treatment for the fishing quay on the north shore.';

const BULLETS_5 = [
  'Weekend foot traffic doubled within the first month',
  'Vehicle throughput on the bypass held steady at 1,900 per hour',
  'Median dwell time rose from 14 to 31 minutes',
  'Ferry service extended to 11 pm on Fridays and Saturdays',
  'The tidal garden survived its first storm season',
];

const BULLETS_10 = [
  ...BULLETS_5,
  'Roughly a third of arterial trips disappeared rather than diverting, absorbed by the ferry, the cycle track, and people walking the last kilometre',
  'Merchants voted to extend evening hours after dwell times more than doubled',
  'Noise at the promenade edge fell from 71 dB to 58 dB at the evening peak',
  'Cycle counts on the protected track average 2,400 per weekday and 3,900 on weekends',
  'The north-shore fishing quay is next: the authority is drafting the same shared-surface treatment for a 2027 start',
];

const NUMBERED_NESTED = `1. Survey the existing arterial
   - Count vehicles and pedestrians at six points
   - Map utilities, drainage, and the tidal range
2. Design the promenade
   - Shared surface with tactile edges
   - Protected cycle track on the harbor side
3. Phase the construction
   - Close one lane at a time
   - Keep ferry access open throughout
4. Measure the outcome against the baseline`;

const TABLE_NUMERIC = `| Quarter | Visitors (k) | Revenue ($k) |
| ------- | -----------: | -----------: |
| Q1      |          124 |           38 |
| Q2      |          189 |           55 |
| Q3      |          263 |           62 |
| Q4      |          217 |           48 |`;

const TABLE_WIDE = `| Segment | Before | After | Change | Owner | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Promenade west | 1,200 | 2,900 | +142% | Harbor authority | Complete | Shared surface with tactile edges |
| Promenade east | 980 | 2,100 | +114% | Harbor authority | Complete | Tidal garden floods twice daily |
| Cycle track | 0 | 3,900 | new | City transport | Complete | Protected on the harbor side |
| Bypass | 1,700 | 1,900 | +12% | State roads | Monitoring | Within design capacity |
| Ferry (evening) | 140 | 610 | +336% | Ferry operator | Extended | Runs to 11 pm on weekends |
| Fishing quay | 300 | 300 | 0% | Harbor authority | Planned | Same treatment proposed for 2027 |
| Merchant hours | 18:00 | 21:00 | +3 h | Merchants' association | Adopted | Voted after dwell times doubled |
| Noise (peak) | 71 dB | 58 dB | −13 dB | Environmental office | Complete | Measured at the promenade edge |`;

const QUOTE = `> The best public space feels obvious after the city has already moved on.
>
> — Harbor Authority design notes, 2026`;

const CODE =
  '```ts\n' +
  `export function dwellTime(visits: Visit[]): number {
  const durations = visits
    .filter((visit) => visit.zone === 'promenade')
    .map((visit) => visit.leftAt - visit.arrivedAt)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 0;
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 === 0
    ? (durations[middle - 1] + durations[middle]) / 2
    : durations[middle];
}` +
  '\n```';

const MERMAID =
  '```mermaid\nflowchart LR\n  A[Survey] --> B[Design]\n  B --> C[Build]\n  C --> D[Measure]\n```';

const TREE_FENCE =
  '```tree\n' +
  `harbor-study/
├── data/
│   ├── counts.csv
│   ├── tides.parquet
│   └── noise/
│       └── peak-2026.csv
├── notes/
│   ├── merchants.md
│   └── ferry.md
└── report.md` +
  '\n```';

const DIAGRAM_FENCE =
  '```diagram\n' +
  `┌─────────┐     ┌───────────┐     ┌──────────┐     ┌───────────┐
│ Survey  │ ──> │  Design   │ ──> │  Build   │ ──> │  Measure  │
└─────────┘     └───────────┘     └──────────┘     └───────────┘` +
  '\n```';

const TIMELINE_FENCE =
  '```timeline\n' +
  `Design: ● Survey {#survey} ──────────● Concept {#concept} ──────────● Detail {#detail} ──────────►
Build:  ● Phase 1 {#p1} ──────────● Phase 2 {#p2} ──────────● Opening {#open} ──────────►
branch: concept -> p1 : handoff` +
  '\n```';

const RICH_INLINE =
  '**Bold claims** need *careful* evidence: the `count_peds()` script logged 2× weekend traffic — see [the full report](https://example.org/harbor/2026/field-report.pdf) ✅ and the ferry log ⏰ (11 pm on Fridays). Naïve façade résumé 🚢 H<sub>2</sub>O and E = mc<sup>2</sup>. Unbreakable token: https://example.org/harbor/2026/field-report-final-revision-with-appendices-and-photographs.pdf';

const INTL =
  '港の再設計は六月に一般公開され、週末の歩行者数は一か月で倍増した。 أعيد تصميم الواجهة البحرية وافتُتحت للجمهور في يونيو، وتضاعفت حركة المشاة في عطلة نهاية الأسبوع خلال شهر. Η ανάπλαση της προκυμαίας άνοιξε τον Ιούνιο. Die Neugestaltung der Uferpromenade wurde im Juni eröffnet — Fußgängerverkehr verdoppelte sich. Việc tái thiết kế bờ sông đã mở cửa vào tháng Sáu 🚢⛴️🌊.';

const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export const CONTENT_VARIANTS: readonly ContentVariant[] = [
  {
    id: 'empty',
    label: 'Heading only',
    description: 'No body at all — the template must stand on its heading and params.',
    body: '',
    features: [],
  },
  {
    id: 'short',
    label: 'Short paragraph',
    description: 'One sentence of body text.',
    body: P_SHORT,
    features: ['text'],
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    description: 'A single medium paragraph (~65 words).',
    body: P_MEDIUM,
    features: ['text'],
  },
  {
    id: 'long',
    label: 'Long prose',
    description: 'Two long paragraphs (~180 words) — overflow stress for prose slots.',
    body: `${P_LONG_A}\n\n${P_LONG_B}`,
    features: ['text', 'long'],
  },
  {
    id: 'bullets',
    label: 'Bullet list',
    description: 'Five medium-length bullets.',
    body: bullets(BULLETS_5),
    features: ['list'],
  },
  {
    id: 'bullets-many',
    label: 'Many bullets',
    description: 'Ten bullets, several of them long — vertical overflow stress.',
    body: bullets(BULLETS_10),
    features: ['list', 'long'],
  },
  {
    id: 'numbered-nested',
    label: 'Nested numbered list',
    description: 'An ordered list with nested sub-bullets.',
    body: NUMBERED_NESTED,
    features: ['list', 'nested'],
  },
  {
    id: 'table',
    label: 'Numeric table',
    description: 'A compact 3×4 table with numeric columns (chart-friendly).',
    body: TABLE_NUMERIC,
    features: ['table', 'numeric-table'],
  },
  {
    id: 'table-wide',
    label: 'Wide table',
    description: 'Seven text-heavy columns × eight rows — horizontal overflow stress.',
    body: TABLE_WIDE,
    features: ['table', 'long'],
  },
  {
    id: 'quote',
    label: 'Block quote',
    description: 'A blockquote with an attribution line.',
    body: QUOTE,
    features: ['text', 'blockquote'],
  },
  {
    id: 'code',
    label: 'Code fence',
    description: 'A twelve-line TypeScript fence.',
    body: CODE,
    features: ['code'],
  },
  {
    id: 'image',
    label: 'Image + paragraph',
    description: 'An image followed by a paragraph — exercises rich-content layers.',
    body: `![Harbor study at dusk](${HERO})\n\n${P_SHORT}`,
    features: ['image', 'text'],
  },
  {
    id: 'mixed',
    label: 'Mixed body',
    description: 'Paragraph, three bullets, then a table — what a real section looks like.',
    body: `${P_SHORT}\n\n${bullets(BULLETS_5.slice(0, 3))}\n\n${TABLE_NUMERIC}`,
    features: ['text', 'list', 'table', 'numeric-table'],
  },
  {
    id: 'rich-inline',
    label: 'Rich inline',
    description: 'Bold, italic, code, links, emoji, sub/superscript and an unbreakable URL.',
    body: RICH_INLINE,
    features: ['text'],
  },
  {
    id: 'long-title',
    label: 'Long title',
    description: 'A sixteen-word heading over a short paragraph — title wrap stress.',
    body: P_SHORT,
    heading: LONG_TITLE,
    features: ['text', 'long-title'],
  },
  {
    id: 'intl',
    label: 'International text',
    description:
      'Japanese, Arabic (RTL), Greek, German and Vietnamese with emoji — font fallback stress.',
    body: INTL,
    features: ['text', 'intl'],
  },
  {
    id: 'mermaid',
    label: 'Mermaid fence',
    description: 'A mermaid flowchart fence — the async rich-content path.',
    body: MERMAID,
    features: ['mermaid'],
  },
  {
    id: 'tree-fence',
    label: 'Tree fence',
    description: 'An ASCII file tree fence.',
    body: TREE_FENCE,
    features: ['tree-fence'],
    onlyFor: ['tree'],
  },
  {
    id: 'diagram-fence',
    label: 'Diagram fence',
    description: 'A four-box ASCII flow fence.',
    body: DIAGRAM_FENCE,
    features: ['diagram-fence'],
    onlyFor: ['diagram'],
  },
  {
    id: 'timeline-fence',
    label: 'Timeline fence',
    description: 'A two-track ASCII timeline fence with a branch link.',
    body: TIMELINE_FENCE,
    features: ['timeline-fence'],
    onlyFor: ['timeline'],
  },
];

/** Variants worth capturing for templates that never render body prose. */
const PROSE_BLIND_VARIANTS = ['empty', 'paragraph', 'image', 'long-title', 'mermaid'] as const;

const CHART_SEED: TemplateSeed = {
  heading: 'Quarterly Visitors and Revenue',
  needsAny: ['table'],
  bodyExpectation: 'partial',
};

const FEATURE_SEED = (heading: string): TemplateSeed => ({
  heading,
  mediaPrefix: `![Field notes](${DETAIL})`,
  bodyExpectation: 'full',
});

export const TEMPLATE_SEEDS: Readonly<Record<string, TemplateSeed>> = {
  title: {
    heading: 'Designing Better Blocks',
    params: { subtitle: 'A compact visual audit across every built-in theme' },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  sectionHeader: {
    heading: 'Signals Worth Keeping',
    params: { colorScheme: 'blue' },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  bigText: {
    heading: 'Make it obvious',
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  transcript: {
    heading: 'Beat 3',
    params: { speaker: 'Ada Lovelace', meta: '00:12' },
    bodyExpectation: 'full',
  },
  content: {
    heading: 'Field Notes',
    bodyExpectation: 'full',
  },
  statHighlight: {
    heading: '73%',
    params: { colorScheme: 'green' },
    bodyExpectation: 'partial',
  },
  quote: {
    heading: 'On Public Space',
    params: { attribution: 'Harbor Authority design notes' },
    bodyExpectation: 'full',
  },
  factCard: {
    heading: 'Reusable blocks make drift visible',
    bodyExpectation: 'full',
  },
  twoColumn: {
    heading: 'Two Approaches',
    params: {
      left: 'Manual review|Slow, thoughtful, high context',
      right: 'Visual sweep|Fast, repeatable, broad coverage',
      leftColor: 'blue',
      rightColor: 'green',
    },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  dateEvent: {
    heading: 'July 14, 2026',
    params: { footer: 'Generated locally from built-in themes', mood: 'celebratory' },
    bodyExpectation: 'full',
  },
  imageWithCaption: {
    heading: 'A harbor study at dusk',
    mediaPrefix: `![Harbor study](${HERO})`,
    params: { captionPosition: 'bottom', imageCredit: 'Generated fixture' },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  leftFeature: FEATURE_SEED('Image-led explanation'),
  rightFeature: FEATURE_SEED('Text-led comparison'),
  map: {
    heading: 'San Francisco Bay',
    params: {
      center: '37.7749,-122.4194',
      zoom: '11',
      mapStyle: 'terrain',
      staticSrc: MAP,
      caption: 'Static map fixture with overlay title and caption.',
    },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  fullBleedQuote: {
    heading: 'Make the oddities visible',
    params: { colorScheme: 'purple' },
    bodyExpectation: 'full',
  },
  list: {
    heading: 'What to Inspect',
    params: { colorScheme: 'blue' },
    needsAny: ['list'],
    bodyExpectation: 'full',
  },
  photoGrid: {
    heading: 'A four-image grid stresses gutters and crops',
    mediaPrefix: GRID.map((src, i) => `![Grid image ${i + 1}](${src})`).join('\n'),
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  definitionCard: {
    heading: 'Gezellig',
    params: { origin: 'Dutch, 18th century', colorScheme: 'green' },
    bodyExpectation: 'full',
  },
  comparisonBar: {
    heading: 'Before and After',
    params: {
      leftLabel: 'Before review',
      leftValue: '38',
      rightLabel: 'After review',
      rightValue: '84',
      unit: 'clarity score',
      colorScheme: 'orange',
    },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  pullQuote: {
    heading: 'Pull Quote',
    params: { attribution: 'Template review' },
    bodyExpectation: 'full',
  },
  videoWithCaption: {
    heading: 'Video templates use a generated poster',
    mediaPrefix: `<video src="${CLIP}" poster="${POSTER}" aria-label="Generated video poster"></video>`,
    params: { captionPosition: 'bottom', videoCredit: 'Generated fixture' },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
  },
  videoPullQuote: {
    heading: 'Motion-backed templates still need a strong still frame',
    mediaPrefix: `<video src="${CLIP}" poster="${POSTER}" aria-label="Generated video poster"></video>`,
    params: { attribution: 'Video QA fixture' },
    bodyExpectation: 'partial',
  },
  dataTable: {
    heading: 'Theme Sweep Results',
    params: { colorScheme: 'blue' },
    needsAny: ['table'],
    bodyExpectation: 'partial',
  },
  barChart: CHART_SEED,
  columnChart: CHART_SEED,
  pieChart: CHART_SEED,
  donutChart: CHART_SEED,
  lineChart: CHART_SEED,
  areaChart: CHART_SEED,
  scatterChart: CHART_SEED,
  diagram: {
    heading: 'Review Flow',
    params: { colorScheme: 'blue' },
    bodyExpectation: 'none',
    variants: [...PROSE_BLIND_VARIANTS, 'diagram-fence'],
    children: (variant) =>
      variant.id === 'diagram-fence'
        ? undefined
        : [
            '### Capture {#sw-capture connectsTo=sw-compare}',
            '### Compare {#sw-compare connectsTo=sw-adjust}',
            '### Adjust {#sw-adjust}',
          ].join('\n\n'),
  },
  tree: {
    heading: 'Package Layout',
    params: { colorScheme: 'blue' },
    needsAny: ['list', 'tree-fence'],
    bodyExpectation: 'partial',
  },
  timeline: {
    heading: 'Release Timeline',
    params: { colorScheme: 'blue' },
    needsAny: ['timeline-fence'],
    bodyExpectation: 'partial',
  },
  layout: {
    heading: 'Free-form layout',
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
    children: () =>
      [
        '### Headline {[text x=120 y=120 width=900 height=180 fontSize=64]}',
        '',
        'Weekend foot traffic doubled.',
        '',
        '### Panel {[rect x=1100 y=120 width=660 height=360 fill=#0f766e]}',
        '',
        `### Photo {[image x=1100 y=520 width=660 height=420 src=${DETAIL}]}`,
        '',
        '### Caption {[text x=120 y=360 width=900 height=400]}',
        '',
        P_MEDIUM,
      ].join('\n'),
  },
  drawing: {
    heading: 'Shapes',
    params: { colorScheme: 'blue' },
    bodyExpectation: 'none',
    variants: PROSE_BLIND_VARIANTS,
    children: () =>
      [
        '### Survey {#sw-survey connectsTo=sw-design} {[rect x=0 y=0 width=240 height=120]}',
        '### Design {#sw-design connectsTo=sw-build} {[circle x=360 y=0 width=140 height=140]}',
        '### Build {#sw-build} {[rect x=640 y=10 width=240 height=120]}',
      ].join('\n\n'),
  },
};

/** Whether a variant exercises a template's primary slot (else: expected fallback). */
export function variantApplies(templateId: string, variant: ContentVariant): boolean {
  if (variant.onlyFor && !variant.onlyFor.includes(templateId)) return false;
  const seed = TEMPLATE_SEEDS[templateId];
  if (!seed) return !variant.onlyFor;
  if (seed.variants && !seed.variants.includes(variant.id)) return false;
  if (seed.needsAny && !seed.needsAny.some((f) => variant.features.includes(f))) return false;
  return true;
}

function formatParams(params: Readonly<Record<string, string>> | undefined): string {
  if (!params) return '';
  return Object.entries(params)
    .map(([key, value]) => (/[\s"|]/.test(value) ? `${key}="${value}"` : `${key}=${value}`))
    .join(' ');
}

export interface SwatchMarkdown {
  markdown: string;
  heading: string;
  /** Plain body prose the template could be expected to show (variant body only). */
  bodyText: string;
}

/** Compose the single-block Markdown document for one template × variant. */
export function buildSwatchMarkdown(templateId: string, variant: ContentVariant): SwatchMarkdown {
  const seed: TemplateSeed = TEMPLATE_SEEDS[templateId] ?? {
    heading: 'Untitled block',
    bodyExpectation: 'partial',
  };
  const heading = variant.heading ?? seed.heading;
  const params = formatParams(seed.params);
  const annotation = params ? `{[${templateId} ${params}]}` : `{[${templateId}]}`;
  const parts = [`## ${heading} ${annotation}`];
  if (seed.mediaPrefix) parts.push(seed.mediaPrefix);
  if (variant.body) parts.push(variant.body);
  const children = seed.children?.(variant);
  if (children) parts.push(children);
  return {
    markdown: `${parts.join('\n\n')}\n`,
    heading,
    bodyText: variant.body,
  };
}
