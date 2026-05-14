/**
 * Tests for markdownDocToPlainHtml — the player-free, semantic HTML export.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { markdownDocToPlainHtml } from '../html/plainHtml';

function render(md: string, options?: Parameters<typeof markdownDocToPlainHtml>[1]): string {
  return markdownDocToPlainHtml(parseMarkdown(md), options);
}

describe('markdownDocToPlainHtml', () => {
  it('wraps output in a complete HTML document', () => {
    const html = render('# Hello\n\nWorld');
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('uses the title option and escapes it', () => {
    const html = render('# x', { title: 'A <script> & more' });
    expect(html).toContain('<title>A &lt;script&gt; &amp; more</title>');
  });

  it('renders headings at the correct depth', () => {
    const html = render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six');
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<h2>Two</h2>');
    expect(html).toContain('<h3>Three</h3>');
    expect(html).toContain('<h4>Four</h4>');
    expect(html).toContain('<h5>Five</h5>');
    expect(html).toContain('<h6>Six</h6>');
  });

  it('renders paragraphs, emphasis, strong, and links', () => {
    const html = render('A *b* **c** [link](https://example.com).');
    expect(html).toContain('<p>A <em>b</em> <strong>c</strong> <a href="https://example.com">link</a>.</p>');
  });

  it('renders ordered and unordered lists', () => {
    const html = render('- one\n- two\n\n1. first\n2. second');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('<ol>');
  });

  it('emits start attribute on ordered lists with non-default start', () => {
    const html = render('3. third\n4. fourth');
    expect(html).toContain('<ol start="3">');
  });

  it('renders fenced code blocks with a language class', () => {
    const html = render('```ts\nconst x = 1;\n```');
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  it('escapes HTML characters inside code blocks', () => {
    const html = render('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders blockquotes and thematic breaks', () => {
    const html = render('> quoted\n\n---\n\nafter');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr />');
  });

  it('renders GFM tables', () => {
    const html = render('| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>H1</th>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<td>a</td>');
  });

  it('renders markdown images with src and alt', () => {
    const html = render('![cat](cat.jpg)');
    expect(html).toContain('<img src="cat.jpg" alt="cat" />');
  });

  it('substitutes image URLs through the images map', () => {
    const html = render('![cat](cat.jpg)', {
      images: new Map([['cat.jpg', 'blob:http://x/abcd']]),
    });
    expect(html).toContain('src="blob:http://x/abcd"');
    expect(html).not.toContain('src="cat.jpg"');
  });

  it('passes URLs not in the images map through unchanged', () => {
    const html = render('![ext](https://example.com/x.jpg)', {
      images: new Map([['cat.jpg', 'unused']]),
    });
    expect(html).toContain('src="https://example.com/x.jpg"');
  });

  it('rewrites raw HTML <img src> through the images map (resize round-trip)', () => {
    // The WYSIWYG editor serializes resized images as raw HTML because
    // markdown shorthand has no width syntax. The renderer must walk
    // the parsed htmlChildren so those images preview correctly.
    const html = render('<img alt="resized" src="resized.png" width="194">', {
      images: new Map([['resized.png', 'blob:http://x/resized']]),
    });
    expect(html).toContain('src="blob:http://x/resized"');
    expect(html).toContain('width="194"');
    expect(html).not.toContain('src="resized.png"');
  });

  it('escapes quotes in href and src attributes', () => {
    const html = render('![a](a"b.jpg)\n\n[c](d"e)');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('src="a"b.jpg"');
  });

  describe('feature template annotations', () => {
    it('renders {[leftFeature]} headings as a two-column section with image left', () => {
      const md = [
        '# Mike Ammerlaan {[leftFeature]}',
        '',
        '![mike](mike.jpg)',
        '',
        'Builder of platforms.',
        '',
        '## Other section',
        '',
        'Unrelated.',
      ].join('\n');
      const html = render(md);
      expect(html).toContain('<section class="squisq-feature squisq-feature--left">');
      expect(html).toContain('<div class="squisq-feature__media"><img src="mike.jpg"');
      expect(html).toContain('<h1>Mike Ammerlaan</h1>');
      expect(html).toContain('<p>Builder of platforms.</p>');
      // Closing section before the next heading
      expect(html).toContain('</section>');
      // Next heading lives OUTSIDE the section
      const sectionClose = html.indexOf('</section>');
      const otherHeading = html.indexOf('<h2>Other section');
      expect(sectionClose).toBeLessThan(otherHeading);
    });

    it('renders {[rightFeature]} with image on the right (row-reverse class)', () => {
      const html = render('## Projects {[rightFeature]}\n\n![p](p.png)\n\nList of stuff.');
      expect(html).toContain('squisq-feature--right');
      expect(html).toContain('<img src="p.png"');
    });

    it('keeps the image out of the body column to avoid double-rendering', () => {
      const html = render('# Hello {[leftFeature]}\n\n![h](h.jpg)\n\nText body.');
      // Exactly one <img>
      expect(html.match(/<img /g)?.length).toBe(1);
    });

    it('still emits feature CSS when no feature blocks are present', () => {
      // The CSS is part of the doc shell so themes pick up the rules
      // when authored content adds a feature later; presence is fine.
      const html = render('# Plain doc');
      expect(html).toContain('.squisq-feature {');
    });

    it('handles raw HTML <img> as the feature image (resized round-trip)', () => {
      const md = [
        '# Mike {[rightFeature]}',
        '',
        '<img alt="m" src="m.jpg" width="194">',
        '',
        'Body.',
      ].join('\n');
      const html = render(md);
      expect(html).toContain('squisq-feature--right');
      expect(html).toContain('<img src="m.jpg"');
    });

    it('forwards explicit width/height on the feature image so CSS can center it', () => {
      const md = '# Mike {[leftFeature]}\n\n<img alt="m" src="m.jpg" width="194" height="220">\n\nBody.';
      const html = render(md);
      // The media wrapper gets a "sized" modifier class that the CSS
      // uses to switch from stretch-to-fill to center-with-padding.
      expect(html).toContain('squisq-feature__media--sized');
      // And the image element carries the original dimensions.
      expect(html).toContain('width="194"');
      expect(html).toContain('height="220"');
    });

    it('omits the sized modifier on the media div when the image has no explicit dims', () => {
      // The `--sized` class lives in the embedded stylesheet regardless
      // (so future feature blocks get styled correctly). What we care
      // about here is that no `<div class="squisq-feature__media …--sized">`
      // is emitted for an un-resized image.
      const html = render('# Mike {[leftFeature]}\n\n![m](m.jpg)\n\nBody.');
      expect(html).toMatch(/<div class="squisq-feature__media"><img /);
      expect(html).not.toMatch(/<div class="squisq-feature__media[^"]*--sized/);
      expect(html).not.toMatch(/<img [^>]*width=/);
    });

    it('substitutes feature image src through the images map', () => {
      const md = '# Mike {[leftFeature]}\n\n![m](mike.jpg)\n\nText.';
      const html = render(md, { images: new Map([['mike.jpg', 'data:image/png;base64,AAA']]) });
      expect(html).toContain('src="data:image/png;base64,AAA"');
      expect(html).not.toContain('src="mike.jpg"');
    });

    it('falls back gracefully when a feature heading has no image', () => {
      const html = render('# Just Words {[leftFeature]}\n\nNo image here.');
      expect(html).toContain('squisq-feature--left');
      expect(html).toContain('squisq-feature__media--empty');
      expect(html).toContain('<p>No image here.</p>');
    });

    it('section ends at the next heading of any depth', () => {
      // A feature is intentionally short — first body chunk only. Any
      // following heading (even a deeper H3) closes the section so
      // headings don't end up inside the side-by-side layout where
      // they'd render awkwardly.
      const md = [
        '## Mike {[leftFeature]}',
        '',
        '![m](m.jpg)',
        '',
        'first paragraph',
        '',
        '### Sub',
        '',
        'outside section',
      ].join('\n');
      const html = render(md);
      const sectionClose = html.indexOf('</section>');
      const subHeading = html.indexOf('<h3>Sub');
      expect(sectionClose).toBeLessThan(subHeading);
    });
  });

  describe('inline FontAwesome icons', () => {
    it('renders an inline icon as <i class="fa-brands fa-github">', () => {
      const html = render('Built with {[github]}');
      expect(html).toContain('<i class="fa-brands fa-github"');
      expect(html).toContain('data-icon="github"');
    });

    it('emits the FontAwesome CDN <link> when any icon is present', () => {
      const html = render('Hello {[github]} world');
      expect(html).toContain('href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/');
      expect(html).toContain('integrity="sha512-');
    });

    it('omits the FontAwesome <link> when no icons appear', () => {
      const html = render('# Just text\n\nNo icons here.');
      expect(html).not.toContain('font-awesome');
    });

    it('renders qualified tokens with the correct family', () => {
      const html = render('{[fa-solid:user]}');
      expect(html).toContain('<i class="fa-solid fa-user"');
      expect(html).toContain('data-icon="fa-solid:user"');
    });
  });

  describe('with a theme', () => {
    it('embeds the theme colors as CSS custom properties', () => {
      const theme = resolveTheme('warm-earth');
      const html = render('# Hello', { theme });
      expect(html).toContain(`--plain-bg: ${theme.colors.background};`);
      expect(html).toContain(`--plain-text: ${theme.colors.text};`);
      expect(html).toContain(`--plain-primary: ${theme.colors.primary};`);
    });

    it('resolves the theme typography to CSS family strings', () => {
      const theme = resolveTheme('documentary');
      const html = render('# Hello', { theme });
      // documentary uses playfair (title) + source-serif (body)
      expect(html).toContain('--plain-title-font: "Playfair Display"');
      expect(html).toContain('--plain-body-font: "Source Serif 4"');
    });

    it('emits a Google Fonts <link> for themes that reference google-hosted faces', () => {
      const theme = resolveTheme('documentary');
      const html = render('# Hello', { theme });
      expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">');
      expect(html).toContain('https://fonts.googleapis.com/css2?');
      expect(html).toContain('family=Playfair+Display:wght@400;700');
      expect(html).toContain('family=Source+Serif+4:wght@400;700');
      expect(html).toContain('display=swap');
    });

    it('omits the Google Fonts <link> for themes that use only system stacks', () => {
      const theme = resolveTheme('standard');
      const html = render('# Hello', { theme });
      expect(html).not.toContain('fonts.googleapis.com');
    });

    it('uses default styles when no theme is provided', () => {
      const html = render('# Hello');
      expect(html).not.toContain('--plain-bg');
      expect(html).not.toContain('fonts.googleapis.com');
      expect(html).toContain('system-ui');
    });
  });
});
