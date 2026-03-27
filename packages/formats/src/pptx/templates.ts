/**
 * PPTX Boilerplate Templates
 *
 * Minimal but valid XML templates for the required PPTX support parts:
 * slide master, slide layout, and theme. These are semi-static — they
 * don't change per-document but are required for PowerPoint to open the file.
 */

import { xmlDeclaration } from '../ooxml/xmlUtils.js';
import { NS_PML, NS_DRAWINGML, NS_R } from '../ooxml/namespaces.js';
import {
  SLIDE_WIDTH,
  SLIDE_HEIGHT,
  TITLE_LEFT,
  TITLE_TOP,
  TITLE_WIDTH,
  TITLE_HEIGHT,
  BODY_LEFT,
  BODY_TOP,
  BODY_WIDTH,
  BODY_HEIGHT,
} from './styles.js';

/**
 * Build presentation.xml — the root document listing all slides.
 */
export function buildPresentationXml(
  slideCount: number,
  slideRelIds: string[],
  slideMasterRelId: string,
  _themeRelId: string,
): string {
  const sldIdList: string[] = [];
  for (let i = 0; i < slideCount; i++) {
    // Slide IDs start at 256 (PowerPoint convention)
    sldIdList.push(`<p:sldId id="${256 + i}" r:id="${slideRelIds[i]}"/>`);
  }

  return (
    xmlDeclaration() +
    `<p:presentation xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"` +
    ` saveSubsetFonts="1">` +
    `<p:sldMasterIdLst>` +
    `<p:sldMasterId id="2147483648" r:id="${slideMasterRelId}"/>` +
    `</p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIdList.join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}" type="screen4x3"/>` +
    `<p:notesSz cx="${SLIDE_HEIGHT}" cy="${SLIDE_WIDTH}"/>` +
    `</p:presentation>`
  );
}

/**
 * Build a minimal slide master (slideMaster1.xml).
 */
export function buildSlideMasterXml(layoutRelId: string): string {
  return (
    xmlDeclaration() +
    `<p:sldMaster xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}">` +
    `<p:cSld>` +
    `<p:bg>` +
    `<p:bgRef idx="1001">` +
    `<a:schemeClr val="bg1"/>` +
    `</p:bgRef>` +
    `</p:bg>` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"` +
    ` accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4"` +
    ` accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst>` +
    `<p:sldLayoutId id="2147483649" r:id="${layoutRelId}"/>` +
    `</p:sldLayoutIdLst>` +
    `</p:sldMaster>`
  );
}

/**
 * Build a minimal slide layout (slideLayout1.xml) — title + content.
 */
export function buildSlideLayoutXml(_masterRelId: string): string {
  return (
    xmlDeclaration() +
    `<p:sldLayout xmlns:a="${NS_DRAWINGML}" xmlns:r="${NS_R}" xmlns:p="${NS_PML}"` +
    ` type="obj" preserve="1">` +
    `<p:cSld name="Title and Content">` +
    `<p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    // Title placeholder
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="2" name="Title 1"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph type="title"/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${TITLE_LEFT}" y="${TITLE_TOP}"/>` +
    `<a:ext cx="${TITLE_WIDTH}" cy="${TITLE_HEIGHT}"/></a:xfrm>` +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>` +
    `</p:sp>` +
    // Content placeholder
    `<p:sp>` +
    `<p:nvSpPr>` +
    `<p:cNvPr id="3" name="Content 2"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr><p:ph idx="1"/></p:nvPr>` +
    `</p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${BODY_LEFT}" y="${BODY_TOP}"/>` +
    `<a:ext cx="${BODY_WIDTH}" cy="${BODY_HEIGHT}"/></a:xfrm>` +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>` +
    `</p:sp>` +
    `</p:spTree>` +
    `</p:cSld>` +
    `</p:sldLayout>`
  );
}

/**
 * Build a minimal DrawingML theme (theme1.xml).
 */
export function buildThemeXml(): string {
  return (
    xmlDeclaration() +
    `<a:theme xmlns:a="${NS_DRAWINGML}" name="Office Theme">` +
    `<a:themeElements>` +
    // Color scheme
    `<a:clrScheme name="Office">` +
    `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
    `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="44546A"/></a:dk2>` +
    `<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="4472C4"/></a:accent1>` +
    `<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
    `<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>` +
    `<a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
    `<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>` +
    `<a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="0563C1"/></a:hlink>` +
    `<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
    `</a:clrScheme>` +
    // Font scheme
    `<a:fontScheme name="Office">` +
    `<a:majorFont>` +
    `<a:latin typeface="Calibri Light"/>` +
    `<a:ea typeface=""/>` +
    `<a:cs typeface=""/>` +
    `</a:majorFont>` +
    `<a:minorFont>` +
    `<a:latin typeface="Calibri"/>` +
    `<a:ea typeface=""/>` +
    `<a:cs typeface=""/>` +
    `</a:minorFont>` +
    `</a:fontScheme>` +
    // Format scheme (minimal)
    `<a:fmtScheme name="Office">` +
    `<a:fillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `</a:fillStyleLst>` +
    `<a:lnStyleLst>` +
    `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `</a:lnStyleLst>` +
    `<a:effectStyleLst>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `<a:effectStyle><a:effectLst/></a:effectStyle>` +
    `</a:effectStyleLst>` +
    `<a:bgFillStyleLst>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
    `</a:bgFillStyleLst>` +
    `</a:fmtScheme>` +
    `</a:themeElements>` +
    `</a:theme>`
  );
}
