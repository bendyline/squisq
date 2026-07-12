/**
 * Public model for authored ASCII timelines.
 *
 * Source columns and rows are retained so separate tracks share one spatial
 * scale and pointer callouts can land between authored milestone dots. The
 * template mapping normalizes columns only at the final rendering boundary.
 */

export type AsciiTimelineStyle = 'unicode' | 'ascii';
export type AsciiTimelineSide = 'above' | 'below';
export type AsciiTimelineMarker = 'filled' | 'hollow' | 'diamond';

export interface AsciiTimelineEvent {
  /** Stable slug id, deduplicated across every track. */
  id: string;
  /** Short callout heading. */
  label: string;
  /** Optional longer callout/body text. */
  description?: string;
  /** Zero-based source-grid column of the event anchor. */
  column: number;
  /** Authored/default callout placement around the track. */
  side?: AsciiTimelineSide;
  /** Placement for `description` when it differs from the label side. */
  descriptionSide?: AsciiTimelineSide;
  /** False renders a cadence/tick point without a text callout. */
  callout?: boolean;
  /** Visual point vocabulary inferred from the authored marker. */
  marker?: AsciiTimelineMarker;
}

export interface AsciiTimelineTrack {
  /** Stable track id. */
  id: string;
  /** Optional label shown to the left of the rendered track. */
  label?: string;
  /** Optional axis/end label authored after the terminal arrow. */
  endLabel?: string;
  /** Zero-based source row containing this track's horizontal axis. */
  row: number;
  /** Inclusive source-grid bounds of the axis. */
  startColumn: number;
  endColumn: number;
  events: AsciiTimelineEvent[];
}

export interface AsciiTimelineLink {
  /** Source event id. */
  source: string;
  /** Target event id. */
  target: string;
  /** Optional branch/link label. */
  label?: string;
}

export interface AsciiTimeline {
  tracks: AsciiTimelineTrack[];
  links: AsciiTimelineLink[];
  /** Source-grid dimensions, shared by every track. */
  width: number;
  height: number;
  style: AsciiTimelineStyle;
  /** Non-fatal parse notes (unresolved links, unlabeled events, and so on). */
  warnings: string[];
}

export interface AsciiTimelineDetection {
  isTimeline: boolean;
  /** Present on acceptance so callers do not need to parse twice. */
  timeline?: AsciiTimeline;
  /** Machine-readable accept/reject reasons. */
  reasons: string[];
}
