/**
 * Text layers as DrawingML text boxes: sized for the slideshow's grown text
 * (textFit.ts), with native list paragraphs (textLists.ts) and the player's
 * rich-text block spacing.
 */

import type { TextLayer, TextParagraph, TextStyle } from '@bendyline/squisq/schemas';
import { splitIconMarkers } from '@bendyline/squisq/icon-marker';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { fontAwesomeFace, fontAwesomeGlyph } from '../shared/fontAwesome.js';
import { fillXml, lineXml, officeTypeface, parseCssColor, solidColorXml } from './drawingXml.js';
import {
  EMU_PER_CANVAS_PX,
  resolveLayerRect,
  resolvePositionValue,
  toEmuRect,
} from './geometry.js';
import { DEFAULT_FONT } from './styles.js';
import {
  averageCharEm,
  blockGapsEm,
  estimateTextHeight,
  hasBlockGaps,
  layerParagraphs,
  LIST_INDENT_EM,
  measurableText,
} from './textFit.js';
import { listParagraphXml, planListParagraphs, type ListParagraphPlan } from './textLists.js';

export function buildLayerTextShape(
  layer: TextLayer,
  shapeId: number,
  maxBottom?: number,
  listIndentPx?: number,
  /** The slide's grow scale (see textFit.ts); the layer carries its base size. */
  textScale = 1,
): string {
  const sourceText = layer.content.text ?? '';
  const text = measurableText(sourceText);
  const baseStyle = layer.content.style;
  const style =
    textScale === 1 ? baseStyle : { ...baseStyle, fontSize: baseStyle.fontSize * textScale };
  const padding = style.padding ?? 0;
  const rawLines = text.split('\n');
  const charEm = averageCharEm(style);
  const estimatedWidth = Math.min(
    1920,
    Math.max(
      1,
      Math.max(...rawLines.map((line) => line.length), 1) *
        style.fontSize *
        // A box sized to the text must not wrap it when Office's face for
        // the CSS stack runs a little wider than the estimate.
        Math.max(0.55, charEm * 1.15) +
        padding * 2,
    ),
  );
  const boxWidth =
    layer.position.width != null
      ? resolvePositionValue(layer.position.width, 1920)
      : estimatedWidth;
  // Large one-line display titles are authored to stay on one line. Cap them
  // so the estimated advance fits the box before PowerPoint wraps one into
  // a second line that collides with the next layer.
  const fittedFontSize =
    rawLines.length === 1 && style.fontSize >= 80 && text.length > 0
      ? Math.min(style.fontSize, (boxWidth - padding * 2) / (text.length * charEm * 1.05))
      : style.fontSize;
  const blockGaps = hasBlockGaps(layer);
  const paragraphSource = layerParagraphs(layer);
  const neededHeight = Math.max(
    fittedFontSize * (style.lineHeight ?? 1.4),
    estimateTextHeight(layer, fittedFontSize / baseStyle.fontSize, listIndentPx),
  );
  // Office's line metrics are not CSS's: the first line's ascent and the
  // last line's descent can run past a box sized to the CSS line boxes
  // alone, which clips the bottom of display type at a no-autofit boundary.
  const reserve = fittedFontSize * OFFICE_TEXT_RESERVE_EM;
  const estimatedHeight = neededHeight + reserve + padding * 2;
  const resolvedRect = resolveLayerRect(layer.position, boxWidth, estimatedHeight);
  // Leave a small bottom inset for Office/LibreOffice glyph descenders and
  // antialiasing. The SVG player clips exactly at 1080; rasterizers otherwise
  // report a one-pixel bleed even when the text box itself ends on-canvas.
  const safeBottom = Math.min(1060, maxBottom ?? 1060);
  const vertical =
    style.verticalAlign === 'bottom' ? 'b' : style.verticalAlign === 'middle' ? 'ctr' : 't';
  let virtualRect = {
    ...resolvedRect,
    y: Math.min(resolvedRect.y, safeBottom - 1),
    height: Math.max(1, Math.min(resolvedRect.height, safeBottom - resolvedRect.y)),
  };
  // A box with no fill or border is invisible, so give its text the reserve
  // by growing the box away from the text's anchor — the text stays where
  // the player draws it — rather than by shrinking the type.
  const visibleBox =
    !!style.background ||
    !!style.backgroundGradient ||
    !!(style.borderColor && (style.borderWidth ?? 0) > 0);
  if (!visibleBox && virtualRect.height < estimatedHeight) {
    const extra = estimatedHeight - virtualRect.height;
    const above = vertical === 'b' ? extra : vertical === 'ctr' ? extra / 2 : 0;
    const top = Math.max(0, virtualRect.y - above);
    const bottom = Math.min(safeBottom, virtualRect.y + virtualRect.height + extra - above);
    virtualRect = { ...virtualRect, y: top, height: Math.max(virtualRect.height, bottom - top) };
  }
  // Shrink only text the estimate says cannot fit: the slide's grow scale
  // was chosen so its text fits by this same estimate, so text the player
  // shows whole is never shrunk here.
  const availableHeight = Math.max(1, virtualRect.height - padding * 2);
  const heightScale =
    neededHeight > availableHeight + FIT_TOLERANCE_PX ? availableHeight / neededHeight : 1;
  const renderedFontSize = Math.max(1, fittedFontSize * heightScale * (heightScale < 1 ? 0.95 : 1));
  const renderedStyle =
    renderedFontSize === style.fontSize ? style : { ...style, fontSize: renderedFontSize };
  const rect = toEmuRect(virtualRect);
  const align = style.textAlign === 'center' ? 'ctr' : style.textAlign === 'right' ? 'r' : 'l';
  const inset = Math.max(0, Math.round(padding * EMU_PER_CANVAS_PX));
  const bodyPr =
    `<a:bodyPr wrap="square" anchor="${vertical}" vertOverflow="clip" horzOverflow="clip"` +
    ` lIns="${inset}" rIns="${inset}" tIns="${inset}" bIns="${inset}">` +
    `<a:noAutofit/></a:bodyPr>`;
  // Rich text spaces its blocks by margins, so it takes the structured path
  // even without list items; plain text keeps one paragraph per line.
  const paragraphs =
    layer.content.paragraphs || blockGaps
      ? buildStructuredParagraphs(paragraphSource, renderedStyle, align, {
          // A list with no marker column of its own hangs its bullets by the
          // player's list indent.
          indentPx: listIndentPx ?? renderedStyle.fontSize * LIST_INDENT_EM,
          spacingScale: renderedStyle.fontSize / fittedFontSize,
          blockGaps,
        })
      : sourceText
          .split('\n')
          .map((line) => buildLayerTextParagraph(line, renderedStyle, align))
          .join('');

  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${shapeId}" name="${escapeXml(layer.id)}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/>` +
    `<a:ext cx="${rect.width}" cy="${rect.height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    fillXml(style.background, style.backgroundOpacity, style.backgroundGradient) +
    lineXml(style.borderColor, style.borderWidth, style.borderStyle) +
    `</p:spPr>` +
    `<p:txBody>${bodyPr}<a:lstStyle/>${paragraphs}</p:txBody>` +
    `</p:sp>`
  );
}

