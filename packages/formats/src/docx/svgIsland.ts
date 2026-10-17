/**
 * SVG islands (```svg fences) in Word.
 *
 * An island exports as an inline picture the way Word 2016+ writes an
 * inserted SVG (see `shared/officeSvgBlip.ts`): a PNG blip — the host's
 * rasterization when supplied, else a generated stand-in — carrying the
 * sanitized SVG as an extension, so Word draws vector art and older readers
 * still show a picture. The SVG part is core's re-serialization, never the
 * author's markup.
 */

import { escapeXml } from '../ooxml/xmlUtils.js';
import { blipXml } from '../shared/officeSvgBlip.js';

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const EMU_PER_INCH = 914400;
/** The 6 in text column, and 8 in so a tall picture stays on one page. */
const MAX_WIDTH_EMU = 6 * EMU_PER_INCH;
const MAX_HEIGHT_EMU = 8 * EMU_PER_INCH;

export interface WordSvgIslandParts {
  /** Relationship id of the PNG fallback. */
  pngRelId: string;
  /** Relationship id of the SVG part. */
  svgRelId: string;
  docPrId: number;
  /** Intrinsic size in CSS pixels (96 per inch). */
  width: number;
  height: number;
  alt: string;
}

/** A paragraph holding the island as an inline picture at its intrinsic size. */
export function buildWordSvgIslandParagraph(parts: WordSvgIslandParts): string {
  let cx = (parts.width / 96) * EMU_PER_INCH;
  let cy = (parts.height / 96) * EMU_PER_INCH;
  const scale = Math.min(1, MAX_WIDTH_EMU / cx, MAX_HEIGHT_EMU / cy);
  cx = Math.max(1, Math.round(cx * scale));
  cy = Math.max(1, Math.round(cy * scale));
  const alt = escapeXml(parts.alt);
  return (
    `<w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${parts.docPrId}" name="${alt}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}">` +
    `<a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill>${blipXml(parts.pngRelId, parts.svgRelId)}` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r></w:p>`
  );
}
