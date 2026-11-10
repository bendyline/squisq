import { describe, expect, it } from 'vitest';
import { classifyListShape, type ListShapeInput } from '../recommend/listShape.js';
import {
  pickAutoTemplate,
  profileBlockContents,
  recommendTemplatesForBlock,
} from '../recommend/templates.js';
import { parseMarkdown } from '../markdown/index.js';
import { templateRegistry } from '../doc/templates/index.js';

const shape = (input: ListShapeInput) => {
  const { shape: name, template, confidence } = classifyListShape(input);
  return [name, template, confidence];
};

describe('classifyListShape', () => {
  it('reads a numbered list, ordering words, or a heading that names steps as a sequence', () => {
    expect(shape({ items: ['Survey the site', 'Draw the plan'], ordered: true })).toEqual([
      'sequence',
      'process',
      'strong',
    ]);
    expect(shape({ items: ['First, survey the site', 'Then draw the plan'] })).toEqual([
      'sequence',
      'process',
      'strong',
    ]);
    expect(shape({ heading: 'How to brew', items: ['Grind the beans', 'Pour the water'] })[1]).toBe(
      'process',
    );
  });

  it('reads dated items in order as a timeline, never as key numbers', () => {
    const dated = [
      '1796: Jenner tests a vaccine',
      '1955: the polio vaccine',
      '1980: smallpox ends',
    ];
    expect(shape({ items: dated })).toEqual(['timeline', 'process', 'strong']);
    // Out of order they are not a timeline, and years are not figures.
    expect(shape({ items: [dated[2]!, dated[0]!] })[1]).not.toBe('stats');
  });

  it('reads figures with what they measure as key numbers', () => {
    expect(
      shape({ items: ['57 million: deaths prevented', '95%: coverage needed', '$3.2B: a year'] }),
    ).toEqual(['figures', 'stats', 'strong']);
    expect(shape({ items: ['Coverage: 95%', 'Efficacy: 97%'] })[1]).toBe('stats');
    expect(shape({ items: ['40% of trips are on foot', '12% are by bike'] })[1]).toBe('stats');
    // A recipe's quantities are not statistics.
    expect(shape({ items: ['250 g flour', '2 eggs', '500 ml milk'] })[1]).not.toBe('stats');
  });

  it('reads figures that shrink stage by stage, or a heading that says so, as a funnel', () => {
    expect(
      shape({
        heading: 'Sign-up funnel',
        items: ['10,000 visitors', '1,200 sign-ups', '300 paying customers'],
      }),
    ).toEqual(['funnel', 'funnel', 'strong']);
    expect(
      shape({
        heading: 'How applicants are filtered',
        items: ['Applied', 'Interviewed', 'Hired'],
      })[1],
    ).toBe('funnel');
  });

  it('reads a heading or a closing item that says it comes round again as a cycle', () => {
    const water = ['Evaporation', 'Condensation', 'Precipitation'];
    expect(shape({ heading: 'The water cycle', items: water })).toEqual([
      'cycle',
      'cycle',
      'strong',
    ]);
    expect(
      shape({
        items: ['Plan the sprint', 'Build', 'Review, then the cycle starts over'],
        ordered: true,
      })[1],
    ).toBe('cycle');
    // A bicycle is not a loop.
    expect(shape({ heading: 'Cycle lanes', items: water })[1]).not.toBe('cycle');
  });

  it('draws nested parts only in an order the items make clear', () => {
    const inside = ['Inner core: solid iron', 'Mantle: flowing rock', 'Crust: a thin shell'];
    expect(shape({ heading: 'Layers of the Earth', items: inside })).toEqual([
      'nested',
      'layers',
      'strong',
    ]);
    // From the outside in, the items are reversed so the core is drawn at the centre.
    const outside = [...inside].reverse();
    expect(classifyListShape({ heading: 'Layers of the Earth', items: outside }).inputs).toEqual({
      items: inside,
    });
    // Without a clue to the order, the drawing is only a suggestion.
    expect(
      shape({ heading: 'Layers of the stack', items: ['Hardware', 'Kernel', 'Applications'] }),
    ).toEqual(['nested', 'layers', 'weak']);
  });

  it('draws a hierarchy from its top down, reversing one listed from the base up', () => {
    expect(
      shape({ heading: 'Chain of command', items: ['General', 'Colonel', 'Captain', 'Private'] }),
    ).toEqual(['hierarchy', 'pyramid', 'strong']);
    const maslow = ['Physiological: food and rest', 'Safety', 'Belonging', 'Esteem'];
    const result = classifyListShape({ heading: 'Hierarchy of needs', items: maslow });
    expect([result.template, result.confidence]).toEqual(['pyramid', 'strong']);
    expect(result.inputs).toEqual({ items: [...maslow].reverse() });
  });

  it('reads two opposites, or two items under a comparing heading, as a contrast', () => {
    const versus = classifyListShape({ items: ['Pros: cheap and quick', 'Cons: wears out'] });
    expect([versus.shape, versus.template, versus.inputs]).toEqual([
      'contrast',
      'cards',
      { versus: true },
    ]);
    expect(
      classifyListShape({ heading: 'Frogs vs toads', items: ['Smooth skin', 'Dry skin'] }).inputs,
    ).toEqual({ versus: true });
  });

  it('reads two sets and what they share as a Venn diagram, and four under a matrix heading as one', () => {
    expect(
      shape({ items: ['Frogs: smooth skin', 'Toads: dry skin', 'Both: lay eggs in water'] }),
    ).toEqual(['overlap', 'venn', 'strong']);
    expect(
      shape({
        heading: 'Priority matrix',
        items: ['Do first', 'Plan', 'Delegate', 'Drop'],
      }),
    ).toEqual(['matrix', 'matrix', 'strong']);
  });

  it('reads labelled items as parallel ideas, and around a shared subject as a hub', () => {
    const kinds = ['Live: a weakened germ', 'Inactivated: a killed germ', 'mRNA: instructions'];
    expect(shape({ heading: 'Kinds of vaccine', items: kinds })).toEqual([
      'parallel',
      'cards',
      'strong',
    ]);
    expect(shape({ heading: 'Causes of inflation', items: kinds })).toEqual([
      'hub',
      'hub',
      'strong',
    ]);
  });

  it('leaves a list alone when nothing says what it is, or no drawing could hold it', () => {
    expect(
      shape({ items: ['Bring a coat', 'The ferry leaves at nine', 'Dogs are welcome'] }),
    ).toEqual(['parallel', 'cards', 'weak']);
    expect(shape({ items: ['Only one'] })[0]).toBe('plain');
    expect(
      shape({ items: Array.from({ length: 7 }, (_, i) => `Item ${i}`), ordered: true })[0],
    ).toBe('plain');
    expect(shape({ items: ['Short', 'x'.repeat(200)], ordered: true })[0]).toBe('plain');
  });
});

