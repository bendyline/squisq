/**
 * Transcript Block Template
 *
 * One conversational beat: a speaker (avatar + name) and a message
 * bubble, with variants for plain speech, private thought (muted,
 * italic), and a tool invocation (mono chip + result line). A second
 * speaker turns the beat into a handoff — two avatars joined by an
 * arrow with the message beneath — which is how agent-to-agent
 * delegation renders.
 *
 * Built for playback of recorded agent sessions (Gezel run recordings
 * are the first consumer), but deliberately generic: any interview,
 * chat, or dialogue content fits. Avatar images are optional; a missing
 * `speakerImage` renders an initials medallion so transcripts never
 * depend on media being present.
 *
 * Adapts font sizes and positioning for different viewports. Shared by
 * both site and app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TemplateContext, TranscriptBlockInput } from '../../schemas/BlockTemplates.js';
import { withAlpha } from '../../schemas/colorUtils.js';
import { createBackgroundLayer, estimateTextHeight } from './captionUtils.js';
import {
  getThemeFont,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';

export function transcriptBlock(rawInput: TranscriptBlockInput, context: TemplateContext): Layer[] {
  // Generic materialization (auto-templating, catalogs) reaches every
  // template with sparse inputs; a transcript with no speaker or text
  // still renders a legible empty beat rather than throwing.
  const input: TranscriptBlockInput = {
    ...rawInput,
    speaker: rawInput.speaker ?? (rawInput as { title?: string }).title ?? 'Speaker',
    text: rawInput.text ?? '',
  };
  const { theme } = context;
  const scheme = resolveColorScheme(context, input.colorScheme);
  const variant = input.variant ?? 'speech';
  const side = input.side ?? 'left';
  const handoff = typeof input.counterpartName === 'string' && input.counterpartName.length > 0;

  const bodyFont = getThemeFont(context, 'body');
  const monoFont = getThemeFont(context, 'mono');
  const nameFontSize = themedFontSize(26, context, false);
  const textFontSize = themedFontSize(32, context, true);
  const metaFontSize = themedFontSize(22, context, false);

  const bubbleFill =
    variant === 'thought'
      ? withAlpha(theme.colors.text, 0.05)
      : variant === 'tool'
        ? withAlpha(scheme.accent, 0.12)
        : withAlpha(theme.colors.text, 0.08);
  const textColor = variant === 'thought' ? theme.colors.textMuted : theme.colors.text;

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 160))];

  if (handoff) {
    return [...layers, ...handoffLayers(input, context, scheme.accent, textColor, bubbleFill)];
  }

  // Speaker column on the chosen side; the bubble takes the rest.
  const avatarX = side === 'left' ? '12%' : '88%';
  const columnX = side === 'left' ? '20%' : '18%';
  const bubbleWidthPct = 62;

  layers.push(
    ...avatarLayers('speaker', input.speaker, input.speakerImage, avatarX, '34%', context),
  );
  layers.push({
    type: 'text',
    id: 'speaker-name',
    content: {
      text: input.speaker + (variant === 'thought' ? '  ·  thinking' : ''),
      style: {
        fontSize: nameFontSize,
        fontFamily: bodyFont,
        fontWeight: 'bold',
        color: theme.colors.textMuted,
        textAlign: side === 'left' ? 'left' : 'right',
        shadow: shouldUseShadow(context),
      },
    },
    position: { x: columnX, y: '24%', width: `${bubbleWidthPct}%`, anchor: 'top-left' },
    animation: { type: 'fadeIn', duration: 0.4 },
  });

  // Bubble sized to the text so short lines don't float in an empty slab.
  const bubbleWidthPx = ((bubbleWidthPct - 5) / 100) * context.viewport.width;
  const textHeightPct = Math.min(
    46,
    (estimateTextHeight(input.text, textFontSize, bubbleWidthPx, 1.35) / context.viewport.height) *
      100 +
      8,
  );
  layers.push({
    type: 'shape',
    id: 'bubble',
    content: {
      shape: 'rect',
      fill: bubbleFill,
      borderRadius: 18,
      ...(variant === 'tool' ? { stroke: scheme.accent, strokeWidth: 2 } : {}),
    },
    position: {
      x: columnX,
      y: '29%',
      width: `${bubbleWidthPct}%`,
      height: `${Math.max(16, textHeightPct)}%`,
      anchor: 'top-left',
    },
    animation: { type: 'fadeIn', duration: 0.4, delay: 0.1 },
  });
  if (variant === 'tool' && input.toolName) {
    layers.push({
      type: 'text',
      id: 'tool-name',
      content: {
        text: input.toolName,
        style: {
          fontSize: themedFontSize(28, context, false),
          fontFamily: monoFont,
          fontWeight: 'bold',
          color: scheme.accent,
        },
      },
      position: { x: `${parseFloat(columnX) + 2}%`, y: '32%', anchor: 'top-left' },
      animation: { type: 'fadeIn', duration: 0.4, delay: 0.15 },
    });
  }
  layers.push({
    type: 'text',
    id: 'message',
    content: {
      text: input.text,
      style: {
        fontSize: textFontSize,
        fontFamily: variant === 'tool' ? monoFont : bodyFont,
        fontStyle: variant === 'thought' ? 'italic' : 'normal',
        color: textColor,
        lineHeight: 1.35,
        maxLines: 7,
      },
    },
    position: {
      x: `${parseFloat(columnX) + 2}%`,
      y: variant === 'tool' && input.toolName ? '38%' : '32.5%',
      width: `${bubbleWidthPct - 4}%`,
      anchor: 'top-left',
    },
    animation: { type: 'typewriter', duration: Math.min(2.5, 0.4 + input.text.length / 120) },
  });
  if (variant === 'tool' && input.resultText) {
    layers.push({
      type: 'text',
      id: 'tool-result',
      content: {
        text: input.resultText,
        style: {
          fontSize: themedFontSize(26, context, false),
          fontFamily: monoFont,
          color: theme.colors.textMuted,
          lineHeight: 1.3,
          maxLines: 3,
        },
      },
      position: { x: columnX, y: '78%', width: `${bubbleWidthPct}%`, anchor: 'top-left' },
      animation: { type: 'fadeIn', duration: 0.4, delay: 0.3 },
    });
  }
  if (input.meta) {
    layers.push({
      type: 'text',
      id: 'meta',
      content: {
        text: input.meta,
        style: { fontSize: metaFontSize, fontFamily: bodyFont, color: theme.colors.textMuted },
      },
      position: { x: '96%', y: '94%', anchor: 'bottom-right' },
    });
  }
  return layers;
}

/** Two speakers joined by an arrow, message centered beneath. */
function handoffLayers(
  input: TranscriptBlockInput,
  context: TemplateContext,
  accent: string,
  textColor: string,
  bubbleFill: string,
): Layer[] {
  const { theme } = context;
  const bodyFont = getThemeFont(context, 'body');
  const nameFontSize = themedFontSize(28, context, false);
  const textFontSize = themedFontSize(32, context, true);
  const layers: Layer[] = [
    ...avatarLayers('speaker', input.speaker, input.speakerImage, '26%', '28%', context),
    ...avatarLayers(
      'counterpart',
      input.counterpartName ?? '',
      input.counterpartImage,
      '74%',
      '28%',
      context,
    ),
    nameLayer('speaker-name', input.speaker, '26%', nameFontSize, bodyFont, theme.colors.textMuted),
    nameLayer(
      'counterpart-name',
      input.counterpartName ?? '',
      '74%',
      nameFontSize,
      bodyFont,
      theme.colors.textMuted,
    ),
    {
      type: 'path',
      id: 'handoff-arrow',
      content: { d: 'M 0 0 L 100 0', stroke: accent, strokeWidth: 4, endMarker: 'arrow' },
      position: { x: '50%', y: '28%', width: '28%', height: '1%', anchor: 'center' },
      animation: { type: 'fadeIn', duration: 0.4, delay: 0.2 },
    },
  ];
  if (input.text.length > 0) {
    layers.push(
      {
        type: 'shape',
        id: 'bubble',
        content: { shape: 'rect', fill: bubbleFill, borderRadius: 18 },
        position: { x: '50%', y: '66%', width: '66%', height: '32%', anchor: 'center' },
        animation: { type: 'fadeIn', duration: 0.4, delay: 0.3 },
      },
      {
        type: 'text',
        id: 'message',
        content: {
          text: input.text,
          style: {
            fontSize: textFontSize,
            fontFamily: bodyFont,
            color: textColor,
            textAlign: 'center',
            lineHeight: 1.35,
            maxLines: 5,
          },
        },
        position: { x: '50%', y: '66%', width: '60%', height: '26%', anchor: 'center' },
        animation: { type: 'typewriter', duration: 2, delay: 0.4 },
      },
    );
  }
  if (input.meta) {
    layers.push({
      type: 'text',
      id: 'meta',
      content: {
        text: input.meta,
        style: {
          fontSize: themedFontSize(22, context, false),
          fontFamily: bodyFont,
          color: theme.colors.textMuted,
        },
      },
      position: { x: '96%', y: '94%', anchor: 'bottom-right' },
    });
  }
  return layers;
}

