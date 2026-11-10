import { describe, expect, it } from 'vitest';
import {
  AUTHORING_TRICKS,
  PRESENTATION_LAYOUT_GUIDE,
  PRESENTATION_LAYOUT_LABELS,
  TEMPLATE_GUIDES,
  authoringTricks,
  templateCatalog,
  templateRegistry,
} from '../doc/templates/index.js';
import { PRESENTATION_LAYOUTS } from '../transform/presentationPlan.js';
import { CONCEPT_TEMPLATES } from '../transform/conceptReveal.js';

describe('authoring guide', () => {
  it('guides only templates that exist, and every presentation layout', () => {
    for (const template of Object.keys(TEMPLATE_GUIDES))
      expect(templateRegistry).toHaveProperty(template);
    expect(Object.keys(PRESENTATION_LAYOUT_GUIDE).sort()).toEqual([...PRESENTATION_LAYOUTS].sort());
  });

  it('ties tricks to real templates or layouts, under unique ids', () => {
    const known = new Set([...Object.keys(templateRegistry), ...PRESENTATION_LAYOUTS]);
    for (const trick of AUTHORING_TRICKS) {
      for (const template of trick.templates ?? [])
        expect(known.has(template), `${trick.id}: ${template}`).toBe(true);
    }
    const ids = AUTHORING_TRICKS.map((trick) => trick.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders catalog lines in the product’s words', () => {
    const lines = templateCatalog(
      [
        'statHighlight',
        { templates: ['columnChart', 'barChart'] },
        'list',
        { template: 'map', fields: 'center, zoom', use: 'only where a render exists' },
      ],
      { source: 'article' },
    );
    expect(lines).toEqual([
      '- statHighlight (stat like "98%" or "36", description ≤ 60 chars, detail ≤ 80 chars, accentImage optional) — counts up; the number must be in the article',
      '- columnChart | barChart (title, headers [label, value], rows [[label, value], …] 2–6 rows, showValues: true) — only values the article states',
      "- list (title, items: 2–5 short items taken from the article's own words)",
      '- map (center, zoom) — only where a render exists',
    ]);
    expect(templateCatalog(Object.keys(TEMPLATE_GUIDES) as never).join('\n')).not.toContain(
      '{source}',
    );
  });

  it('selects the tricks for the templates a prompt offers', () => {
    const forCharts = authoringTricks({ templates: ['columnChart'] });
    expect(forCharts.some((text) => text.startsWith('A range'))).toBe(true);
    expect(forCharts.some((text) => text.startsWith('Slides that draw'))).toBe(false);
    // Tricks for every slide come along with any selection.
    expect(forCharts.some((text) => text.startsWith('One idea per slide'))).toBe(true);
    expect(
      authoringTricks({ ids: ['ranges', 'one-idea'] }).map((text) => text.slice(0, 7)),
    ).toEqual(['A range', 'One ide']);
    expect(
      authoringTricks({ templates: ['cards'], wording: { source: 'article' } }).join(' '),
    ).toContain("in the article's own words");
  });

  it('gives summary authors only the tricks written for them', () => {
    expect(authoringTricks({ surface: 'summary' })).toEqual([
      'Draw numbers as numbers: when the passage turns on one figure choose "stat"; when it gives two to four key figures choose "stats" and write each point as "figure: what it measures".',
      'Slides that draw their ideas explain best: when the passage has several parallel ideas, ordered stages, a repeating loop or nested parts, choose "cards", "process", "cycle", "layers" rather than "statement" or "list", and write each of their points (up to 4) as "Label: detail", a label of 1–4 words and a detail of at most 70 characters. For dated events, start each label with its date.',
      'Some relationships have a shape of their own: a hierarchy → "pyramid", stages that narrow from many to few → "funnel", factors or causes of one thing → "hub", two things and what they share → "venn" (its third point "Both: …"), four ideas on two axes → "matrix". Choose one only when the passage states that relationship; a shape the ideas do not have misleads.',
    ]);
  });

  it('names every presentation layout for a picker and guides every concept template', () => {
    for (const layout of PRESENTATION_LAYOUTS) {
      expect(PRESENTATION_LAYOUT_GUIDE[layout], layout).toBeTruthy();
      expect(PRESENTATION_LAYOUT_LABELS[layout].label, layout).toBeTruthy();
    }
    for (const template of CONCEPT_TEMPLATES)
      expect(TEMPLATE_GUIDES[template].fields, template).toContain('items');
    // A diagram's author states relationships; the template places the nodes.
    expect(TEMPLATE_GUIDES.diagram.fields).toContain('no x or y');
  });
});
