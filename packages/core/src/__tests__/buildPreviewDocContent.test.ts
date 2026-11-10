import { describe, expect, it } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '../doc/index';
import { parseMarkdown } from '../markdown/index';
import type { DocBlock, TextLayer } from '../schemas/index';
import { buildPreviewDoc, documentTitleFromFileName } from '../doc/buildPreviewDoc';

function firstPreviewSlide(markdown: string): Record<string, unknown> {
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'stat-content-test',
    generateCoverBlock: false,
  });
  return buildPreviewDoc(source).blocks[0] as unknown as Record<string, unknown>;
}

function previewSlides(markdown: string): Record<string, unknown>[] {
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'content-first-test',
    generateCoverBlock: false,
  });
  return buildPreviewDoc(source).blocks as unknown as Record<string, unknown>[];
}

describe('buildPreviewDoc content mapping', () => {
  it('uses the complete-body content template for unannotated mixed Markdown blocks', () => {
    const slides = previewSlides(`# Ship Review

A **bold** statement with an [example link](https://example.com).

## Checklist

- First item
- Second item

> A quoted note.

\`inline code\``);

    expect(slides.map((slide) => slide.template)).toEqual(['content', 'content']);

    const { layers } = materializeBlockLayers(slides[1] as unknown as DocBlock);
    const renderedText = layers
      .filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text)
      .join('\n');
    expect(renderedText).toContain('Checklist');
    expect(renderedText).toContain('First item');
    expect(renderedText).toContain('Second item');
    expect(renderedText).toContain('A quoted note.');
    expect(renderedText).toContain('inline code');
  });

  it('preserves list markers and separation from the following paragraph', () => {
    const slide =
      firstPreviewSlide(`### You can create a codebase of a high quality just through prompts; writing code by hand is done.

- There is some combination of prompts + frontier models that can create a codebase of high quality (e.g., that a panel of people would rate as "high quality, well architected, well tested".)
- We may not have "discovered" that exact combination of prompts yet, but it's out there.
- Because of this, and because coding significant portions of codebases by hand simply cannot keep pace, people will move trusting agents to build code for them.

Implication: A massive industry wide change management process is happening`);

    expect(slide.template).toBe('content');

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );

    expect(body?.content.text).toContain('• There is some combination');
    expect(body?.content.text).toContain(
      'people will move trusting agents to build code for them.\n\nImplication:',
    );
    expect(body?.content.html).toContain('<ul><li><p>There is some combination');
    expect(body?.content.html).toContain(
      '</ul><p>Implication: A massive industry wide change management process is happening</p>',
    );
  });

  it('keeps a table in the rich content layer when prose shares its slide', () => {
    const slide = firstPreviewSlide(`## Results

Supporting context that must remain visible.

| Model | Score |
| :--- | ---: |
| Alpha | 100 |`);

    expect(slide.template).toBe('content');

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );

    expect(body?.content.html).toContain('<p>Supporting context that must remain visible.</p>');
    expect(body?.content.html).toContain(
      '<table><thead><tr><th align="left">Model</th><th align="right">Score</th></tr></thead>',
    );
    expect(body?.content.html).toContain(
      '<tbody><tr><td align="left">Alpha</td><td align="right">100</td></tr></tbody></table>',
    );
    expect(body?.position.y).toBe('20%');
    expect(body?.position.height).toBe('72%');
  });

  it('preserves additional authored blank lines between body blocks', () => {
    const slide = firstPreviewSlide(`## A bit about me {[content]}

25 years working on developer platforms

- Developer Marketing
- Minecraft platform



Now currently AI-pilled :)

Fun fact: this slideshow is running from one of my apps`);

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );

    expect(body?.content.text).toContain(
      '• Minecraft platform\n\n\n\nNow currently AI-pilled :)\n\nFun fact:',
    );
    expect(body?.content.html).toContain(
      '</ul><div data-squisq-source-gap aria-hidden="true"><br></div><div data-squisq-source-gap aria-hidden="true"><br></div><p>Now currently AI-pilled :)</p><p>Fun fact:',
    );
  });

  it('keeps an explicitly authored section header as a title-only divider', () => {
    const slide = firstPreviewSlide('# Chapter {[sectionHeader]}\n\nSupporting body.');
    expect(slide.template).toBe('sectionHeader');
  });

  it('does not treat an authored transition as permission to hide body content', () => {
    const slide = firstPreviewSlide('# Chapter {transition=dissolve}\n\nSupporting body.');
    expect(slide.template).toBe('content');
    expect(slide.transition).toEqual({ type: 'dissolve' });
  });

  it('preserves a lossless content-aware auto template', () => {
    const slide = firstPreviewSlide('# Notes\n\n- Apples\n- Pears');
    expect(slide.template).toBe('list');
  });

  it.each([
    'cards',
    'process',
    'cycle',
    'layers',
    'stats',
    'pyramid',
    'funnel',
    'hub',
    'venn',
    'matrix',
  ])('carries the items of an annotated %s block onto its slide', (template) => {
    // The projection drops `sourceHeading`, so a slide that did not carry
    // its items drew the headline over an empty frame.
    const slide = firstPreviewSlide(
      `# Kinds {[${template}]}\n\n- Live: a weakened germ\n- Inactivated: a killed germ\n- Both: train the body\n`,
    );
    expect(slide.template).toBe(template);
    expect(slide.items).toEqual([
      'Live: a weakened germ',
      'Inactivated: a killed germ',
      'Both: train the body',
    ]);
  });

  it('preserves unordered and ordered markers through slideshow materialization', () => {
    const markers = (markdown: string) => {
      const slide = firstPreviewSlide(markdown);
      const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
      return layers
        .filter(
          (layer): layer is TextLayer =>
            layer.type === 'text' && /^item-\d+-marker$/.test(layer.id),
        )
        .map((layer) => layer.content.text);
    };

    expect(markers('# Bullets {[list]}\n\n- First\n- Second')).toEqual(['•', '•']);
    expect(markers('# Steps {[list]}\n\n1. First\n2. Second')).toEqual(['1.', '2.']);
  });

  it('describes content-body list items as structured paragraphs that project to the text', () => {
    // Native exporters (PPTX) write `paragraphs` as real bullets; the plain
    // `text` must stay exactly the marker-prefixed projection of them.
    const slide = firstPreviewSlide(`### Mixed body

An opening paragraph.

- First
  - Nested
- Second

3. Third
4. Fourth`);
    expect(slide.template).toBe('content');

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );
    expect(body?.content.text).toBe(
      'An opening paragraph.\n\n• First\n  • Nested\n• Second\n\n3. Third\n4. Fourth',
    );
    expect(body?.content.paragraphs).toEqual([
      { text: 'An opening paragraph.' },
      { text: '' },
      { text: 'First', list: { ordered: false, level: 0 } },
      { text: 'Nested', list: { ordered: false, level: 1 } },
      { text: 'Second', list: { ordered: false, level: 0 } },
      { text: '' },
      { text: 'Third', list: { ordered: true, level: 0, number: 3 } },
      { text: 'Fourth', list: { ordered: true, level: 0, number: 4 } },
    ]);
  });

  it('leaves a list-free content body without structured paragraphs', () => {
    const slide = firstPreviewSlide('### Prose only\n\nOne paragraph.\n\nAnother paragraph.');
    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );
    expect(body?.content.text).toBe('One paragraph.\n\nAnother paragraph.');
    expect(body?.content.paragraphs).toBeUndefined();
  });

  it('ties list-template markers and items into one text flow', () => {
    const slide = firstPreviewSlide('# Steps {[list]}\n\n1. First\n2. Second');
    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const flow = layers.filter(
      (layer): layer is TextLayer => layer.type === 'text' && layer.content.flow !== undefined,
    );
    expect(flow.map((layer) => [layer.id, layer.content.flow])).toEqual([
      ['item-0-marker', { id: 'list-items', role: 'marker' }],
      ['item-0', { id: 'list-items' }],
      ['item-1-marker', { id: 'list-items', role: 'marker' }],
      ['item-1', { id: 'list-items' }],
    ]);
    const items = flow.filter((layer) => !layer.content.flow?.role);
    expect(items.map((layer) => layer.content.paragraphs?.[0]?.list)).toEqual([
      { ordered: true, level: 0, number: 1 },
      { ordered: true, level: 0, number: 2 },
    ]);
  });

  it('preserves prose-separated lists as complete content instead of a stat extraction', () => {
    const slide = firstPreviewSlide(`### What's in a model name

Take: Qwen 3.6 35B-A3B-Q4

- Qwen is family of models from Alibaba
- Qwen 3.6 is a series of models from March
- 35 billion parameters
- 4 bit quantization

Dense vs Mixture of Experts (MoE)

- Dense models operate over all parameters, every token
- Mixture of Experts choose a subset - here, A3B implies 3 billion are active`);

    expect(slide.template).toBe('content');

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const body = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'body',
    );

    expect(body?.content.text).toContain(
      '• 4 bit quantization\n\nDense vs Mixture of Experts (MoE)\n\n• Dense models operate',
    );
    expect(body?.content.html).toContain(
      '</ul><p>Dense vs Mixture of Experts (MoE)</p><ul><li><p>Dense models operate',
    );
  });

  it('maps the leading bold metric to the large stat layer', () => {
    const slide = firstPreviewSlide(`### The Big Number {[statHighlight colorScheme=green]}

**42%** of teams prefer visual blocks over raw slides.`);

    expect(slide).toMatchObject({
      title: 'The Big Number',
      stat: '42%',
      description: 'of teams prefer visual blocks over raw slides.',
      colorScheme: 'green',
    });

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const stat = layers.find((layer) => layer.id === 'stat') as TextLayer;
    const description = layers.find((layer) => layer.id === 'description') as TextLayer;

    expect(stat.content.text).toBe('42%');
    expect(description.content.text).toBe('of teams prefer visual blocks over raw slides.');
    expect(stat.content.style.fontSize).toBeGreaterThan(description.content.style.fontSize);
  });

  it('lets explicit annotation inputs override Markdown-derived defaults', () => {
    const slide = firstPreviewSlide(
      '### The Big Number {[statHighlight stat="99%" description="Pinned description"]}\n\n' +
        '**42%** derived description.',
    );

    expect(slide).toMatchObject({
      stat: '99%',
      description: 'Pinned description',
    });
  });

  it('coerces structured annotation inputs before materializing a preview slide', () => {
    const slide = firstPreviewSlide(
      '## Local or installed {[twoColumn header="Work where files make sense" ' +
        'left="Web|Browser-local workspaces" right="Desktop|Real folders and native menus"]}',
    );

    expect(slide).toMatchObject({
      template: 'twoColumn',
      left: { label: 'Web', sublabel: 'Browser-local workspaces' },
      right: { label: 'Desktop', sublabel: 'Real folders and native menus' },
    });

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining([
        'header',
        'left-label',
        'left-sublabel',
        'right-label',
        'right-sublabel',
      ]),
    );
  });

  it('carries the heading and list-derived columns of a twoColumn slide', () => {
    // The projection drops `sourceHeading`, so the slide itself must hold the
    // header band; before it did, the heading vanished from the slideshow.
    const authored = firstPreviewSlide(
      '## Coffee {[twoColumn left="Espresso|Bold" right="Filter|Smooth"]}',
    );
    expect(authored).toMatchObject({ header: 'Coffee', left: { label: 'Espresso' } });

    const fromList = firstPreviewSlide(
      '## Coffee {[twoColumn]}\n\n- Espresso: bold and short\n- Filter: smooth and long',
    );
    expect(fromList).toMatchObject({
      header: 'Coffee',
      left: { label: 'Espresso', sublabel: 'bold and short' },
      right: { label: 'Filter', sublabel: 'smooth and long' },
    });
    const { layers, diagnostic } = materializeBlockLayers(fromList as unknown as DocBlock);
    expect(diagnostic).toBeUndefined();
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining(['header', 'left-label', 'right-label']),
    );
  });

  it('shows a template with nothing to draw as content, never a blank slide', () => {
    const body = 'Markdown is portable, while visual editors are immediate.';
    for (const template of [
      'twoColumn',
      'photoGrid',
      'imageWithCaption',
      'videoWithCaption',
      'list',
      'comparisonBar',
    ]) {
      const slide = firstPreviewSlide(`## Side by side {[${template}]}\n\n${body}`);
      expect(slide.template, template).toBe(template);
      const { layers, diagnostic } = materializeBlockLayers(slide as unknown as DocBlock, {
        persistentLayers: false,
      });
      expect(diagnostic, template).toMatchObject({ code: 'template-drew-nothing', template });
      const text = layers
        .filter((layer): layer is TextLayer => layer.type === 'text')
        .map((layer) => layer.content.text)
        .join(' ');
      expect(text, template).toContain('Side by side');
      expect(text, template).toContain('Markdown is portable');
      // Nothing the author did not write: no sample items, no sample values.
      expect(text, template).not.toMatch(/Item 1|\b60\b/);
    }
  });

  it('shows sample inputs only under a bare heading', () => {
    expect(firstPreviewSlide('## Compare {[comparisonBar]}')).toMatchObject({
      leftLabel: 'A',
      rightLabel: 'B',
    });
    expect(firstPreviewSlide('## Steps {[list]}')).toMatchObject({
      items: ['Item 1', 'Item 2', 'Item 3'],
    });
    expect(firstPreviewSlide('## Compare {[comparisonBar]}\n\nReal prose.')).not.toHaveProperty(
      'leftLabel',
    );
    expect(firstPreviewSlide('## Steps {[list]}\n\nReal prose.')).not.toHaveProperty('items');
  });

  it('carries what a transcript speaker said onto the slide', () => {
    const slide = firstPreviewSlide(
      '## Ada Lovelace {[transcript]}\n\nThe engine weaves patterns.',
    );
    expect(slide).toMatchObject({ speaker: 'Ada Lovelace', text: 'The engine weaves patterns.' });
    const text = materializeBlockLayers(slide as unknown as DocBlock)
      .layers.filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text)
      .join(' ');
    expect(text).toContain('The engine weaves patterns.');
  });

  it('keeps the rows and cells of a table apart in a text template', () => {
    const slide = firstPreviewSlide(
      '## Sales {[factCard]}\n\n| Region | Sales |\n| --- | --- |\n| West | 120 |',
    );
    expect(slide.explanation).toBe('Region Sales\nWest 120');
  });

  it('shows a concept block whose body holds no ideas as content', () => {
    const table = '| Region | Sales |\n| --- | --- |\n| West | 120 |';
    const quote = '> The harbor wakes before the town does.';
    for (const template of ['cards', 'process', 'cycle', 'layers', 'pyramid', 'funnel', 'hub']) {
      for (const body of [table, quote]) {
        const slide = firstPreviewSlide(`## Landings {[${template}]}\n\n${body}`);
        const result = materializeBlockLayers(slide as unknown as DocBlock, {
          persistentLayers: false,
        });
        expect(result.diagnostic, template).toMatchObject({ code: 'template-drew-nothing' });
        expect(
          result.layers.map((layer) => layer.id),
          template,
        ).toContain('title');
      }
    }

    // A bare headline keeps the concept lockup: there is no body to show.
    const bare = materializeBlockLayers(
      {
        template: 'cards',
        id: 'bare',
        duration: 5,
        audioSegment: 0,
        title: 'Landings',
      } as DocBlock,
      { persistentLayers: false },
    );
    expect(bare.diagnostic).toBeUndefined();
    expect(bare.layers.length).toBeGreaterThan(0);
  });

  it('keeps Mermaid source available to the slide materializer for every template', () => {
    const slide = firstPreviewSlide(
      '# Architecture\n\n```mermaid\nflowchart LR\n  client --> server\n```',
    );
    expect(slide.contents).toEqual([expect.objectContaining({ type: 'code', lang: 'mermaid' })]);

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock, {
      persistentLayers: false,
    });
    expect(layers.some((layer) => layer.type === 'mermaid')).toBe(true);
    const narrativeText = layers
      .filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text)
      .join('\n');
    expect(narrativeText).not.toContain('flowchart LR');
  });
});

