import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { deriveTemplateInputs } from '../doc/templateInputs.js';

function statInputs(heading: string, body: string): Record<string, unknown> | null {
  return deriveTemplateInputs('statHighlight', heading, parseMarkdown(body).children);
}

describe('statHighlight template input derivation', () => {
  it('uses a leading bold metric as the hero stat', () => {
    expect(
      statInputs('The Big Number', '**42%** of teams prefer visual blocks over raw slides.'),
    ).toEqual({
      stat: '42%',
      description: 'of teams prefer visual blocks over raw slides.',
    });
  });

  it('accepts an explicitly bold small integer', () => {
    expect(statInputs('Answer Count', '**42** answers were submitted')).toEqual({
      stat: '42',
      description: 'answers were submitted',
    });
  });

  it('promotes only the metric when the bold run contains a longer phrase', () => {
    expect(statInputs('Revenue', '**Revenue grew 42%** year over year')).toEqual({
      stat: '42%',
      description: 'Revenue grew year over year',
    });
  });

  it('drops an inline separator between the metric and description', () => {
    expect(
      statInputs('The Big Number', '**42%** — The percentage of developers who prefer it.'),
    ).toEqual({
      stat: '42%',
      description: 'The percentage of developers who prefer it.',
    });
  });

  it('preserves a stat-looking heading for existing documents', () => {
    expect(statInputs('89%', 'of customers recommend it')).toEqual({
      stat: '89%',
      description: 'of customers recommend it',
    });
  });

  it('extracts an unformatted body metric for automatic templates', () => {
    expect(statInputs('Funding', '$2.3M raised')).toEqual({
      stat: '$2.3M',
      description: 'raised',
    });
  });

  it('does not let a year in a structural heading eclipse the body metric', () => {
    expect(statInputs('2024 Results', '42% of teams reached their goal')).toEqual({
      stat: '42%',
      description: 'of teams reached their goal',
    });
  });

  it('retains the historical fallback when no metric can be found', () => {
    expect(statInputs('A Result', 'Supporting context')).toEqual({
      stat: 'A Result',
      description: 'Supporting context',
    });
  });
});
