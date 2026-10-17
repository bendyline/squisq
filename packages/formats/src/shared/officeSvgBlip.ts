/**
 * An SVG picture in DrawingML, the way Office 2016+ writes an inserted SVG.
 *
 * DrawingML has no SVG blip of its own: the picture's `<a:blip>` must embed a
 * raster, which every reader can show, and Office records the SVG in the
 * blip's extension list under {@link SVG_BLIP_EXT_URI}. Word, PowerPoint
 * (desktop 2016+ and web) and LibreOffice draw the SVG; older readers skip
 * the extension and show the raster.
 */

/** The `a:ext` URI under which Office records an SVG alternative to a blip. */
export const SVG_BLIP_EXT_URI = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
/** Namespace of `asvg:svgBlip`. */
export const NS_ASVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';

/** `<a:blip>` for a raster part, with an SVG alternative when one is given. */
export function blipXml(rasterRelId: string, svgRelId?: string): string {
  if (!svgRelId) return `<a:blip r:embed="${rasterRelId}"/>`;
  return (
    `<a:blip r:embed="${rasterRelId}"><a:extLst><a:ext uri="${SVG_BLIP_EXT_URI}">` +
    `<asvg:svgBlip xmlns:asvg="${NS_ASVG}" r:embed="${svgRelId}"/>` +
    `</a:ext></a:extLst></a:blip>`
  );
}
