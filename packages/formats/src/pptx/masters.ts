/**
 * The slide master, slide layouts and theme part for a layer-based deck.
 *
 * `backdrop.ts` decides where each slide's paint lives; this writes it:
 * native `<p:bg>` backgrounds (solid, gradient, or a photo cropped like CSS
 * `cover`), overlay paint as layout and master shapes, and a `theme1.xml`
 * carrying the deck's own colours and fonts, so PowerPoint's colour pickers,
 * Design variants and new text boxes match the deck rather than Office's
 * defaults — and an import of the export can read the theme back.
 */

import type { ImageLayer, ShapeLayer, Theme } from '@bendyline/squisq/schemas';
import { relativeLuminance } from '@bendyline/squisq/schemas';
import { NS_DRAWINGML, NS_PML, NS_R } from '../ooxml/namespaces.js';
import { escapeXml, xmlDeclaration } from '../ooxml/xmlUtils.js';
import { readImageDimensions } from '../shared/images.js';
import { toOoxmlHex } from '../shared/ooxmlColor.js';
import type { DeckLayout } from './backdrop.js';
import { buildLayerShape, fillXml, officeTypeface, patternFillXml } from './drawingXml.js';
import { DEFAULT_FONT, DEFAULT_TITLE_FONT } from './styles.js';

const GROUP_SHAPE_PROPS =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` + `<p:grpSpPr/>`;

/** A `<p:bg>` around one DrawingML fill. */
function backgroundXml(fill: string): string {
  return `<p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`;
}

/** A solid, gradient or pattern base paint as a native background. */
export function paintBackgroundXml(base: ShapeLayer): string {
  const { fill, fillOpacity, gradient, pattern } = base.content;
  return backgroundXml(
    pattern ? patternFillXml(pattern, fill) : fillXml(fill, fillOpacity, gradient),
  );
}

/** A solid background of one colour — the master's fallback. */
export function colorBackgroundXml(hex: string): string {
  return backgroundXml(`<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`);
}

/**
 * A full-bleed photo as the slide's background. `cover` crops the image to
 * the slide's 16:9 as CSS does — centred, trimming the overflowing axis —
 * so a portrait or square photo is not stretched; `fill` stretches.
 */
export function photoBackgroundXml(
  relId: string,
  layer: ImageLayer,
  data: ArrayBuffer | Uint8Array,
): string {
  let crop = '';
  const size = layer.content.fit === 'cover' ? readImageDimensions(data) : null;
  if (size && size.width > 0 && size.height > 0) {
    const imageAspect = size.width / size.height;
    const slideAspect = 16 / 9;
    if (Math.abs(imageAspect - slideAspect) > 0.001) {
      const trim =
        imageAspect > slideAspect ? 1 - slideAspect / imageAspect : 1 - imageAspect / slideAspect;
      const edge = Math.round((trim / 2) * 100000);
      crop =
        imageAspect > slideAspect
          ? `<a:srcRect l="${edge}" r="${edge}"/>`
          : `<a:srcRect t="${edge}" b="${edge}"/>`;
    }
  }
  return backgroundXml(
    `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${relId}"/>` +
      `${crop}<a:stretch><a:fillRect/></a:stretch></a:blipFill>`,
  );
}

/** Overlay paint as shapes for a layout or master `spTree`. */
function overlayShapesXml(overlays: readonly ShapeLayer[]): string {
  // Ids 1 (the group) and up are per part; overlays start after the group.
  return overlays.map((overlay, index) => buildLayerShape(overlay, index + 2)).join('');
}

/** One slide layout: an optional background and its overlay paint. */
export function buildDeckLayoutXml(layout: DeckLayout): string {
  return (
    xmlDeclaration() +
    `<p:sldLayout xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"` +
    ` preserve="1" userDrawn="1">` +
    `<p:cSld name="${escapeXml(layout.name)}">` +
    (layout.base ? paintBackgroundXml(layout.base) : '') +
    `<p:spTree>${GROUP_SHAPE_PROPS}${overlayShapesXml(layout.overlays)}</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sldLayout>`
  );
}

/** Whether a theme's background is darker than its text (`bg1` maps to a dark slot). */
export function isDarkTheme(theme: Theme): boolean {
  const background = toOoxmlHex(theme.colors.background, 'FFFFFF');
  const text = toOoxmlHex(theme.colors.text, '000000');
  return relativeLuminance(`#${background}`) < relativeLuminance(`#${text}`);
}