describe('buildPreviewDoc preamble header', () => {
  function preambleDoc(markdown: string) {
    return markdownToDoc(parseMarkdown(markdown), {
      articleId: 'preamble-test',
      generateCoverBlock: false,
    });
  }

  it('does not surface the synthetic block id as a header for heading-less content', () => {
    const slide = buildPreviewDoc(preambleDoc('Just some raw text before any heading.'))
      .blocks[0] as unknown as Record<string, unknown>;
    // Regression: the preamble block id is literally 'preamble' and must never
    // become the visible header.
    expect(slide.id).toBe('preamble');
    expect(slide.title).toBe('');
  });

  it('uses the frontmatter title as the preamble header when present', () => {
    const slide = buildPreviewDoc(
      preambleDoc('---\ntitle: Quarterly Plan\n---\n\nRaw text before any heading.'),
    ).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Quarterly Plan');
  });

  it('uses a host-provided document title (e.g. file name) when there is no heading', () => {
    const slide = buildPreviewDoc(preambleDoc('Raw text before any heading.'), {
      documentTitle: 'Longview Plan',
    }).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Longview Plan');
  });

  it('prefers an authored frontmatter title over the host-provided one', () => {
    const slide = buildPreviewDoc(preambleDoc('---\ntitle: Authored Title\n---\n\nRaw text.'), {
      documentTitle: 'file-name',
    }).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Authored Title');
  });
});

