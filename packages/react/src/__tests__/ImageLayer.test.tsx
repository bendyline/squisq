import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ImageLayer } from '../layers/ImageLayer';
import { paintsForeignObjectLayersUnscaled } from '../utils/foreignObjectPaint';
import type { ImageLayer as ImageLayerType } from '@bendyline/squisq/schemas';

const viewport = { width: 1920, height: 1080 };

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iosAppWebView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QuallaApp',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.79 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 15; SM-S947U Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.89 Mobile Safari/537.36 QuallaApp',
  electron:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Qualla/1.0.0 Chrome/138.0.7204.35 Electron/37.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0',
  jsdom: 'Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0',
};

function kenBurnsLayer(): ImageLayerType {
  return {
    id: 'hero',
    type: 'image',
    position: { x: 0, y: 0, width: '100%', height: '100%' },
    content: { src: 'hero.jpg', alt: 'Tacoma Dome', fit: 'cover' },
    animation: { type: 'slowZoom', direction: 'in', duration: 8 },
  };
}

function renderLayer(layer: ImageLayerType) {
  const { container } = render(
    <svg viewBox="0 0 1920 1080">
      <ImageLayer layer={layer} basePath="/media" viewport={viewport} blockTime={2} />
    </svg>,
  );
  return container;
}

describe('paintsForeignObjectLayersUnscaled', () => {
  it('is true for WebKit: Safari, every iOS browser and WKWebView apps', () => {
    for (const ua of [UA.iphoneSafari, UA.iosAppWebView, UA.iosChrome, UA.macSafari]) {
      expect(paintsForeignObjectLayersUnscaled(ua), ua).toBe(true);
    }
  });

  it('is false for Chromium builds, Firefox and jsdom', () => {
    for (const ua of [UA.desktopChrome, UA.androidWebView, UA.electron, UA.firefox, UA.jsdom]) {
      expect(paintsForeignObjectLayersUnscaled(ua), ua).toBe(false);
    }
  });
});

describe('ImageLayer Ken Burns', () => {
  afterEach(() => vi.restoreAllMocks());

  it('animates an <img> inside a foreignObject by default', () => {
    const container = renderLayer(kenBurnsLayer());
    const img = container.querySelector('foreignObject img');
    expect(img?.getAttribute('class')).toBe('anim-slowZoom-in');
    expect(container.querySelector('[data-image-framing="svg-ken-burns"]')).toBeNull();
  });

  it('animates an SVG <image> on WebKit, clipped to the layer box', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(UA.iphoneSafari);
    const container = renderLayer(kenBurnsLayer());
    expect(container.querySelector('foreignObject')).toBeNull();

    const clip = container.querySelector('[data-image-framing="svg-ken-burns"] > svg')!;
    expect(clip.getAttribute('width')).toBe('1920');
    expect(clip.getAttribute('height')).toBe('1080');
    expect((clip as SVGElement).style.overflow).toBe('hidden');

    const image = clip.querySelector('image')!;
    expect(image.getAttribute('href')).toBe('/media/hero.jpg');
    expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    expect(image.getAttribute('class')).toBe('anim-slowZoom-in');
    expect(image.getAttribute('aria-label')).toBe('Tacoma Dome');
    // Scale about the image's own centre, as the <img> did.
    expect(image.style.transformBox).toBe('fill-box');
    expect(image.style.transformOrigin).toBe('center center');
  });

  it('keeps still cover images in the foreignObject on WebKit', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(UA.iphoneSafari);
    const container = renderLayer({ ...kenBurnsLayer(), animation: undefined });
    expect(container.querySelector('foreignObject img')).not.toBeNull();
  });
});