function nameLayer(
  id: string,
  text: string,
  x: string,
  fontSize: number,
  fontFamily: string,
  color: string,
): Layer {
  return {
    type: 'text',
    id,
    content: {
      text,
      style: { fontSize, fontFamily, fontWeight: 'bold', color, textAlign: 'center' },
    },
    position: { x, y: '42%', anchor: 'center' },
  };
}

/**
 * Avatar medallion: the speaker image when provided, otherwise an
 * initials circle derived from the name — transcripts must render
 * without media.
 */
function avatarLayers(
  idPrefix: string,
  name: string,
  imageSrc: string | undefined,
  x: string,
  y: string,
  context: TemplateContext,
): Layer[] {
  const { theme } = context;
  if (imageSrc) {
    return [
      {
        type: 'image',
        id: `${idPrefix}-avatar`,
        content: { src: imageSrc, alt: name, fit: 'contain' },
        position: { x, y, width: '9%', height: '16%', anchor: 'center' },
      },
    ];
  }
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return [
    {
      type: 'shape',
      id: `${idPrefix}-avatar-bg`,
      content: {
        shape: 'circle',
        fill: withAlpha(theme.colors.text, 0.1),
        stroke: theme.colors.textMuted,
        strokeWidth: 2,
      },
      position: { x, y, width: '9%', height: '16%', anchor: 'center' },
    },
    {
      type: 'text',
      id: `${idPrefix}-avatar-initials`,
      content: {
        text: initials || '?',
        style: {
          fontSize: themedFontSize(44, context, true),
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      },
      position: { x, y, width: '9%', height: '16%', anchor: 'center' },
    },
  ];
}