describe('documentTitleFromFileName', () => {
  it('strips directory prefixes and the trailing extension', () => {
    expect(documentTitleFromFileName('docs/Longview Plan.md')).toBe('Longview Plan');
    expect(documentTitleFromFileName('C:\\notes\\draft.markdown')).toBe('draft');
    expect(documentTitleFromFileName('README')).toBe('README');
    expect(documentTitleFromFileName(undefined)).toBe('');
  });
});

describe('buildPreviewDoc container templates', () => {
  // A drawing or layout draws its child headings as the canvas. The preview
  // projection used to drop them outside the compact summaries, so these
  // blocks showed an empty frame in the slideshow, video, and PPTX.
  const markdown = [
    '# Doc',
    '',
    'Intro text.',
    '',
    '## Org chart {[drawing]}',
    '',
    '### CEO {#ceo} {[rectangle x=0 y=0 width=100 height=60]}',
    '',
    '### Dev {#dev} {[rectangle x=0 y=150 width=100 height=60]}',
    '',
    '### {[arrow from=ceo to=dev]}',
    '',
    '## Plan {[layout]}',
    '',
    '### {#t1} {[text x=100 y=100 width=800 height=200 fontSize=48]}',
    '',
    'Hello',
    '',
    '## Next',
    '',
    'More.',
  ].join('\n');

  it('keeps the children and does not turn them into slides', () => {
    const slides = previewSlides(markdown);
    expect(slides.map((slide) => slide.template)).toEqual([
      'content',
      'drawing',
      'layout',
      'content',
    ]);
    expect((slides[1]?.children as unknown[]).length).toBe(3);
    expect((slides[2]?.children as unknown[]).length).toBe(1);
  });

  it('materializes the shapes and text instead of the empty hint', () => {
    const [, drawing, layout] = previewSlides(markdown) as unknown as DocBlock[];
    const drawingLayers = materializeBlockLayers(drawing!).layers;
    expect(drawingLayers.some((layer) => layer.id.endsWith('-empty'))).toBe(false);
    expect(drawingLayers.filter((layer) => layer.type === 'shape')).toHaveLength(2);
    const layoutText = materializeBlockLayers(layout!)
      .layers.filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text);
    expect(layoutText).toContain('Hello');
  });
});
