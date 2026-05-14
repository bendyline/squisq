import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { PlainHtmlPreview } from '../PlainHtmlPreview';

function getIframeSrcDoc(): string {
  const iframe = screen.getByTestId('plain-html-preview') as HTMLIFrameElement;
  return iframe.srcdoc;
}

describe('PlainHtmlPreview', () => {
  it('renders the markdown into the iframe srcDoc', () => {
    render(<PlainHtmlPreview markdown={'# Hello\n\nWorld'} />);
    const srcdoc = getIframeSrcDoc();
    expect(srcdoc).toContain('<!DOCTYPE html>');
    expect(srcdoc).toContain('<h1>Hello</h1>');
    expect(srcdoc).toContain('<p>World</p>');
  });

  it('refuses scripts via sandbox attribute (allow-same-origin only)', () => {
    render(<PlainHtmlPreview markdown={'hi'} />);
    const iframe = screen.getByTestId('plain-html-preview') as HTMLIFrameElement;
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-scripts');
  });

  it('applies pre-resolved images via the images prop', () => {
    render(
      <PlainHtmlPreview
        markdown={'![a](a.jpg)'}
        images={new Map([['a.jpg', 'data:image/png;base64,AAA']])}
      />,
    );
    expect(getIframeSrcDoc()).toContain('src="data:image/png;base64,AAA"');
  });

  it('resolves image URLs through the supplied mediaProvider', async () => {
    const provider: MediaProvider = {
      resolveUrl: vi.fn(async (ref: string) => `blob:resolved/${ref}`),
      listMedia: vi.fn(async () => []),
      addMedia: vi.fn(async () => ''),
      removeMedia: vi.fn(async () => {}),
      dispose: vi.fn(() => {}),
    };
    render(<PlainHtmlPreview markdown={'![a](cat.jpg)'} mediaProvider={provider} />);
    await waitFor(() => {
      expect(getIframeSrcDoc()).toContain('src="blob:resolved/cat.jpg"');
    });
    expect(provider.resolveUrl).toHaveBeenCalledWith('cat.jpg');
  });

  it('does not resolve external URLs through the provider', async () => {
    const provider: MediaProvider = {
      resolveUrl: vi.fn(async (ref: string) => `blob:should-not-fire/${ref}`),
      listMedia: vi.fn(async () => []),
      addMedia: vi.fn(async () => ''),
      removeMedia: vi.fn(async () => {}),
      dispose: vi.fn(() => {}),
    };
    render(
      <PlainHtmlPreview
        markdown={'![ext](https://example.com/x.jpg)'}
        mediaProvider={provider}
      />,
    );
    await waitFor(() => {
      expect(getIframeSrcDoc()).toContain('src="https://example.com/x.jpg"');
    });
    expect(provider.resolveUrl).not.toHaveBeenCalled();
  });

  it('applies the supplied theme to the iframe document', () => {
    const theme = resolveTheme('warm-earth');
    render(<PlainHtmlPreview markdown={'# Hi'} theme={theme} />);
    const srcdoc = getIframeSrcDoc();
    expect(srcdoc).toContain(`--plain-bg: ${theme.colors.background};`);
    expect(srcdoc).toContain(`--plain-primary: ${theme.colors.primary};`);
    expect(srcdoc).toContain('--plain-body-font:');
  });

  it('loads Google Fonts for themes that reference google-hosted faces', () => {
    const theme = resolveTheme('documentary');
    render(<PlainHtmlPreview markdown={'# Hi'} theme={theme} />);
    expect(getIframeSrcDoc()).toContain('https://fonts.googleapis.com/css2?');
  });

  it('resolves raw HTML <img> tags too (resized image case)', async () => {
    // Resized images round-trip through the markdown source as raw
    // HTML, which the preview must scan to keep the iframe's <img>
    // pointing at a fetchable blob URL.
    const provider: MediaProvider = {
      resolveUrl: vi.fn(async (ref: string) => `blob:r/${ref}`),
      listMedia: vi.fn(async () => []),
      addMedia: vi.fn(async () => ''),
      removeMedia: vi.fn(async () => {}),
      dispose: vi.fn(() => {}),
    };
    render(
      <PlainHtmlPreview
        markdown={'<img alt="resized" src="resized.png" width="194">'}
        mediaProvider={provider}
      />,
    );
    await waitFor(() => {
      expect(getIframeSrcDoc()).toContain('src="blob:r/resized.png"');
    });
  });
});
