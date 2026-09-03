/**
 * Exhaustive media-layout policy for every built-in block template.
 *
 * A template has two independent concerns:
 * 1. what it renders when no external image/video/diagram is present, and
 * 2. what happens when rich body media was not already consumed by it.
 *
 * Keeping that declaration here prevents misleading template names (for
 * example, `fullBleedQuote` is text-only) from becoming layout behavior.
 * `mediaLayoutPolicy.test.ts` keeps this map exactly 1:1 with the registry.
 */

import type { TemplateBlock } from '../../schemas/BlockTemplates.js';
import type { ViewportOrientation } from '../../schemas/Viewport.js';

export type BuiltInTemplateName = TemplateBlock['template'];

/** Shape of the supplemental media set after extraction. */
export type SupplementalMediaShape = 'wide' | 'tall' | 'square' | 'multiple';

/** Designed compositions understood by the framework-free layout resolver. */
export type SupplementalMediaLayoutVariant = 'title-stack' | 'split' | 'text-stack' | 'dense-stack';

export type SupplementalMediaVariantMatrix = Record<
  ViewportOrientation,
  Record<SupplementalMediaShape, SupplementalMediaLayoutVariant>
>;

/** What the template does before supplemental rich media is considered. */
export type NoMediaLayout =
  | 'template-default'
  | 'template-without-optional-media'
  | 'unsupported'
  | 'intrinsic-visual';

/** Which part of the system owns the template's primary media geometry. */
export type TemplateMediaOwnership =
  | 'supplemental'
  | 'optional-native'
  | 'required-native'
  | 'intrinsic-visual';

/** Geometry already implemented by templates that own their primary media. */
export type NativeMediaLayout =
  | 'full-bleed-image'
  | 'full-bleed-video'
  | 'background-image'
  | 'accent-strip-or-inset'
  | 'feature-left'
  | 'feature-right'
  | 'map-canvas'
  | 'photo-grid'
  | 'spatial-canvas'
  | 'freeform-canvas';

/** How unconsumed body media behaves after the template renders. */
export type UnconsumedMediaBehavior =
  | 'reserved-slot'
  | 'reserve-when-no-native-media'
  | 'retain-native-layout';

export interface BlockMediaLayoutPolicy {
  /** Concise human-readable contract for reviewers and future template work. */
  summary: string;
  /** The composition used when the block has no external rich media. */
  noMedia: NoMediaLayout;
  /** Whether primary media is placed by this resolver or by the template. */
  ownership: TemplateMediaOwnership;
  /** Existing template-owned media geometry, when applicable. */
  nativeLayout?: NativeMediaLayout;
  /** Explicit geometry for extra media when the native composition must remain intact. */
  additionalMediaLayout?: 'overlay-inset';
  /** Placement policy for rich body media left over after template execution. */
  unconsumedMedia: UnconsumedMediaBehavior;
  /** Required whenever unconsumed media may receive a reserved rectangle. */
  variants?: SupplementalMediaVariantMatrix;
}

const TITLE_VARIANTS: SupplementalMediaVariantMatrix = {
  landscape: {
    wide: 'title-stack',
    tall: 'split',
    square: 'title-stack',
    multiple: 'title-stack',
  },
  square: {
    wide: 'title-stack',
    tall: 'split',
    square: 'title-stack',
    multiple: 'title-stack',
  },
  portrait: {
    wide: 'title-stack',
    tall: 'title-stack',
    square: 'title-stack',
    multiple: 'title-stack',
  },
};

const TEXT_VARIANTS: SupplementalMediaVariantMatrix = {
  landscape: {
    wide: 'split',
    tall: 'split',
    square: 'split',
    multiple: 'split',
  },
  square: {
    wide: 'text-stack',
    tall: 'split',
    square: 'text-stack',
    multiple: 'text-stack',
  },
  portrait: {
    wide: 'text-stack',
    tall: 'text-stack',
    square: 'text-stack',
    multiple: 'text-stack',
  },
};

const DENSE_VARIANTS: SupplementalMediaVariantMatrix = {
  landscape: {
    wide: 'dense-stack',
    tall: 'dense-stack',
    square: 'dense-stack',
    multiple: 'dense-stack',
  },
  square: {
    wide: 'dense-stack',
    tall: 'dense-stack',
    square: 'dense-stack',
    multiple: 'dense-stack',
  },
  portrait: {
    wide: 'dense-stack',
    tall: 'dense-stack',
    square: 'dense-stack',
    multiple: 'dense-stack',
  },
};

