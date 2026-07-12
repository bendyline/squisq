/** Public authored ASCII timeline codec. */

export { parseAsciiTimeline, parseAsciiTimelineWithStats } from './parse.js';
export type { AsciiTimelineStats } from './parse.js';
export { renderAsciiTimeline } from './render.js';
export type { RenderAsciiTimelineOptions } from './render.js';
export {
  ASCII_TIMELINE_FENCE_LANGS,
  detectAsciiTimeline,
  isAsciiTimelineFence,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
} from './detect.js';
export type { DetectAsciiTimelineOptions } from './detect.js';
export { asciiTimelineToTemplateData } from './mapping.js';
export type {
  AsciiTimeline,
  AsciiTimelineDetection,
  AsciiTimelineEvent,
  AsciiTimelineLink,
  AsciiTimelineMarker,
  AsciiTimelineSide,
  AsciiTimelineStyle,
  AsciiTimelineTrack,
} from './types.js';