describe('list shapes in template picking', () => {
  const profile = (markdown: string, heading?: string) =>
    profileBlockContents(parseMarkdown(markdown).children, { heading });

  it('picks a strong shape automatically and leaves a weak one to the author', () => {
    expect(pickAutoTemplate(profile('1. Survey\n2. Build\n'))).toBe('process');
    expect(pickAutoTemplate(profile('- Bring a coat\n- Dogs are welcome\n'))).toBe('list');
    // The caller can keep every list a list.
    expect(pickAutoTemplate(profile('1. Survey\n2. Build\n'), 0, { concepts: false })).toBe('list');
  });

  it('recommends the drawing a list suggests beside the plain list', () => {
    const names = Object.keys(templateRegistry);
    const { recommended } = recommendTemplatesForBlock(
      profile('- Evaporation\n- Condensation\n- Rain\n', 'The water cycle'),
      names,
    );
    expect(recommended).toEqual(expect.arrayContaining(['list', 'cycle', 'cards', 'process']));
  });

  it('does not take a dated or numeric bullet for the block’s one key figure', () => {
    const dated = profile('- 1796: the first vaccine\n- 1955: the polio vaccine\n');
    expect(dated.hasNumberHighlight).toBe(false);
    expect(pickAutoTemplate(dated)).toBe('process');
  });
});