/**
 * The master's colour map. A dark deck maps the background roles onto the
 * dark slots (`bg1="dk1"`), as PowerPoint's own dark themes do — which is
 * also what theme inference reads back on import.
 */
function colorMapXml(dark: boolean): string {
  const roles = dark
    ? 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"'
    : 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"';
  return (
    `<p:clrMap ${roles} accent1="accent1" accent2="accent2" accent3="accent3"` +
    ` accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
  );
}

export interface DeckMasterOptions {
  /** The master's `<p:bg>`. */
  backgroundXml: string;
  overlays: readonly ShapeLayer[];
  layoutRelIds: readonly string[];
  dark: boolean;
}

/** The slide master: the deck's base background, shared atmosphere, every layout. */
export function buildDeckMasterXml(options: DeckMasterOptions): string {
  const layoutIds = options.layoutRelIds
    .map((relId, index) => `<p:sldLayoutId id="${2147483649 + index}" r:id="${relId}"/>`)
    .join('');
  return (
    xmlDeclaration() +
    `<p:sldMaster xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
    `<p:cSld>${options.backgroundXml}` +
    `<p:spTree>${GROUP_SHAPE_PROPS}${overlayShapesXml(options.overlays)}</p:spTree>` +
    `</p:cSld>` +
    colorMapXml(options.dark) +
    `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>` +
    `</p:sldMaster>`
  );
}

/**
 * `theme1.xml` from the deck's theme. The slots follow theme inference's
 * reading of them: background and text on the light/dark pair the colour
 * map points at (with `backgroundLight`/`textMuted` as their companions),
 * primary, secondary and highlight as accents 1–3, warning next, the
 * theme's colour-scheme accents after it, and the highlight as hyperlinks.
 */
export function buildDeckThemeXml(theme: Theme): string {
  const c = theme.colors;
  const hex = (color: string | undefined, fallback: string) => toOoxmlHex(color, fallback);
  const dark = isDarkTheme(theme);
  const background = hex(c.background, 'FFFFFF');
  const text = hex(c.text, '000000');
  const backgroundLight = hex(c.backgroundLight, background);
  const textMuted = hex(c.textMuted, text);
  const accents = [c.primary, c.secondary, c.highlight, c.warning]
    .concat(Object.values(theme.colorSchemes ?? {}).map((scheme) => scheme.accent))
    .map((color) => (color ? toOoxmlHex(color, '') : ''))
    .filter((color, index, all) => color && all.indexOf(color) === index);
  // PowerPoint wants all six accents; repeat the theme's own when it has fewer.
  const distinct = accents.length > 0 ? [...accents] : [text];
  for (let index = accents.length; index < 6; index++) {
    accents.push(distinct[index % distinct.length]!);
  }
  const slots: Array<[string, string]> = [
    ['dk1', dark ? background : text],
    ['lt1', dark ? text : background],
    ['dk2', dark ? backgroundLight : textMuted],
    ['lt2', dark ? textMuted : backgroundLight],
    ...accents.slice(0, 6).map((color, index): [string, string] => [`accent${index + 1}`, color]),
    ['hlink', hex(c.highlight || c.primary, '0563C1')],
    ['folHlink', textMuted],
  ];
  const name = escapeXml(theme.name || 'Squisq');
  const titleFont = escapeXml(officeTypeface(theme.typography?.titleFont, DEFAULT_TITLE_FONT));
  const bodyFont = escapeXml(officeTypeface(theme.typography?.bodyFont, DEFAULT_FONT));
  const solid = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  return (
    xmlDeclaration() +
    `<a:theme xmlns:a="${NS_DRAWINGML}" name="${name}">` +
    `<a:themeElements>` +
    `<a:clrScheme name="${name}">` +
    slots.map(([slot, color]) => `<a:${slot}><a:srgbClr val="${color}"/></a:${slot}>`).join('') +
    `</a:clrScheme>` +
    `<a:fontScheme name="${name}">` +
    `<a:majorFont><a:latin typeface="${titleFont}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${bodyFont}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="${name}">` +
    `<a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>` +
    `<a:ln w="6350">${solid}</a:ln><a:ln w="6350">${solid}</a:ln><a:ln w="6350">${solid}</a:ln>` +
    `</a:lnStyleLst>` +
    `<a:effectStyleLst>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst>` +
    `</a:fmtScheme>` +
    `</a:themeElements>` +
    `</a:theme>`
  );
}
