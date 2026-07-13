/**
 * Timeline Template
 *
 * Renders one or more left-to-right tracks with positioned event markers,
 * callout stems/text, and optional branch links. It deliberately composes
 * existing shape/path/text layers so every current render/export surface can
 * display timelines without a timeline-specific React layer.
 */

import type { Layer, PathLayer, ShapeLayer, TextLayer } from '../../schemas/Doc.js';
import type {
  TemplateContext,
  TimelineBlockInput,
  TimelineTemplateEvent,
  TimelineTemplateLink,
  TimelineTemplateTrack,
} from '../../schemas/BlockTemplates.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import {
  getThemeFont,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { createBackgroundLayer, estimateTextHeight } from './captionUtils.js';

type EventPoint = {
  event: TimelineTemplateEvent;
  trackIndex: number;
  eventIndex: number;
  x: number;
  y: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Defensive coercion for untyped `templateData` merged into the input. */
function coerceTracks(raw: unknown): TimelineTemplateTrack[] {
  if (!Array.isArray(raw)) return [];
  const tracks: TimelineTemplateTrack[] = [];

  raw.forEach((candidate, trackIndex) => {
    if (typeof candidate !== 'object' || candidate === null) return;
    const record = candidate as Record<string, unknown>;
    const id =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `track-${trackIndex + 1}`;
    const events: TimelineTemplateEvent[] = [];

    if (Array.isArray(record.events)) {
      record.events.forEach((eventCandidate, eventIndex) => {
        if (typeof eventCandidate !== 'object' || eventCandidate === null) return;
        const event = eventCandidate as Record<string, unknown>;
        if (typeof event.label !== 'string') return;
        const position =
          typeof event.position === 'number' ? event.position : Number(event.position);
        if (!Number.isFinite(position)) return;
        const eventId =
          typeof event.id === 'string' && event.id.trim()
            ? event.id.trim()
            : `${id}-event-${eventIndex + 1}`;
        const side = event.side === 'above' || event.side === 'below' ? event.side : undefined;
        const descriptionSide =
          event.descriptionSide === 'above' || event.descriptionSide === 'below'
            ? event.descriptionSide
            : undefined;
        const marker =
          event.marker === 'filled' || event.marker === 'hollow' || event.marker === 'diamond'
            ? event.marker
            : undefined;
        events.push({
          id: eventId,
          label: event.label,
          position: clamp01(position),
          ...(typeof event.description === 'string' && event.description.trim()
            ? { description: event.description.trim() }
            : {}),
          ...(side ? { side } : {}),
          ...(descriptionSide ? { descriptionSide } : {}),
          ...(event.callout === false ? { callout: false } : {}),
          ...(marker ? { marker } : {}),
        });
      });
    }

    tracks.push({
      id,
      ...(typeof record.label === 'string' && record.label.trim()
        ? { label: record.label.trim() }
        : {}),
      ...(typeof record.endLabel === 'string' && record.endLabel.trim()
        ? { endLabel: record.endLabel.trim() }
        : {}),
      events,
    });
  });

  return tracks;
}

function coerceLinks(raw: unknown, eventIds: ReadonlySet<string>): TimelineTemplateLink[] {
  if (!Array.isArray(raw)) return [];
  const links: TimelineTemplateLink[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const link = candidate as Record<string, unknown>;
    if (typeof link.source !== 'string' || typeof link.target !== 'string') continue;
    if (!eventIds.has(link.source) || !eventIds.has(link.target) || link.source === link.target)
      continue;
    links.push({
      source: link.source,
      target: link.target,
      ...(typeof link.label === 'string' && link.label.trim() ? { label: link.label.trim() } : {}),
    });
  }
  return links;
}

function diamondLayer(
  id: string,
  x: number,
  y: number,
  radius: number,
  color: string,
  delay: number,
): PathLayer {
  return {
    type: 'path',
    id,
    content: {
      d: `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`,
      fill: color,
      stroke: color,
      strokeWidth: 2,
    },
    position: { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 },
    animation: { type: 'zoomIn', duration: 0.35, delay },
  };
}

function branchPath(source: EventPoint, target: EventPoint, bend: number): string {
  if (Math.abs(source.y - target.y) < 1) {
    const sourceSide = source.event.side ?? (source.eventIndex % 2 === 0 ? 'above' : 'below');
    // Route on the side opposite the source callout so the arch does not run
    // through its stem/label stack.
    const direction = sourceSide === 'above' ? 1 : -1;
    const controlY = source.y + direction * bend;
    return `M ${source.x} ${source.y} C ${source.x} ${controlY}, ${target.x} ${controlY}, ${target.x} ${target.y}`;
  }
  const midY = (source.y + target.y) / 2;
  return `M ${source.x} ${source.y} C ${source.x} ${midY}, ${target.x} ${midY}, ${target.x} ${target.y}`;
}

export function timelineBlock(input: TimelineBlockInput, context: TemplateContext): Layer[] {
  const { theme, viewport } = context;
  const colors = resolveColorScheme(context, input.colorScheme);
  const tracks = coerceTracks(input.tracks);
  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 165))];

  const titleFontSize = themedFontSize(44, context, true);
  const trackFontSize = themedFontSize(22, context, false);
  const baseEventFontSize = themedFontSize(24, context, false);
  const baseDescriptionFontSize = themedFontSize(17, context, false);

  if (input.title) {
    layers.push({
      type: 'text',
      id: 'timeline-title',
      content: {
        text: input.title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: { x: '50%', y: Math.max(50, titleFontSize * 1.2), width: '82%', anchor: 'center' },
      animation: { type: 'fadeIn', duration: 0.7 },
    });
  }

  if (tracks.length === 0) {
    layers.push({
      type: 'text',
      id: 'timeline-empty',
      content: {
        text: input.title ? 'No timeline events' : 'Empty timeline',
        style: {
          fontSize: themedFontSize(36, context, true),
          fontFamily: getThemeFont(context, 'title'),
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
      },
      position: { x: '50%', y: '50%', width: '80%', anchor: 'center' },
    });
    return layers;
  }

  const hasTrackLabels = tracks.some((track) => !!track.label);
  const outerMargin = Math.max(48, viewport.width * 0.065);
  const labelWidth = hasTrackLabels ? Math.min(280, viewport.width * 0.18) : 0;
  const axisStartX = outerMargin + labelWidth;
  const axisEndX = viewport.width - outerMargin;
  const axisWidth = Math.max(1, axisEndX - axisStartX);
  const contentTop = input.title
    ? Math.max(titleFontSize * 2.2, viewport.height * 0.2)
    : viewport.height * 0.09;
  const contentBottom = viewport.height * 0.91;
  const availableHeight = Math.max(1, contentBottom - contentTop);
  const trackBand = availableHeight / tracks.length;
  const markerRadius = Math.max(6, Math.min(11, Math.min(viewport.width, viewport.height) / 105));
  const trackColor = withAlpha(colors.text ?? theme.colors.primary, 0.72);
  const accentColor = colors.accent ?? theme.colors.primary;
  const branchColor = withAlpha(accentColor, 0.78);
  const calloutColor = withAlpha(theme.colors.text, 0.48);
  const maxCalloutEvents = Math.max(
    1,
    ...tracks.map((track) => track.events.filter((event) => event.callout !== false).length),
  );
  // Alternate/opposite-side callouts can safely use more width than a naive
  // `axisWidth / total markers` split (dense cadence markers have no text).
  const calloutWidth = Math.max(
    Math.min(150, viewport.width * 0.2),
    Math.min(330, (axisWidth / Math.min(maxCalloutEvents, 4)) * 0.86),
  );
  // Theme font scaling intentionally grows in portrait, but timeline cards
  // get narrower there. Cap callout typography against the physical viewport
  // so labels wrap instead of degenerating to a few characters per line.
  const minViewportScale = Math.min(viewport.width, viewport.height) / 1080;
  const eventFontSize = Math.min(baseEventFontSize, 24 * minViewportScale);
  const descriptionFontSize = Math.min(baseDescriptionFontSize, 17 * minViewportScale);
  const trackMarkerRadii = tracks.map((track) => {
    const positions = track.events.map((event) => clamp01(event.position)).sort((a, b) => a - b);
    let minGapPx = Number.POSITIVE_INFINITY;
    for (let index = 1; index < positions.length; index++) {
      minGapPx = Math.min(minGapPx, (positions[index] - positions[index - 1]) * axisWidth);
    }
    return Number.isFinite(minGapPx)
      ? Math.min(markerRadius, Math.max(3, minGapPx * 0.32))
      : markerRadius;
  });
  const eventPoints: EventPoint[] = [];
  // Links resolve duplicate public/template-data ids deterministically to
  // their first event, while every event still receives its own marker and
  // callout layers.
  const eventPointById = new Map<string, EventPoint>();

  tracks.forEach((track, trackIndex) => {
    const y = contentTop + trackBand * (trackIndex + 0.5);
    const trackDelay = 0.12 + trackIndex * 0.12;
    const trackId = safeId(track.id);

    const line: PathLayer = {
      type: 'path',
      id: `timeline-track-${trackId}-${trackIndex}`,
      content: {
        d: `M ${axisStartX} ${y} L ${axisEndX} ${y}`,
        stroke: trackColor,
        strokeWidth: Math.max(2, markerRadius * 0.32),
        fill: 'none',
        endMarker: 'arrow',
      },
      position: { x: axisStartX, y: y - markerRadius, width: axisWidth, height: markerRadius * 2 },
      animation: { type: 'fadeIn', duration: 0.65, delay: trackDelay },
    };
    layers.push(line);

    if (track.label) {
      const label: TextLayer = {
        type: 'text',
        id: `timeline-track-label-${trackId}-${trackIndex}`,
        content: {
          text: track.label,
          style: {
            fontSize: trackFontSize,
            fontFamily: getThemeFont(context, 'body'),
            fontWeight: 'bold',
            color: theme.colors.textMuted,
            textAlign: 'right',
          },
        },
        position: {
          x: outerMargin + labelWidth / 2 - 16,
          y,
          width: Math.max(1, labelWidth - 32),
          anchor: 'center',
        },
        animation: { type: 'fadeIn', duration: 0.5, delay: trackDelay },
      };
      layers.push(label);
    }

    if (track.endLabel) {
      layers.push({
        type: 'text',
        id: `timeline-track-end-label-${trackId}-${trackIndex}`,
        content: {
          text: track.endLabel,
          style: {
            fontSize: descriptionFontSize,
            fontFamily: getThemeFont(context, 'body'),
            color: theme.colors.textMuted,
            textAlign: 'left',
            maxLines: 2,
          },
        },
        position: {
          x: axisEndX + markerRadius * 1.6,
          y: y - descriptionFontSize * 0.7,
          width: Math.max(48, outerMargin - markerRadius * 2),
          anchor: 'top-left',
        },
        animation: { type: 'fadeIn', duration: 0.5, delay: trackDelay },
      });
    }

    track.events.forEach((event, eventIndex) => {
      const point = {
        event,
        trackIndex,
        eventIndex,
        x: axisStartX + axisWidth * clamp01(event.position),
        y,
      } satisfies EventPoint;
      eventPoints.push(point);
      if (!eventPointById.has(event.id)) eventPointById.set(event.id, point);
    });
  });

  // Branches sit behind markers and callouts so their endpoints disappear
  // cleanly beneath the event dots.
  const links = coerceLinks(input.links, new Set(eventPointById.keys()));
  links.forEach((link, linkIndex) => {
    const source = eventPointById.get(link.source);
    const target = eventPointById.get(link.target);
    if (!source || !target) return;
    const bend = Math.min(90, Math.max(42, trackBand * 0.28));
    layers.push({
      type: 'path',
      id: `timeline-link-${safeId(link.source)}-${safeId(link.target)}-${linkIndex}`,
      content: {
        d: branchPath(source, target, bend),
        stroke: branchColor,
        strokeWidth: Math.max(2, markerRadius * 0.26),
        fill: 'none',
        endMarker: 'arrow',
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
      animation: { type: 'fadeIn', duration: 0.6, delay: 0.45 + linkIndex * 0.08 },
    });

    if (link.label) {
      const sameTrack = source.trackIndex === target.trackIndex;
      const linkLabelWidth = Math.min(
        320,
        Math.max(150, link.label.length * descriptionFontSize * 0.55 + 24),
      );
      const linkLabelHeight = Math.min(
        descriptionFontSize * 1.25 * 2 + 8,
        estimateTextHeight(link.label, descriptionFontSize, linkLabelWidth, 1.25) + 8,
      );
      let linkLabelX = (source.x + target.x) / 2;
      const sameTrackSourceSide =
        source.event.side ?? (source.eventIndex % 2 === 0 ? 'above' : 'below');
      const sameTrackDirection = sameTrackSourceSide === 'above' ? 1 : -1;
      let linkLabelY = sameTrack
        ? source.y + sameTrackDirection * (bend + descriptionFontSize * 0.6)
        : (source.y + target.y) / 2;
      if (!sameTrack) {
        // Offset perpendicular to the branch so vertical/cross-track paths do
        // not run through their labels. Choose the sign that stays in-frame.
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const offset = linkLabelWidth * 0.56;
        const candidateX = linkLabelX + (-dy / length) * offset;
        const candidateY = linkLabelY + (dx / length) * offset;
        const fits =
          candidateX >= linkLabelWidth / 2 + 8 &&
          candidateX <= viewport.width - linkLabelWidth / 2 - 8 &&
          candidateY >= descriptionFontSize * 1.5 &&
          candidateY <= viewport.height - 12;
        const sign = fits ? 1 : -1;
        linkLabelX += sign * (-dy / length) * offset;
        linkLabelY += sign * (dx / length) * offset;
      }
      linkLabelX = clamp(
        linkLabelX,
        linkLabelWidth / 2 + 8,
        viewport.width - linkLabelWidth / 2 - 8,
      );
      linkLabelY = clamp(linkLabelY, descriptionFontSize * 1.5, viewport.height - 12);
      layers.push({
        type: 'text',
        id: `timeline-link-label-${linkIndex}`,
        content: {
          text: link.label,
          style: {
            fontSize: descriptionFontSize,
            fontFamily: getThemeFont(context, 'body'),
            color: theme.colors.textMuted,
            textAlign: 'center',
            background: theme.colors.background,
            backgroundOpacity: 0.88,
            padding: 4,
            maxLines: 2,
            verticalAlign: 'middle',
          },
        },
        position: {
          x: linkLabelX,
          y: linkLabelY,
          width: linkLabelWidth,
          height: linkLabelHeight,
          anchor: 'center',
        },
        animation: { type: 'fadeIn', duration: 0.5, delay: 0.55 + linkIndex * 0.08 },
      });
    }
  });

  const stemLength = Math.min(78, Math.max(34, trackBand * 0.2));

  for (const point of eventPoints) {
    const { event, trackIndex, eventIndex, x, y } = point;
    const side = event.side ?? (eventIndex % 2 === 0 ? 'above' : 'below');
    const direction = side === 'above' ? -1 : 1;
    const stemEndY = y + direction * stemLength;
    const delay = 0.28 + trackIndex * 0.12 + eventIndex * 0.07;
    const eventLayerId = `${safeId(event.id)}-${trackIndex}-${eventIndex}`;
    const pointMarkerRadius = trackMarkerRadii[trackIndex] ?? markerRadius;
    const calloutX = clamp(x, calloutWidth / 2 + 8, viewport.width - calloutWidth / 2 - 8);

    const addStem = (stemId: string, endY: number, stemDelay: number): void => {
      layers.push({
        type: 'path',
        id: stemId,
        content: {
          d: `M ${x} ${y} L ${calloutX} ${endY}`,
          stroke: calloutColor,
          strokeWidth: Math.max(1, markerRadius * 0.18),
          fill: 'none',
        },
        position: {
          x: Math.min(x, calloutX),
          y: Math.min(y, endY),
          width: Math.max(2, Math.abs(calloutX - x)),
          height: Math.max(2, Math.abs(endY - y)),
        },
        animation: { type: 'fadeIn', duration: 0.4, delay: stemDelay },
      });
    };

    if (event.callout !== false) {
      addStem(`timeline-stem-${eventLayerId}`, stemEndY, delay);
      const descriptionSide = event.descriptionSide ?? side;
      if (event.description && descriptionSide !== side) {
        const descriptionDirection = descriptionSide === 'above' ? -1 : 1;
        addStem(
          `timeline-description-stem-${eventLayerId}`,
          y + descriptionDirection * stemLength,
          delay + 0.03,
        );
      }
    }

    const marker = event.marker ?? 'filled';
    if (marker === 'diamond') {
      layers.push(
        diamondLayer(
          `timeline-marker-${eventLayerId}`,
          x,
          y,
          pointMarkerRadius,
          accentColor,
          delay,
        ),
      );
    } else {
      const dot: ShapeLayer = {
        type: 'shape',
        id: `timeline-marker-${eventLayerId}`,
        content: {
          shape: 'circle',
          fill: marker === 'hollow' ? theme.colors.background : accentColor,
          stroke: accentColor,
          strokeWidth: Math.max(1.5, pointMarkerRadius * 0.28),
        },
        position: {
          x: x - pointMarkerRadius,
          y: y - pointMarkerRadius,
          width: pointMarkerRadius * 2,
          height: pointMarkerRadius * 2,
        },
        animation: { type: 'zoomIn', duration: 0.35, delay },
      };
      layers.push(dot);
    }

    if (event.callout !== false) {
      const labelLineHeight = 1.2;
      const labelHeight = Math.min(
        estimateTextHeight(event.label, eventFontSize, calloutWidth, labelLineHeight),
        eventFontSize * labelLineHeight * 2,
      );
      const labelLines = Math.max(1, Math.round(labelHeight / (eventFontSize * labelLineHeight)));
      const unclampedLabelY =
        direction > 0
          ? stemEndY + eventFontSize * 0.9
          : stemEndY - (labelLines - 1) * eventFontSize * labelLineHeight - eventFontSize * 0.9;
      const labelY = clamp(
        unclampedLabelY,
        eventFontSize,
        viewport.height - (labelLines - 1) * eventFontSize * labelLineHeight - 12,
      );
      layers.push({
        type: 'text',
        id: `timeline-event-label-${eventLayerId}`,
        content: {
          text: event.label,
          style: {
            fontSize: eventFontSize,
            fontFamily: getThemeFont(context, 'body'),
            fontWeight: 'bold',
            color: theme.colors.text,
            textAlign: 'center',
            lineHeight: labelLineHeight,
            shadow: shouldUseShadow(context),
            maxLines: 2,
          },
        },
        position: { x: calloutX, y: labelY, width: calloutWidth, anchor: 'center' },
        animation: { type: 'fadeIn', duration: 0.5, delay: delay + 0.08 },
      });

      if (event.description) {
        const descriptionSide = event.descriptionSide ?? side;
        const descriptionDirection = descriptionSide === 'above' ? -1 : 1;
        const descriptionLineHeight = 1.25;
        const descriptionMaxLines = context.orientation === 'portrait' ? 6 : 4;
        const descriptionHeight = Math.min(
          estimateTextHeight(
            event.description,
            descriptionFontSize,
            calloutWidth,
            descriptionLineHeight,
          ),
          descriptionFontSize * descriptionLineHeight * descriptionMaxLines,
        );
        const descriptionLines = Math.max(
          1,
          Math.round(descriptionHeight / (descriptionFontSize * descriptionLineHeight)),
        );
        const descriptionStemEndY = y + descriptionDirection * stemLength;
        let descriptionY: number;
        if (descriptionSide !== side) {
          descriptionY =
            descriptionDirection > 0
              ? descriptionStemEndY + descriptionFontSize * 0.9
              : descriptionStemEndY -
                (descriptionLines - 1) * descriptionFontSize * descriptionLineHeight -
                descriptionFontSize * 0.9;
        } else if (descriptionDirection > 0) {
          descriptionY =
            labelY + labelLines * eventFontSize * labelLineHeight + descriptionFontSize * 0.45;
        } else {
          descriptionY =
            labelY -
            descriptionLines * descriptionFontSize * descriptionLineHeight -
            descriptionFontSize * 0.45;
        }
        descriptionY = clamp(
          descriptionY,
          descriptionFontSize,
          viewport.height -
            (descriptionLines - 1) * descriptionFontSize * descriptionLineHeight -
            12,
        );
        layers.push({
          type: 'text',
          id: `timeline-event-description-${eventLayerId}`,
          content: {
            text: event.description,
            style: {
              fontSize: descriptionFontSize,
              fontFamily: getThemeFont(context, 'body'),
              color: theme.colors.textMuted,
              textAlign: 'center',
              lineHeight: descriptionLineHeight,
              maxLines: descriptionMaxLines,
            },
          },
          position: { x: calloutX, y: descriptionY, width: calloutWidth, anchor: 'center' },
          animation: { type: 'fadeIn', duration: 0.5, delay: delay + 0.14 },
        });
      }
    }
  }

  return layers;
}