/**
 * Hundredths of a point per canvas px. The 1920px canvas spans the slide's
 * 960pt width, so one canvas px is half a point — for text sizes and
 * paragraph spacing alike.
 */
const TEXT_PX_TO_CENTIPOINTS = 50;

/**
 * PowerPoint's single line spacing is the font's own line height — about
 * 1.2em for common faces — where CSS `line-height` is a multiple of the font
 * size, so a CSS line height maps to `lnSpc` as a fraction of 1.2.
 */
const OFFICE_SINGLE_LINE_EM = 1.2;

/** Vertical room, in em, reserved beyond the CSS line boxes (see `buildLayerTextShape`). */
const OFFICE_TEXT_RESERVE_EM = 0.3;

/** Slack, in canvas px, before estimated text counts as overflowing its box. */
const FIT_TOLERANCE_PX = 1;

interface StructuredParagraphOptions {
  /** Hanging indent of a list paragraph, in canvas px. */
  indentPx: number;
  /** Factor on authored `spaceBefore`, matching a shrink of the font. */
  spacingScale: number;
  /** Space blocks by the player's rich-text margins instead of blank lines. */
  blockGaps: boolean;
}

/**
 * Native DrawingML paragraphs for a layer's structured `paragraphs`: list
 * items become real bullets or numbers with a hanging indent (see
 * textLists.ts), so Office apps treat them as a list. With `blockGaps`, a
 * run of blank paragraphs becomes space above the next block — the margin
 * the player's rich text draws there — rather than empty lines.
 */
