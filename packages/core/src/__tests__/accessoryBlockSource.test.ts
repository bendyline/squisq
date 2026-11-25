/**
 * The accessory block writer shared by the summary design and study cards:
 * where a new block goes under its owner, at what depth, when it names its
 * owner, and how blocks of different types order in a section.
 */
import { describe, expect, it } from 'vitest';
import {
  accessoryBlockMarkdown,
  openAccessoryBlockSource,
  removeAccessoryBlocks,
} from '../doc/accessoryBlockSource';
import { ACCESSORY_BLOCK_TYPES, type AccessoryBlockType } from '../doc/accessoryBlockTypes';
import { collectAccessoryBlocks } from '../doc/accessoryBlocks';
import { convert } from './accessoryBlockFixtures';

/** Add one block of `type` titled `title` under `ownerId`, after the ones that come before it. */
function add(source: string, ownerId: string, type: AccessoryBlockType, title: string) {
  const located = openAccessoryBlockSource(source);
  const zone = located.zone(ownerId, type);
  if (!zone) throw new Error(`no zone for ${ownerId}`);
  const edit = located.insertion(zone.end, zone.depth, ownerId, (of) => [
    accessoryBlockMarkdown({ type, depth: zone.depth, title, params: {}, ...(of ? { of } : {}) })
      .heading,
  ]);
  return located.finish(edit ? [edit] : []).result;
}

const DOC = [
  '# Plan',
  '',
  'Opening text.',
  '',
  '## Steps',
  '',
  'Step text.',
  '',
  '## Close',
  '',
  'Closing text.',
  '',
].join('\n');

describe('placing an accessory block', () => {
  it('goes after the owner’s own text, at its first sub-section’s depth', () => {
    expect(add(DOC, 'plan', 'summary', 'Opening slide')).toBe(
      DOC.replace('## Steps', '## Opening slide {[summary]}\n\n## Steps'),
    );
  });

  it('goes one level below the owner when it has no sub-section, and at the end of the document', () => {
    expect(add(DOC, 'close', 'summary', 'Closing slide')).toBe(
      `${DOC}\n### Closing slide {[summary]}\n`,
    );
  });

  it('joins the run already there, after it', () => {
    const once = add(DOC, 'plan', 'summary', 'First');
    expect(add(once, 'plan', 'summary', 'Second')).toBe(
      DOC.replace('## Steps', '## First {[summary]}\n\n## Second {[summary]}\n\n## Steps'),
    );
  });

  it('names its owner where the heading above would be another', () => {
    const deep = '# A\n\nText.\n\n###### Six\n\nDeep text.\n';
    expect(add(deep, 'six', 'summary', 'Deep slide')).toBe(
      `${deep}\n###### Deep slide {[summary of=six]}\n`,
    );
    expect(convert(add(deep, 'six', 'summary', 'Deep slide')).blocks.length).toBeGreaterThan(0);
  });

  it('puts the text before the first heading’s blocks at the top of the document', () => {
    const preamble = 'Before any heading.\n\n## First\n\nText.\n';
    expect(add(preamble, 'preamble', 'summary', 'Top')).toBe(
      'Before any heading.\n\n## Top {[summary]}\n\n## First\n\nText.\n',
    );
  });

  it('keeps line endings', () => {
    const crlf = DOC.replace(/\n/g, '\r\n');
    expect(add(crlf, 'plan', 'summary', 'Slide')).toBe(
      crlf.replace('## Steps', '## Slide {[summary]}\r\n\r\n## Steps'),
    );
  });

  it('has nowhere to go for an owner not in the document', () => {
    expect(openAccessoryBlockSource(DOC).zone('missing', 'summary')).toBeNull();
  });
});

describe('ordering accessory blocks of different types', () => {
  // The registry orders types; a lower order is written first. Blocks already
  // there are never moved, whatever their order.
  const types = Object.keys(ACCESSORY_BLOCK_TYPES) as AccessoryBlockType[];

  it('orders every registered type, summaries first', () => {
    expect(ACCESSORY_BLOCK_TYPES.summary.order).toBe(
      Math.min(...types.map((type) => ACCESSORY_BLOCK_TYPES[type].order)),
    );
  });

  it('puts a new block after those at or before its order, and before the rest', () => {
    // A zone whose last block comes after this type stops before it.
    const located = openAccessoryBlockSource(
      DOC.replace('## Steps', '## One {[summary]}\n\n## Two {[summary]}\n\n## Steps'),
    );
    const zone = located.zone('plan', 'summary')!;
    expect(located.nodes[zone.start]).toMatchObject({ type: 'heading', depth: 2 });
    expect(zone.end - zone.start).toBe(2);
  });
});

describe('removing accessory blocks', () => {
  it('removes a block with what is under its heading, by id', () => {
    const source = add(add(DOC, 'plan', 'summary', 'First'), 'plan', 'summary', 'Second');
    const ids = collectAccessoryBlocks(convert(source).blocks).map((block) => block.id);
    expect(removeAccessoryBlocks(source, [ids[0]!]).result).toBe(
      DOC.replace('## Steps', '## Second {[summary]}\n\n## Steps'),
    );
    expect(removeAccessoryBlocks(source, ids, 'summary').result).toBe(DOC);
  });
});

describe('a block as markdown', () => {
  it('escapes its title and writes its parameters in order', () => {
    expect(
      accessoryBlockMarkdown({
        type: 'summary',
        depth: 3,
        title: 'A *real* # title',
        params: { passage: 'abc-1', origin: 'ai' },
        of: 'owner',
      }),
    ).toEqual({ heading: '### A \\*real\\* # title {[summary passage=abc-1 origin=ai of=owner]}' });
  });
});
