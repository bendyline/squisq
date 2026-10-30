/**
 * Tests for HTML page templates — filling an author's page with a rendered
 * document through standard `<slot>` elements.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  HTML_PAGE_TEMPLATE_CONTENT_END,
  HTML_PAGE_TEMPLATE_CONTENT_START,
  HtmlPageTemplateError,
  applyHtmlPageTemplate,
  extractHtmlPageTemplateContent,
  inspectHtmlPageTemplate,
  isHtmlPageTemplate,
} from '../html/pageTemplate';
import { markdownDocToPlainHtml, markdownDocToPlainHtmlParts } from '../html/plainHtml';
import { htmlToMarkdownDocSync } from '../html/import';

const BLOG_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title><slot name="title">Post</slot> · My Blog</title>
  <meta name="description" content="A blog">
  <meta property="og:title" content="">
  <link rel="stylesheet" href="../css/site.css">
  <!-- analytics -->
  <script src="../js/site.js"></script>
</head>
<body>
  <header><a href="../index.html">My Blog</a> <a href="../">Home</a></header>
  <article>
    <h1><slot name="title">Post title</slot></h1>
    <time><slot name="date">Undated</slot></time>
    <slot>Post content goes here.</slot>
  </article>
  <footer><img src="../img/logo.png" srcset="../img/logo.png 1x, ../img/logo@2x.png 2x"></footer>
</body>
</html>
`;

function fill(
  template: string,
  content: Partial<Parameters<typeof applyHtmlPageTemplate>[1]> = {},
  options: Parameters<typeof applyHtmlPageTemplate>[2] = {},
): string {
  return applyHtmlPageTemplate(
    template,
    { bodyHtml: '<p>Body</p>', title: 'Hello', ...content },
    options,
  );
}

describe('isHtmlPageTemplate', () => {
  it('recognizes a page with a light-DOM slot', () => {
    expect(isHtmlPageTemplate(BLOG_TEMPLATE)).toBe(true);
    expect(isHtmlPageTemplate('<main><slot/></main>')).toBe(true);
  });

  it('ignores ordinary pages and shadow-tree slots', () => {
    expect(isHtmlPageTemplate('<!doctype html><p>Hello</p>')).toBe(false);
    expect(
      isHtmlPageTemplate(
        '<my-card><template shadowrootmode="open"><slot></slot></template></my-card>',
      ),
    ).toBe(false);
    expect(isHtmlPageTemplate('<!-- <slot></slot> --><p>x</p>')).toBe(false);
    expect(isHtmlPageTemplate('<script>const s = "<slot></slot>";</script>')).toBe(false);
  });
});

describe('inspectHtmlPageTemplate', () => {
  it('lists the content slot and named slots', () => {
    const inspection = inspectHtmlPageTemplate(BLOG_TEMPLATE);
    expect(inspection.errors).toEqual([]);
    expect(inspection.defaultSlotCount).toBe(1);
    expect(inspection.namedSlots).toEqual(['title', 'date']);
    expect(inspection.usesImage).toBe(false);
  });

  it('reports whether a social preview picture would appear in the page', () => {
    expect(inspectHtmlPageTemplate('<slot name="og-image"></slot><slot/>').usesImage).toBe(true);
    expect(
      inspectHtmlPageTemplate('<meta property="og:image" content="x.png"><slot/>').usesImage,
    ).toBe(true);
    expect(inspectHtmlPageTemplate('<meta name="TWITTER:IMAGE"><slot/>').usesImage).toBe(true);
    expect(
      inspectHtmlPageTemplate('<meta property="og:image:alt" content="x"><slot/>').usesImage,
    ).toBe(false);
    expect(
      inspectHtmlPageTemplate('<template><slot name="og-image"></slot></template><slot/>')
        .usesImage,
    ).toBe(false);
  });

  it('reports a missing, duplicated, nested, or unbalanced slot with its line', () => {
    expect(inspectHtmlPageTemplate('<p><slot name="title"></slot></p>').errors[0].message).toMatch(
      /no unnamed <slot>/,
    );
    const duplicated = inspectHtmlPageTemplate('<slot></slot>\n<slot></slot>');
    expect(duplicated.errors).toEqual([
      { message: expect.stringMatching(/more than one unnamed/), line: 2 },
    ]);
    expect(
      inspectHtmlPageTemplate('<slot><slot name="x"></slot></slot>').errors.map((e) => e.message),
    ).toContainEqual(expect.stringMatching(/inside another <slot>/));
    expect(inspectHtmlPageTemplate('<div>\n<slot>\n</div>').errors).toContainEqual({
      message: expect.stringMatching(/never closed/),
      line: 2,
    });
    expect(inspectHtmlPageTemplate('<slot/></slot>').errors[0].message).toMatch(/no matching/);
  });
});

describe('applyHtmlPageTemplate', () => {
  it('places the marked body in the unnamed slot and fills named slots as text', () => {
    const page = fill(BLOG_TEMPLATE, {
      bodyHtml: '<p>First post.</p>',
      title: 'Hello & welcome',
      values: { date: '2026-10-28' },
    });
    expect(page).toContain(
      `${HTML_PAGE_TEMPLATE_CONTENT_START}\n<p>First post.</p>\n${HTML_PAGE_TEMPLATE_CONTENT_END}`,
    );
    expect(page).toContain('<h1>Hello &amp; welcome</h1>');
    expect(page).toContain('<time>2026-10-28</time>');
    expect(page).not.toContain('<slot');
    expect(page).not.toContain('Post content goes here.');
  });

  it('keeps a slot’s fallback children when it has no value', () => {
    const page = fill(BLOG_TEMPLATE);
    expect(page).toContain('<time>Undated</time>');
  });

  it('escapes slot values so frontmatter cannot inject markup', () => {
    const page = fill('<p><slot name="author"></slot></p><slot/>', {
      values: { author: '<script>alert(1)</script>' },
    });
    expect(page).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('fills slots written inside <title> as text', () => {
    expect(fill(BLOG_TEMPLATE)).toContain('<title>Hello · My Blog</title>');
  });

  it('replaces a <title> that has no slot, and adds one when the template has none', () => {
    expect(fill('<head><title>Site</title></head><body><slot/></body>')).toContain(
      '<title>Hello</title>',
    );
    expect(fill('<head></head><body><slot/></body>')).toContain(
      '<head><title>Hello</title>\n</head>',
    );
  });

  it('updates the description and social title metadata the template declares', () => {
    const page = fill(BLOG_TEMPLATE, { values: { description: 'All about "it"' } });
    expect(page).toContain('<meta name="description" content="All about &quot;it&quot;">');
    expect(page).toContain('<meta property="og:title" content="Hello">');
  });

  it('leaves the template description alone when the document has none', () => {
    expect(fill(BLOG_TEMPLATE)).toContain('<meta name="description" content="A blog">');
  });

  it('fills the social image metadata the template declares', () => {
    const template = `<head>
  <meta property="og:image" content="https://example.com/logo.png">
  <meta property="og:image:width" content="256">
  <meta property="og:image:height" content="256">
  <meta property="og:image:alt" content="Logo">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:image" content="https://example.com/logo.png">
  <meta name="twitter:image:alt">
</head><body><slot/></body>`;
    const page = fill(template, {
      image: {
        url: 'https://example.com/posts/a_files/og-image.png?v=1&x=2',
        src: 'a_files/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Hello "world"',
        type: 'image/png',
      },
    });
    expect(page).toContain(
      '<meta property="og:image" content="https://example.com/posts/a_files/og-image.png?v=1&amp;x=2">',
    );
    expect(page).toContain('<meta property="og:image:width" content="1200">');
    expect(page).toContain('<meta property="og:image:height" content="630">');
    expect(page).toContain('<meta property="og:image:alt" content="Hello &quot;world&quot;">');
    expect(page).toContain('<meta property="og:image:type" content="image/png">');
    expect(page).toContain(
      '<meta name="twitter:image" content="https://example.com/posts/a_files/og-image.png?v=1&amp;x=2">',
    );
    expect(page).toContain('<meta name="twitter:image:alt" content="Hello &quot;world&quot;">');
  });

  it('keeps the template social image when the page has no picture of its own', () => {
    const template = '<meta property="og:image" content="logo.png"><slot/>';
    expect(fill(template)).toContain('<meta property="og:image" content="logo.png">');
  });

  it('places the social image in an og-image slot, or keeps the slot fallback', () => {
    const template =
      '<header><slot name="og-image"><img src="../img/logo.png" alt=""></slot></header><slot/>';
    const page = fill(
      template,
      {
        values: { 'og-image': 'frontmatter value' },
        image: {
          url: 'https://example.com/a.png',
          src: 'a_files/og-image.png',
          width: 1200,
          height: 630,
          alt: 'A & B',
        },
      },
      { templatePath: '_templates/post.html', outputPath: 'a.html' },
    );
    expect(page).toContain(
      '<header><img src="a_files/og-image.png" alt="A &amp; B" width="1200" height="630"></header>',
    );
    expect(page).not.toContain('frontmatter value');
    expect(fill(template, { image: { url: 'https://example.com/a.png' } })).toContain(
      '<header><img src="https://example.com/a.png" alt=""></header>',
    );
    expect(
      fill(
        template,
        { values: { 'og-image': 'x' } },
        { templatePath: '_templates/post.html', outputPath: 'a.html' },
      ),
    ).toContain('<header><img src="img/logo.png" alt=""></header>');
  });

  it('adds a missing content attribute to a declared meta tag', () => {
    expect(fill('<meta name="twitter:title"><slot/>')).toContain(
      '<meta name="twitter:title" content="Hello">',
    );
  });

  it('inserts head markup before the template’s own stylesheet', () => {
    const page = fill(BLOG_TEMPLATE, { headHtml: '<style data-squisq>x</style>\n' });
    expect(page.indexOf('<style data-squisq>')).toBeGreaterThan(page.indexOf('<meta charset'));
    expect(page.indexOf('<style data-squisq>')).toBeLessThan(
      page.indexOf('<link rel="stylesheet"'),
    );
  });

  it('inserts head markup at the end of a head without stylesheets', () => {
    const page = fill(
      '<html><head><meta charset="utf-8"><title>t</title></head><body><slot></slot></body></html>',
      {
        headHtml: '<style data-squisq>x</style>',
      },
    );
    expect(page).toContain('<title>Hello</title><style data-squisq>x</style></head>');
  });

  it('keeps everything outside the filled ranges byte for byte', () => {
    const page = fill(BLOG_TEMPLATE);
    expect(
      page.startsWith('<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">'),
    ).toBe(true);
    expect(page).toContain('  <!-- analytics -->\n  <script src="../js/site.js"></script>');
    expect(page.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('rewrites template-relative URLs to resolve from the generated page', () => {
    const page = fill(
      BLOG_TEMPLATE,
      {},
      {
        templatePath: '_templates/post.html',
        outputPath: 'posts/2026/hello.html',
      },
    );
    expect(page).toContain('<link rel="stylesheet" href="../../css/site.css">');
    expect(page).toContain('<script src="../../js/site.js">');
    expect(page).toContain('<a href="../../index.html">My Blog</a>');
    expect(page).toContain('<a href="../../">Home</a>');
    expect(page).toContain('srcset="../../img/logo.png 1x, ../../img/logo@2x.png 2x"');
  });

  it('leaves absolute, rooted, fragment, and escaping URLs untouched', () => {
    const template =
      '<a href="https://x.test/a">a</a><a href="/about">b</a><a href="#top">c</a>' +
      '<a href="mailto:me@x.test">d</a><a href="../../../outside.html">e</a>' +
      '<a href="post.html?q=1#c">f</a><slot/>';
    const page = fill(
      template,
      {},
      { templatePath: 'templates/post.html', outputPath: 'blog/post.html' },
    );
    expect(page).toContain('href="https://x.test/a"');
    expect(page).toContain('href="/about"');
    expect(page).toContain('href="#top"');
    expect(page).toContain('href="mailto:me@x.test"');
    expect(page).toContain('href="../../../outside.html"');
    expect(page).toContain('href="../templates/post.html?q=1#c"');
  });

  it('does not rewrite URLs when the template and page share a folder', () => {
    const page = fill(
      BLOG_TEMPLATE,
      {},
      { templatePath: 'blog/_post.html', outputPath: 'blog/x.html' },
    );
    expect(page).toContain('href="../css/site.css"');
  });

  it('refuses a template it cannot fill', () => {
    expect(() => fill('<p>No slot</p>')).toThrow(HtmlPageTemplateError);
    expect(() => fill('<p>No slot</p>')).toThrow(/no unnamed <slot>/);
  });
});

describe('templated plain HTML', () => {
  const doc = parseMarkdown('# Heading\n\nSome *text*.');

  it('renders the body and functional CSS without the theme page styles', () => {
    const parts = markdownDocToPlainHtmlParts(doc, { title: 'T', themeId: 'warm-earth' });
    expect(parts.title).toBe('T');
    expect(parts.bodyHtml).toContain('<em>text</em>');
    expect(parts.featureHeadHtml).toContain('<style data-squisq>');
    expect(parts.featureHeadHtml).toContain('.squisq-feature');
    expect(parts.featureHeadHtml).not.toMatch(/\bbody \{/);
    expect(parts.featureHeadHtml).not.toContain('--plain-');
  });

  it('assembles the same body the full page carries', () => {
    const page = markdownDocToPlainHtml(doc, { title: 'T' });
    expect(page).toContain(markdownDocToPlainHtmlParts(doc, { title: 'T' }).bodyHtml);
  });

  it('re-imports only the document from a templated page', () => {
    const parts = markdownDocToPlainHtmlParts(doc);
    const page = applyHtmlPageTemplate(BLOG_TEMPLATE, {
      bodyHtml: parts.bodyHtml,
      headHtml: parts.featureHeadHtml,
      title: 'Hello',
    });
    expect(extractHtmlPageTemplateContent(page)?.trim()).toBe(parts.bodyHtml.trim());
    const imported = htmlToMarkdownDocSync(page);
    const text = JSON.stringify(imported.children);
    expect(text).toContain('Heading');
    expect(text).not.toContain('My Blog');
    expect(imported.frontmatter?.title).toBe('Hello · My Blog');
  });
});
