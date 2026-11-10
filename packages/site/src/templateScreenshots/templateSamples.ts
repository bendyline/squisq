import type { Block, TemplateBlock } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';

export interface TemplateScreenshotFixture {
  /** `contents` is the block's Markdown body, for templates that render it whole. */
  block: TemplateBlock & { children?: Block[]; contents?: MarkdownBlockNode[] };
}

function imageDataUrl(label: string, from: string, to: string): string {
  // The label is centered so templates that cover-crop the image (feature
  // halves, accent strips, full-bleed poster frames) never slice through
  // the text — a clipped label reads as a template bug during review.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${from}"/>
        <stop offset="1" stop-color="${to}"/>
      </linearGradient>
      <pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
        <rect width="96" height="96" fill="none"/>
        <path d="M0 48 H96" stroke="rgba(255,255,255,0.16)" stroke-width="10"/>
      </pattern>
    </defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <rect width="1200" height="800" fill="url(#p)"/>
    <circle cx="930" cy="210" r="190" fill="rgba(255,255,255,0.18)"/>
    <circle cx="230" cy="620" r="260" fill="rgba(0,0,0,0.12)"/>
    <text x="600" y="400" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="48" font-weight="700" letter-spacing="6" fill="rgba(255,255,255,0.5)">${label.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const HERO_IMAGE = imageDataUrl('Harbor Study', '#0f766e', '#f97316');
const DETAIL_IMAGE = imageDataUrl('Field Notes', '#4f46e5', '#22c55e');
const GRID_IMAGE_A = imageDataUrl('Workshop', '#dc2626', '#facc15');
const GRID_IMAGE_B = imageDataUrl('Prototype', '#2563eb', '#14b8a6');
const GRID_IMAGE_C = imageDataUrl('Review', '#7c3aed', '#f472b6');
const GRID_IMAGE_D = imageDataUrl('Launch', '#334155', '#fb923c');
const MAP_IMAGE = imageDataUrl('Static Map', '#1d4ed8', '#86efac');
const POSTER_IMAGE = imageDataUrl('Video Poster', '#111827', '#0891b2');
const VIDEO_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';

function paragraph(text: string): MarkdownBlockNode {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: text }],
  };
}

function childBlock(input: {
  id: string;
  title: string;
  x?: number;
  y?: number;
  template?: string;
  templateOverrides?: Record<string, string>;
  contents?: MarkdownBlockNode[];
  connectsTo?: Block['connectsTo'];
}): Block {
  return {
    id: input.id,
    title: input.title,
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    ...(input.x != null ? { x: input.x } : {}),
    ...(input.y != null ? { y: input.y } : {}),
    ...(input.template ? { template: input.template } : {}),
    ...(input.templateOverrides ? { templateOverrides: input.templateOverrides } : {}),
    ...(input.contents ? { contents: input.contents } : {}),
    ...(input.connectsTo ? { connectsTo: input.connectsTo } : {}),
  };
}

function imageParagraph(src: string, alt: string): MarkdownBlockNode {
  return { type: 'paragraph', children: [{ type: 'image', url: src, alt }] };
}

const BODY_TEXT =
  'The waterfront redesign replaced a four-lane arterial with a shared promenade, a protected cycle track, and a tidal garden that floods twice a day.';

const CHART_HEADERS = ['Quarter', 'Visitors (k)', 'Revenue ($k)'];
const CHART_ROWS = [
  ['Q1', '124', '38'],
  ['Q2', '189', '55'],
  ['Q3', '263', '62'],
  ['Q4', '217', '48'],
];