function buildStructuredParagraphs(
  paragraphs: readonly TextParagraph[],
  style: TextStyle,
  align: string,
  options: StructuredParagraphOptions,
): string {
  const plans = planListParagraphs(paragraphs);
  const gaps = options.blockGaps ? blockGapsEm(paragraphs, style.lineHeight ?? 1.4) : undefined;
  return paragraphs
    .map((paragraph, index) => {
      const gap = gaps?.[index];
      if (gap === null) return '';
      return buildLayerTextParagraph(paragraph.text, style, align, {
        spaceBefore:
          (gap ?? 0) * style.fontSize + (paragraph.spaceBefore ?? 0) * options.spacingScale,
        list: plans[index],
        indentPx: options.indentPx,
      });
    })
    .join('');
}

interface LayerParagraphOptions {
  spaceBefore?: number;
  list?: ListParagraphPlan;
  /** Hanging indent of a list paragraph, in canvas px. */
  indentPx?: number;
}

function buildLayerTextParagraph(
  text: string,
  style: TextStyle,
  align: string,
  options: LayerParagraphOptions = {},
): string {
  const size = Math.max(100, Math.round(style.fontSize * TEXT_PX_TO_CENTIPOINTS));
  const color = parseCssColor(style.color, '000000');
  const typeface = officeTypeface(style.fontFamily, DEFAULT_FONT);
  const textRunProperties = [
    `lang="en-US"`,
    `dirty="0"`,
    `sz="${size}"`,
    ...(style.fontWeight === 'bold' ? ['b="1"'] : []),
    ...(style.fontStyle === 'italic' ? ['i="1"'] : []),
  ].join(' ');
  const lineSpacing = Math.max(
    10000,
    Math.round(((style.lineHeight ?? 1.4) / OFFICE_SINGLE_LINE_EM) * 100000),
  );
  const lineRuns = (line: string): string =>
    splitIconMarkers(line)
      .map((run) => {
        if (run.type === 'text') {
          if (!run.text) return '';
          return (
            `<a:r><a:rPr ${textRunProperties}>${solidColorXml(color)}` +
            `<a:latin typeface="${escapeXml(typeface)}"/></a:rPr>` +
            `<a:t>${escapeXml(run.text)}</a:t></a:r>`
          );
        }

        const glyph = fontAwesomeGlyph(run.family, run.name);
        if (!glyph) return '';
        const iconTypeface = fontAwesomeFace(run.family).typeface;
        return (
          `<a:r><a:rPr lang="en-US" dirty="0" sz="${size}">${solidColorXml(color)}` +
          `<a:latin typeface="${escapeXml(iconTypeface)}"/></a:rPr>` +
          `<a:t>${escapeXml(glyph)}</a:t></a:r>`
        );
      })
      .join('');
  // A `\n` inside one paragraph is a line break, not a new paragraph — a
  // new paragraph would give a list item's second line its own bullet.
  const runs = text.split('\n').map(lineRuns).join(`<a:br><a:rPr ${textRunProperties}/></a:br>`);
  const spaceBefore = Math.round((options.spaceBefore ?? 0) * TEXT_PX_TO_CENTIPOINTS);
  const { attributes, bullet } = options.list
    ? listParagraphXml(options.list, options.indentPx ?? style.fontSize * LIST_INDENT_EM)
    : { attributes: '', bullet: '' };
  return (
    `<a:p><a:pPr${attributes} algn="${align}"><a:lnSpc><a:spcPct val="${lineSpacing}"/></a:lnSpc>` +
    (spaceBefore > 0 ? `<a:spcBef><a:spcPts val="${spaceBefore}"/></a:spcBef>` : '') +
    // The bullet takes the text's colour explicitly: renderers that do not
    // follow the first run fall back to the master's default — black, which
    // vanishes on a dark deck.
    (bullet ? `<a:buClr><a:srgbClr val="${color.hex}"/></a:buClr>${bullet}` : '') +
    `</a:pPr>` +
    (runs ||
      `<a:r><a:rPr ${textRunProperties}>${solidColorXml(color)}` +
        `<a:latin typeface="${escapeXml(typeface)}"/></a:rPr><a:t> </a:t></a:r>`) +
    `</a:p>`
  );
}
