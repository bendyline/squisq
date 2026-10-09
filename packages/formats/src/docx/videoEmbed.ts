/**
 * Word "Online Video" ↔ the paragraph-that-is-only-a-link video form.
 *
 * Word stores an online video as an ordinary inline picture (the poster frame)
 * whose blip carries a `wp15:webVideoPr` extension holding the provider's
 * `<iframe>` embed code ([MS-ODRAWXML] 2.19), plus a click hyperlink to the
 * video's page. Word plays the embed in place; every other reader shows the
 * picture, and the hyperlink still opens the video.
 *
 * Export writes that structure from a validated `VideoEmbed` (the embed code is
 * rebuilt, never copied from the source). Import recognizes `webVideoPr` by
 * local name wherever it sits and parses its embed code through core's
 * provider allowlist, so an unrecognized or hostile embed is never trusted.
 */

import {
  parseVideoEmbedInput,
  parseVideoEmbedUrl,
  type VideoEmbed,
} from '@bendyline/squisq/markdown';
import { NS_R } from '../ooxml/namespaces.js';
import { escapeXml } from '../ooxml/xmlUtils.js';

/** Word 2013's wordprocessingDrawing namespace, home of `webVideoPr`. */
export const NS_WP15 = 'http://schemas.microsoft.com/office/word/2012/wordprocessingDrawing';
/**
 * The `a:ext` URI under which Word stores `wp15:webVideoPr` in a blip's
 * extension list. A reader that does not know it skips the extension and
 * shows the poster picture with its hyperlink.
 */
export const WEB_VIDEO_EXT_URI = '{C809E66F-F1BF-436E-B5F7-EEA9579F0CBA}';

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const EMU_PER_INCH = 914400;

export interface WordVideoDrawingParts {
  embed: VideoEmbed;
  title: string | null;
  /** Relationship id of the poster picture. */
  imageRelId: string;
  /** Relationship id of the hyperlink to the video's page, if one was allowed. */
  linkRelId: string | null;
  /** Unique `wp:docPr` id. */
  docPrId: number;
  /** The `<iframe>` embed code Word plays (see `officeVideoEmbedHtml`). */
  embeddedHtml: string;
}

/**
 * Display size: the full 6 in content width at 16:9, or a 5 in tall 9:16
 * frame for a Shorts video. Also the embed's pixel size for `webVideoPr`.
 */
export function wordVideoSize(embed: VideoEmbed): {
  cx: number;
  cy: number;
  pixelWidth: number;
  pixelHeight: number;
} {
  if (embed.aspectRatio < 1) {
    return {
      cx: Math.round(5 * EMU_PER_INCH * embed.aspectRatio),
      cy: 5 * EMU_PER_INCH,
      pixelWidth: 315,
      pixelHeight: 560,
    };
  }
  return {
    cx: 6 * EMU_PER_INCH,
    cy: Math.round((6 * EMU_PER_INCH) / embed.aspectRatio),
    pixelWidth: 560,
    pixelHeight: 315,
  };
}

/** The `<w:r><w:drawing>` run for a Word online video. */
export function buildWordVideoRun(parts: WordVideoDrawingParts): string {
  const { embed, title, imageRelId, linkRelId, docPrId, embeddedHtml } = parts;
  const { cx, cy, pixelWidth, pixelHeight } = wordVideoSize(embed);
  const name = escapeXml(`${embed.providerName} video ${docPrId}`);
  const descr = escapeXml(title || `${embed.providerName} video`);
  const link = linkRelId ? `<a:hlinkClick xmlns:a="${NS_A}" r:id="${linkRelId}"/>` : '';
  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="${name}" descr="${descr}">${link}</wp:docPr>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}">` +
    `<a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="0" name="${name}" descr="${descr}">${link}</pic:cNvPr>` +
    `<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${imageRelId}">` +
    `<a:extLst><a:ext uri="${WEB_VIDEO_EXT_URI}">` +
    `<wp15:webVideoPr xmlns:wp15="${NS_WP15}" embeddedHtml="${escapeXml(embeddedHtml)}"` +
    ` h="${pixelHeight}" w="${pixelWidth}"/>` +
    `</a:ext></a:extLst>` +
    `</a:blip>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing></w:r>`
  );
}

/** A provider's stock or empty title is not an author's label. */
const GENERIC_TITLE_RE = /^(?:(?:[\w .-]+[ -])?(?:video[ -])?player|video|online video|picture)$/i;

function firstDescendant(el: Element, localName: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.localName === localName) return child;
    const found = firstDescendant(child, localName);
    if (found) return found;
  }
  return null;
}

/**
 * The hosted video a Word drawing holds, or null: its `webVideoPr` embed code
 * must name a supported provider. When the embed code is unreadable, a click
 * hyperlink to a video page (resolved by the caller) is the fallback. The
 * title comes from the picture's `title`/`descr`, then the iframe's own.
 */
export function readWordVideo(
  drawing: Element,
  resolveHyperlink: (relId: string) => string | null,
): { embed: VideoEmbed; title: string | null } | null {
  const webVideo = firstDescendant(drawing, 'webVideoPr');
  if (!webVideo) return null;

  const fromHtml = parseVideoEmbedInput(webVideo.getAttribute('embeddedHtml') ?? '');
  const click = firstDescendant(drawing, 'hlinkClick');
  const relId = click?.getAttributeNS(NS_R, 'id') || click?.getAttribute('r:id') || null;
  const fromLink = parseVideoEmbedUrl(relId ? resolveHyperlink(relId) : null);
  // The page link is the more specific of the two when both name the same
  // video (a Shorts page, a start time), and the fallback when the embed code
  // is unreadable. A link to a DIFFERENT video never overrides the embed.
  const embed =
    fromLink &&
    (!fromHtml ||
      (fromLink.provider === fromHtml.embed.provider && fromLink.id === fromHtml.embed.id))
      ? fromLink
      : (fromHtml?.embed ?? null);
  if (!embed) return null;

  const docPr = firstDescendant(drawing, 'docPr');
  const candidates = [docPr?.getAttribute('title'), docPr?.getAttribute('descr'), fromHtml?.title];
  const title =
    candidates
      .map((value) => value?.trim() ?? '')
      .find(
        (value) =>
          value &&
          !GENERIC_TITLE_RE.test(value) &&
          value.toLowerCase() !== `${embed!.providerName} video`.toLowerCase() &&
          parseVideoEmbedUrl(value) === null,
      ) ?? null;
  return { embed, title };
}