const TEMPLATE_SCREENSHOT_FIXTURES_INTERNAL = {
  title: {
    block: {
      id: 'sample-title',
      template: 'title',
      duration: 6,
      audioSegment: 0,
      title: 'Designing Better Blocks',
      subtitle: 'A compact visual audit across every built-in theme',
    },
  },
  sectionHeader: {
    block: {
      id: 'sample-section-header',
      template: 'sectionHeader',
      duration: 6,
      audioSegment: 0,
      title: 'Signals Worth Keeping',
      colorScheme: 'blue',
      imageSrc: HERO_IMAGE,
      imageAlt: 'Abstract harbor gradient',
    },
  },
  statHighlight: {
    block: {
      id: 'sample-stat-highlight',
      template: 'statHighlight',
      duration: 6,
      audioSegment: 0,
      stat: '73%',
      description: 'of readers noticed the visual hierarchy first',
      detail: 'Sample content intentionally mixes numbers, labels, and a detail line.',
      colorScheme: 'green',
      accentImage: {
        src: DETAIL_IMAGE,
        alt: 'Abstract field note image',
        position: 'right-strip',
      },
    },
  },
  quote: {
    block: {
      id: 'sample-quote',
      template: 'quote',
      duration: 6,
      audioSegment: 0,
      quote: 'The best template feels obvious after the story has already moved on.',
      attribution: 'Squisq design notes',
      accentImage: {
        src: DETAIL_IMAGE,
        alt: 'Abstract design note image',
        position: 'corner-inset',
      },
    },
  },
  factCard: {
    block: {
      id: 'sample-fact-card',
      template: 'factCard',
      duration: 6,
      audioSegment: 0,
      fact: 'Reusable blocks make drift visible.',
      explanation:
        'A consistent visual sweep helps catch contrast, spacing, overflow, and tone issues before they become user-facing.',
      source: 'Visual QA fixture',
      accentImage: {
        src: HERO_IMAGE,
        alt: 'Abstract fixture image',
        position: 'bottom-strip',
      },
    },
  },
  twoColumn: {
    block: {
      id: 'sample-two-column',
      template: 'twoColumn',
      duration: 6,
      audioSegment: 0,
      header: 'Two Approaches',
      left: {
        label: 'Manual Review',
        sublabel: 'Slow, thoughtful, high context',
      },
      right: {
        label: 'Visual Sweep',
        sublabel: 'Fast, repeatable, broad coverage',
      },
      leftColor: 'blue',
      rightColor: 'green',
    },
  },
  dateEvent: {
    block: {
      id: 'sample-date-event',
      template: 'dateEvent',
      duration: 6,
      audioSegment: 0,
      date: 'July 2026',
      description: 'Template screenshots become a regular part of design QA.',
      footer: 'Generated locally from built-in themes',
      mood: 'celebratory',
      accentImage: {
        src: DETAIL_IMAGE,
        alt: 'Abstract milestone image',
        position: 'left-strip',
      },
    },
  },
  imageWithCaption: {
    block: {
      id: 'sample-image-with-caption',
      template: 'imageWithCaption',
      duration: 6,
      audioSegment: 0,
      imageSrc: HERO_IMAGE,
      imageAlt: 'Abstract harbor study',
      caption: 'A full-bleed image should still leave room for a readable caption.',
      captionPosition: 'bottom',
      imageCredit: 'Generated fixture',
    },
  },
  leftFeature: {
    block: {
      id: 'sample-left-feature',
      template: 'leftFeature',
      duration: 6,
      audioSegment: 0,
      imageSrc: DETAIL_IMAGE,
      imageAlt: 'Abstract feature image',
      title: 'Image-led explanation',
      body: 'Feature blocks should balance editorial imagery with practical body copy.',
    },
  },
  rightFeature: {
    block: {
      id: 'sample-right-feature',
      template: 'rightFeature',
      duration: 6,
      audioSegment: 0,
      imageSrc: DETAIL_IMAGE,
      imageAlt: 'Abstract feature image',
      title: 'Text-led comparison',
      body: 'Mirrored layouts make alignment, padding, and title scale issues easier to spot.',
    },
  },
  map: {
    block: {
      id: 'sample-map',
      template: 'map',
      duration: 6,
      audioSegment: 0,
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 11,
      mapStyle: 'terrain',
      title: 'San Francisco Bay',
      caption: 'Static map fixture with overlay title and caption.',
      staticSrc: MAP_IMAGE,
      markers: [
        {
          lat: 37.7749,
          lng: -122.4194,
          label: 'Center',
        },
      ],
    },
  },
  fullBleedQuote: {
    block: {
      id: 'sample-full-bleed-quote',
      template: 'fullBleedQuote',
      duration: 6,
      audioSegment: 0,
      text: 'Make the oddities visible.',
      colorScheme: 'purple',
    },
  },
  list: {
    block: {
      id: 'sample-list',
      template: 'list',
      duration: 6,
      audioSegment: 0,
      title: 'What to Inspect',
      items: ['Contrast', 'Spacing', 'Line breaks', 'Image balance'],
      colorScheme: 'blue',
      accentImage: {
        src: DETAIL_IMAGE,
        alt: 'Abstract checklist image',
        position: 'corner-inset',
      },
    },
  },
  cards: {
    block: {
      id: 'sample-cards',
      template: 'cards',
      duration: 6,
      audioSegment: 0,
      title: 'Why the Waterfront Works',
      items: [
        'Promenade: a shared surface from the ferry to the market',
        'Cycle track: protected, on the harbor side',
        'Tidal garden: floods twice a day and drains itself',
      ],
    },
  },
  process: {
    block: {
      id: 'sample-process',
      template: 'process',
      duration: 6,
      audioSegment: 0,
      title: 'How the Redesign Rolled Out',
      items: [
        'Survey: count trips at six points',
        'Design: a shared surface with tactile edges',
        'Build: one lane at a time',
        'Measure: against the baseline',
      ],
    },
  },
  cycle: {
    block: {
      id: 'sample-cycle',
      template: 'cycle',
      duration: 6,
      audioSegment: 0,
      title: 'A Day in the Tidal Garden',
      items: [
        'Flood: the tide fills the lower beds',
        'Settle: silt drops out of the still water',
        'Drain: the ebb carries the water back',
        'Dry: the beds air until the next tide',
      ],
    },
  },
  layers: {
    block: {
      id: 'sample-layers',
      template: 'layers',
      duration: 6,
      audioSegment: 0,
      title: 'Inside the Sea Wall',
      items: [
        'Core: compacted clay that keeps the water out',
        'Filter: gravel that lets the wall drain',
        'Armor: stone that takes the waves',
      ],
    },
  },
  stats: {
    block: {
      id: 'sample-stats',
      template: 'stats',
      duration: 6,
      audioSegment: 0,
      title: 'The Waterfront in Numbers',
      items: [
        '2×: weekend foot traffic within a month',
        '31 minutes: median dwell time, up from 14',
        '2,400: cycle trips on an average weekday',
      ],
    },
  },
  pyramid: {
    block: {
      id: 'sample-pyramid',
      template: 'pyramid',
      duration: 6,
      audioSegment: 0,
      title: 'What the Plan Rests On',
      items: [
        'Vision: a harbor people walk to',
        'Strategy: give the edge back to people',
        'Projects: promenade, cycle track, garden',
        'Upkeep: the daily work that keeps it open',
      ],
    },
  },
  funnel: {
    block: {
      id: 'sample-funnel',
      template: 'funnel',
      duration: 6,
      audioSegment: 0,
      title: 'From Visitors to Regulars',
      items: [
        '10,000 visitors: walk the promenade each weekend',
        '2,400 stop: at a stall or a café',
        '600 return: within the month',
        '150 regulars: come every week',
      ],
    },
  },
  hub: {
    block: {
      id: 'sample-hub',
      template: 'hub',
      duration: 6,
      audioSegment: 0,
      title: 'What Draws People In',
      items: [
        'Promenade: room to walk side by side',
        'Market: stalls open into the evening',
        'Ferry: runs to 11 pm on weekends',
        'Garden: a tide to watch come in',
      ],
      center: 'The waterfront',
    },
  },
  venn: {
    block: {
      id: 'sample-venn',
      template: 'venn',
      duration: 6,
      audioSegment: 0,
      title: 'Promenade and Bypass',
      items: [
        'Promenade: walking, cycling and the evening market',
        'Bypass: through traffic at 1,900 vehicles an hour',
        'Both: carry the harbor’s trips without the old arterial',
      ],
    },
  },
  matrix: {
    block: {
      id: 'sample-matrix',
      template: 'matrix',
      duration: 6,
      audioSegment: 0,
      title: 'Where to Invest Next',
      items: [
        'Fishing quay: big gain, long build',
        'Evening ferry: big gain, quick to start',
        'New signage: small gain, slow to agree',
        'More benches: small gain, quick to do',
      ],
      xAxis: 'Speed',
      yAxis: 'Impact',
    },
  },
  bigText: {
    block: {
      id: 'sample-bigText',
      template: 'bigText',
      duration: 6,
      audioSegment: 0,
      title: 'Make it obvious',
    },
  },
  transcript: {
    block: {
      id: 'sample-transcript',
      template: 'transcript',
      duration: 6,
      audioSegment: 0,
      speaker: 'Ada Lovelace',
      text: 'The promenade changed how the whole harbor moves. People stay, and the traffic found another way.',
      meta: '00:12',
    },
  },
  content: {
    block: {
      id: 'sample-content',
      template: 'content',
      duration: 6,
      audioSegment: 0,
      title: 'Field Notes',
      contents: [paragraph(BODY_TEXT)],
    },
  },
  topFeature: {
    block: {
      id: 'sample-topFeature',
      template: 'topFeature',
      duration: 6,
      audioSegment: 0,
      title: 'The picture leads, the notes follow',
      contents: [imageParagraph(HERO_IMAGE, 'Harbor study'), paragraph(BODY_TEXT)],
    },
  },
  bottomFeature: {
    block: {
      id: 'sample-bottomFeature',
      template: 'bottomFeature',
      duration: 6,
      audioSegment: 0,
      title: 'The notes lead, the picture follows',
      contents: [paragraph(BODY_TEXT), imageParagraph(DETAIL_IMAGE, 'Field notes')],
    },
  },
  mediaOnly: {
    block: {
      id: 'sample-mediaOnly',
      template: 'mediaOnly',
      duration: 6,
      audioSegment: 0,
      title: 'The picture is the slide',
      contents: [imageParagraph(HERO_IMAGE, 'Harbor study')],
    },
  },
  barChart: {
    block: {
      id: 'sample-barChart',
      template: 'barChart',
      duration: 6,
      audioSegment: 0,
      title: 'Visitors by Quarter',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  columnChart: {
    block: {
      id: 'sample-columnChart',
      template: 'columnChart',
      duration: 6,
      audioSegment: 0,
      title: 'Visitors by Quarter',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  pieChart: {
    block: {
      id: 'sample-pieChart',
      template: 'pieChart',
      duration: 6,
      audioSegment: 0,
      title: 'Share of Visitors',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  donutChart: {
    block: {
      id: 'sample-donutChart',
      template: 'donutChart',
      duration: 6,
      audioSegment: 0,
      title: 'Share of Visitors',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  lineChart: {
    block: {
      id: 'sample-lineChart',
      template: 'lineChart',
      duration: 6,
      audioSegment: 0,
      title: 'Visitors Through the Year',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  areaChart: {
    block: {
      id: 'sample-areaChart',
      template: 'areaChart',
      duration: 6,
      audioSegment: 0,
      title: 'Visitors Through the Year',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  scatterChart: {
    block: {
      id: 'sample-scatterChart',
      template: 'scatterChart',
      duration: 6,
      audioSegment: 0,
      title: 'Visitors Against Revenue',
      headers: CHART_HEADERS,
      rows: CHART_ROWS,
    },
  },
  photoGrid: {
    block: {
      id: 'sample-photo-grid',
      template: 'photoGrid',
      duration: 6,
      audioSegment: 0,
      images: [
        { src: GRID_IMAGE_A, alt: 'Workshop' },
        { src: GRID_IMAGE_B, alt: 'Prototype' },
        { src: GRID_IMAGE_C, alt: 'Review' },
        { src: GRID_IMAGE_D, alt: 'Launch' },
      ],
      caption: 'A four-image grid stresses gutters, caption overlays, and image crop behavior.',
    },
  },
  definitionCard: {
    block: {
      id: 'sample-definition-card',
      template: 'definitionCard',
      duration: 6,
      audioSegment: 0,
      term: 'Visual Regression Seed',
      definition:
        'A representative block used to make layout, contrast, and typographic drift easier to reason about.',
      origin: 'Squisq QA vocabulary',
      colorScheme: 'green',
      accentImage: {
        src: DETAIL_IMAGE,
        alt: 'Abstract dictionary image',
        position: 'right-strip',
      },
    },
  },
  comparisonBar: {
    block: {
      id: 'sample-comparison-bar',
      template: 'comparisonBar',
      duration: 6,
      audioSegment: 0,
      leftLabel: 'Before review',
      leftValue: 38,
      rightLabel: 'After review',
      rightValue: 84,
      unit: 'clarity score',
      colorScheme: 'orange',
    },
  },
  pullQuote: {
    block: {
      id: 'sample-pull-quote',
      template: 'pullQuote',
      duration: 6,
      audioSegment: 0,
      text: 'Screenshots turn a vague hunch into something everyone can point at.',
      attribution: 'Template review',
      backgroundImage: {
        src: HERO_IMAGE,
        alt: 'Abstract hero image',
        credit: 'Generated fixture',
      },
    },
  },
  videoWithCaption: {
    block: {
      id: 'sample-video-with-caption',
      template: 'videoWithCaption',
      duration: 6,
      audioSegment: 0,
      videoSrc: VIDEO_SRC,
      posterSrc: POSTER_IMAGE,
      videoAlt: 'Generated video poster',
      clipStart: 0,
      clipEnd: 3,
      caption: 'Video templates use a generated poster so the review stays offline.',
      captionPosition: 'bottom',
      videoCredit: 'Generated fixture',
    },
  },
  videoPullQuote: {
    block: {
      id: 'sample-video-pull-quote',
      template: 'videoPullQuote',
      duration: 6,
      audioSegment: 0,
      text: 'Motion-backed templates still need a strong still frame.',
      attribution: 'Video QA fixture',
      backgroundVideo: {
        src: VIDEO_SRC,
        posterSrc: POSTER_IMAGE,
        alt: 'Generated video poster',
        clipStart: 0,
        clipEnd: 3,
        credit: 'Generated fixture',
      },
    },
  },
  dataTable: {
    block: {
      id: 'sample-data-table',
      template: 'dataTable',
      duration: 6,
      audioSegment: 0,
      title: 'Theme Sweep Results',
      headers: ['Area', 'Signal', 'Status'],
      rows: [
        ['Contrast', 'Text vs. surface', 'Review'],
        ['Spacing', 'Card and gutter rhythm', 'Review'],
        ['Media', 'Crop and captions', 'Review'],
      ],
      align: ['left', 'left', 'center'],
      colorScheme: 'blue',
    },
  },
  diagram: {
    block: {
      id: 'sample-diagram',
      template: 'diagram',
      duration: 6,
      audioSegment: 0,
      title: 'Review Flow',
      colorScheme: 'blue',
      nodeShape: 'rounded',
      edgeStyle: 'curved',
      children: [
        childBlock({
          id: 'capture',
          title: 'Capture',
          x: 40,
          y: 80,
          connectsTo: [{ target: 'compare', type: 'then' }],
        }),
        childBlock({
          id: 'compare',
          title: 'Compare',
          x: 300,
          y: 80,
          connectsTo: [{ target: 'adjust', type: 'iterate' }],
        }),
        childBlock({
          id: 'adjust',
          title: 'Adjust',
          x: 560,
          y: 80,
        }),
      ],
    },
  },
  tree: {
    block: {
      id: 'sample-tree',
      template: 'tree',
      duration: 6,
      audioSegment: 0,
      title: 'Package Layout',
      items: [
        {
          id: 'src',
          label: 'src/',
          isDir: true,
          children: [
            { id: 'index', label: 'index.ts', children: [] },
            {
              id: 'timeline-dir',
              label: 'asciiTimeline/',
              isDir: true,
              children: [
                { id: 'parse', label: 'parse.ts', children: [] },
                { id: 'render', label: 'render.ts', children: [] },
              ],
            },
          ],
        },
      ],
    },
  },
  timeline: {
    block: {
      id: 'sample-timeline',
      template: 'timeline',
      duration: 6,
      audioSegment: 0,
      title: 'Kernel and Client Timing',
      tracks: [
        {
          id: 'kernel',
          label: 'Kernel',
          endLabel: 'simulation time',
          events: [
            { id: 't28', label: 'T28', description: 'delta 28', position: 0, side: 'above' },
            { id: 't29', label: 'T29', description: 'delta 29', position: 0.5, side: 'below' },
            { id: 't30', label: 'T30', description: 'delta 30', position: 1, side: 'above' },
          ],
        },
        {
          id: 'client',
          label: 'Client',
          events: [
            {
              id: 'render-start',
              label: 'Render start',
              description: 'interpolate buffered snapshots',
              position: 0,
              side: 'below',
            },
            {
              id: 'present',
              label: 'Present frame',
              description: 'display-rate output',
              position: 1,
              side: 'above',
              marker: 'diamond',
            },
          ],
        },
      ],
      links: [{ source: 't29', target: 'render-start', label: 'interpolation path' }],
    },
  },
  layout: {
    block: {
      id: 'sample-layout',
      template: 'layout',
      duration: 6,
      audioSegment: 0,
      children: [
        childBlock({
          id: 'layout-bg',
          title: 'Background',
          template: 'rectangle',
          templateOverrides: {
            x: '120',
            y: '110',
            width: '1680',
            height: '860',
            fill: '#f8fafc',
            stroke: '#0f172a',
            strokeWidth: '4',
            borderRadius: '28',
          },
        }),
        childBlock({
          id: 'layout-image',
          title: 'Image',
          template: 'image',
          templateOverrides: {
            x: '1260',
            y: '180',
            width: '420',
            height: '640',
            src: GRID_IMAGE_B,
            fit: 'cover',
          },
        }),
        childBlock({
          id: 'layout-title',
          title: 'Title',
          template: 'text',
          templateOverrides: {
            x: '240',
            y: '230',
            width: '820',
            height: '150',
            fontSize: '64',
            fontWeight: 'bold',
            color: '#0f172a',
          },
          contents: [paragraph('Free-form layout sample')],
        }),
        childBlock({
          id: 'layout-body',
          title: 'Body',
          template: 'text',
          templateOverrides: {
            x: '250',
            y: '430',
            width: '760',
            height: '260',
            fontSize: '34',
            color: '#334155',
            lineHeight: '1.35',
          },
          contents: [
            paragraph(
              'Text, image, and shape layers are positioned together to exercise the absolute canvas path.',
            ),
          ],
        }),
      ],
    },
  },
  drawing: {
    block: {
      id: 'sample-drawing',
      template: 'drawing',
      duration: 6,
      audioSegment: 0,
      title: 'System Sketch',
      colorScheme: 'green',
      fill: '#dbeafe',
      children: [
        childBlock({
          id: 'input',
          title: 'Input',
          template: 'rectangle',
          templateOverrides: {
            x: '40',
            y: '120',
            width: '180',
            height: '90',
            fill: '#dbeafe',
            stroke: '#2563eb',
          },
          connectsTo: [{ target: 'render', type: 'feeds' }],
        }),
        childBlock({
          id: 'render',
          title: 'Render',
          template: 'circle',
          templateOverrides: {
            x: '330',
            y: '100',
            width: '130',
            height: '130',
            fill: '#dcfce7',
            stroke: '#16a34a',
          },
          connectsTo: [{ target: 'review', type: 'shows' }],
        }),
        childBlock({
          id: 'review',
          title: 'Review',
          template: 'diamond',
          templateOverrides: {
            x: '590',
            y: '120',
            width: '150',
            height: '110',
            fill: '#fef3c7',
            stroke: '#d97706',
          },
        }),
        childBlock({
          id: 'note',
          title: 'Look for odd spacing',
          template: 'text',
          // No stroke override: text shapes fall back to the theme text
          // color, which keeps the note legible on every theme surface.
          templateOverrides: { x: '270', y: '300', width: '280', height: '70' },
        }),
      ],
    },
  },
} satisfies Record<string, TemplateScreenshotFixture>;

export const TEMPLATE_SCREENSHOT_FIXTURES: Record<string, TemplateScreenshotFixture> =
  TEMPLATE_SCREENSHOT_FIXTURES_INTERNAL;
