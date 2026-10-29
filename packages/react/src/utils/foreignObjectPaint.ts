/**
 * foreignObjectPaint
 *
 * WebKit (Safari, every browser on iOS, and WKWebView apps such as Capacitor
 * shells) paints an HTML element that gets its own compositing layer inside an
 * SVG `<foreignObject>` without the SVG's viewBox scale. A running CSS
 * transform animation is enough to get one. A 1920×1080 slide shown 620px wide
 * then draws such an element at 1920 CSS pixels, so the frame shows only its
 * top-left corner: for a Ken Burns photo, mostly sky. It also covers the
 * layers above it. Static HTML in a foreignObject (no compositing layer) scales
 * correctly, and so do SVG-native elements running the same CSS animation.
 *
 * Layers that animate HTML inside a foreignObject ask
 * `paintsForeignObjectLayersUnscaled()` and draw with SVG-native elements
 * where it returns true (ImageLayer's Ken Burns branch). Other engines keep
 * the HTML path, which composites smoothly in Chromium and is what headless
 * video export captures.
 *
 * There is no feature test for a paint bug, so this reads the user agent.
 * Every Chromium build (Chrome, Edge, Samsung Internet, Android WebView,
 * Electron) carries "Chrome/". jsdom also claims AppleWebKit, and tests expect
 * the default markup, so it is excluded too.
 *
 * Related: layers/ImageLayer.tsx, __tests__/ImageLayer.test.tsx.
 */

/** Whether this engine draws composited HTML inside `<foreignObject>` unscaled (WebKit). */
export function paintsForeignObjectLayersUnscaled(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(Chrome|Chromium|jsdom)\/|Android/.test(userAgent);
}
