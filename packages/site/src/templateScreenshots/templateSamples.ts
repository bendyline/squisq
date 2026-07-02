import type { Block, TemplateBlock } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';

export interface TemplateScreenshotFixture {
  block: TemplateBlock & { children?: Block[] };
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