/**
 * Canonical media contract for all built-in templates. Entries are kept
 * in registry/gallery order to make policy reviews easy to scan.
 */
export const BLOCK_MEDIA_LAYOUT_POLICIES = {
  title: {
    summary: 'Text-only by default; supplemental media gets a title band plus a reserved field.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: TITLE_VARIANTS,
  },
  sectionHeader: {
    summary:
      'Uses its authored background image when present; otherwise supplemental media receives a title composition.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'background-image',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TITLE_VARIANTS,
  },
  bigText: {
    summary:
      'Uses its authored background image (behind a contrast bloom) when present; otherwise renders gigantic text on the theme surface.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'background-image',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TITLE_VARIANTS,
  },
  transcript: {
    summary:
      'Speaker avatars are native media (initials medallions when absent); other media stays supplemental.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  content: {
    summary:
      'Preserves the complete heading and body; supplemental media receives a companion field.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: TEXT_VARIANTS,
  },
  statHighlight: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media occupies a companion field.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  quote: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media is paired with the quote.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  factCard: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media is paired with the fact card.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  twoColumn: {
    summary:
      'Text comparison by default; supplemental media stacks below the dense two-column panel.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  dateEvent: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media is paired with the event.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  imageWithCaption: {
    summary: 'Requires one primary image and owns its full-bleed image/caption geometry.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'full-bleed-image',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  leftFeature: {
    summary: 'Requires a primary image in the left feature cell; text occupies the right cell.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'feature-left',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  rightFeature: {
    summary: 'Requires a primary image in the right feature cell; text occupies the left cell.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'feature-right',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  map: {
    summary: 'The map canvas is the primary visual; other media must not reflow its geography.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'map-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  fullBleedQuote: {
    summary:
      'Despite its name this is text-only; supplemental media receives the same dramatic title treatment.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: TITLE_VARIANTS,
  },
  list: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media is paired with the list.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  photoGrid: {
    summary: 'Requires a primary image collection and owns the complete tiled media field.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'photo-grid',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  definitionCard: {
    summary:
      'Uses its optional accent image natively; otherwise supplemental media is paired with the definition.',
    noMedia: 'template-without-optional-media',
    ownership: 'optional-native',
    nativeLayout: 'accent-strip-or-inset',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'reserve-when-no-native-media',
    variants: TEXT_VARIANTS,
  },
  comparisonBar: {
    summary: 'Data bars are primary; supplemental media stacks below to preserve horizontal scale.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  pullQuote: {
    summary: 'Requires and owns a full-bleed background image behind the quote lockup.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'full-bleed-image',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  videoWithCaption: {
    summary: 'Requires one primary video and owns its full-bleed video/caption geometry.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'full-bleed-video',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  videoPullQuote: {
    summary: 'Requires and owns a full-bleed video behind the quote lockup.',
    noMedia: 'unsupported',
    ownership: 'required-native',
    nativeLayout: 'full-bleed-video',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  dataTable: {
    summary: 'The table remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  barChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  columnChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  pieChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  donutChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  lineChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  areaChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  scatterChart: {
    summary: 'The chart remains wide; supplemental media stacks below the dense data region.',
    noMedia: 'template-default',
    ownership: 'supplemental',
    unconsumedMedia: 'reserved-slot',
    variants: DENSE_VARIANTS,
  },
  diagram: {
    summary:
      'The node-and-edge canvas is intrinsic media and retains its spatial coordinate system.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'spatial-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  tree: {
    summary: 'The interactive tree canvas is intrinsic media and retains its full layout region.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'spatial-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  timeline: {
    summary: 'The track canvas is intrinsic media and retains its shared horizontal time scale.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'spatial-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  layout: {
    summary: 'The authored layer canvas is intrinsic media and must preserve absolute placement.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'freeform-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
  drawing: {
    summary: 'The drawing canvas is intrinsic media and must preserve authored geometry.',
    noMedia: 'intrinsic-visual',
    ownership: 'intrinsic-visual',
    nativeLayout: 'freeform-canvas',
    additionalMediaLayout: 'overlay-inset',
    unconsumedMedia: 'retain-native-layout',
  },
} as const satisfies Record<BuiltInTemplateName, BlockMediaLayoutPolicy>;

/** Safe runtime lookup for built-ins; custom template ids return undefined. */
export function getBlockMediaLayoutPolicy(
  template: string | undefined,
): BlockMediaLayoutPolicy | undefined {
  if (!template) return undefined;
  return (BLOCK_MEDIA_LAYOUT_POLICIES as Record<string, BlockMediaLayoutPolicy>)[template];
}
