import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  applyPropertyEdits,
  coercePropertyText,
  isCustomFrontmatterKey,
  isEmptyPropertyPlan,
  newPropertyRow,
  planPropertyEdits,
  readCustomProperties,
  reconcilePropertyRows,
  rowsFromProperties,
  validatePropertyRows,
  type PropertyRow,
} from '../frontmatterProperties';
import { FRONTMATTER_EDITOR_KEYS, FRONTMATTER_SETTING_KEYS } from '../frontmatterSettings';

const SOURCE = [
  '---',
  'title: Harbor Survey',
  '# who wrote it',
  'author: Ines Duarte',
  'squisq-theme: gezellig',
  'theme: documentary',
  'display-mode: slideshow',
  'document-render-as: landscape',
  'tags:',
  '  - harbor',
  '  - silt',
  'version: "1.0"',
  'draft: true',
  'weight: 10',
  'description: A season of measurements',
  'notes: |-',
  '  line one',
  '  line two',
  'extra:',
  '  nested: yes',
  '---',
  '',
  '# Body',
  '',
].join('\n');

/** Edit one row of the loaded properties and return the written source. */
function edit(source: string, change: (rows: PropertyRow[]) => PropertyRow[]): string {
  const properties = readCustomProperties(source);
  const rows = change(rowsFromProperties(properties));
  expect([...validatePropertyRows(rows)]).toEqual([]);
  return applyPropertyEdits(source, planPropertyEdits(properties, rows));
}

function setRow(rows: PropertyRow[], key: string, patch: Partial<PropertyRow>): PropertyRow[] {
  return rows.map((row) => (row.originalKey === key ? { ...row, ...patch } : row));
}

describe('isCustomFrontmatterKey', () => {
  it('treats every Squisq setting, canonical or legacy, as managed', () => {
    for (const keys of Object.values(FRONTMATTER_SETTING_KEYS)) {
      expect(isCustomFrontmatterKey(keys.canonical)).toBe(false);
      for (const legacy of typeof keys.legacy === 'string' ? [keys.legacy] : keys.legacy) {
        expect(isCustomFrontmatterKey(legacy), legacy).toBe(false);
      }
    }
    for (const key of [
      'title',
      'subtitle',
      'motion',
      'dashboard-zoom',
      'proof-dictionary',
      'squisq-anything',
      'squisq-custom-themes',
    ]) {
      expect(isCustomFrontmatterKey(key), key).toBe(false);
    }
  });

  it('treats the unprefixed settings the editor reads as managed', () => {
    for (const key of Object.values(FRONTMATTER_EDITOR_KEYS)) {
      expect(isCustomFrontmatterKey(key), key).toBe(false);
    }
    expect(Object.values(FRONTMATTER_EDITOR_KEYS)).toEqual(['display-mode', 'document-render-as']);
  });

  it('lists the document’s own keys', () => {
    for (const key of ['author', 'description', 'tags', 'slug', 'draft']) {
      expect(isCustomFrontmatterKey(key), key).toBe(true);
    }
  });
});

describe('readCustomProperties', () => {
  it('returns only custom keys, in source order, with how each is edited', () => {
    expect(
      readCustomProperties(SOURCE).map(({ key, kind, text }) => ({ key, kind, text })),
    ).toEqual([
      { key: 'author', kind: 'text', text: 'Ines Duarte' },
      { key: 'tags', kind: 'list', text: 'harbor, silt' },
      { key: 'version', kind: 'text', text: '1.0' },
      { key: 'draft', kind: 'text', text: 'true' },
      { key: 'weight', kind: 'text', text: '10' },
      { key: 'description', kind: 'text', text: 'A season of measurements' },
      { key: 'notes', kind: 'nested', text: '2 lines' },
      { key: 'extra', kind: 'nested', text: 'Nested values' },
    ]);
  });

  it('reads a bare frontmatter block as well as a whole source', () => {
    expect(readCustomProperties('---\nauthor: A\n---\n').map((p) => p.key)).toEqual(['author']);
    expect(readCustomProperties('# No frontmatter\n')).toEqual([]);
    expect(readCustomProperties('---\nsquisq-theme: bold\n---\n')).toEqual([]);
  });

  it('shows a list that commas could not round-trip as nested', () => {
    const [property] = readCustomProperties('---\nnames:\n  - "Duarte, Ines"\n---\n');
    expect(property.kind).toBe('nested');
  });
});

describe('coercePropertyText', () => {
  it('keeps a text value text', () => {
    expect(coercePropertyText('2.0', { kind: 'text', value: '1.0' })).toBe('2.0');
    expect(coercePropertyText(' true ', { kind: 'text', value: 'yes' })).toBe('true');
  });

  it('types a new or non-text value as hand-written YAML would be typed', () => {
    expect(coercePropertyText('true')).toBe(true);
    expect(coercePropertyText('42')).toBe(42);
    expect(coercePropertyText('11', { kind: 'text', value: 10 })).toBe(11);
    expect(coercePropertyText('007')).toBe('007');
    expect(coercePropertyText('Duarte, Ines')).toBe('Duarte, Ines');
  });

  it('never produces null, which would delete the key', () => {
    expect(coercePropertyText('')).toBe('');
    expect(coercePropertyText('null')).toBe('null');
    expect(coercePropertyText('~')).toBe('~');
  });

  it('splits a list on commas', () => {
    expect(coercePropertyText(' a, b ,, 2026,true ', { kind: 'list', value: [] })).toEqual([
      'a',
      'b',
      2026,
      true,
    ]);
  });
});

describe('validatePropertyRows', () => {
  const row = (key: string, text = 'v', originalKey: string | null = null): PropertyRow => ({
    ...newPropertyRow(),
    key,
    text,
    originalKey,
  });

  it('accepts unique custom names and ignores blank new rows', () => {
    expect(validatePropertyRows([row('author'), row('tags'), row('', '')]).size).toBe(0);
  });

  it('reports a missing name, a duplicate and a managed name', () => {
    const missing = row('', 'value');
    const first = row('author');
    const second = row(' author ');
    const reserved = row('squisq-theme');
    const setting = row('title');
    const errors = validatePropertyRows([missing, first, second, reserved, setting]);
    expect(errors.get(missing.id)).toMatch(/name/);
    expect(errors.get(first.id)).toMatch(/already/);
    expect(errors.get(second.id)).toMatch(/already/);
    expect(errors.get(reserved.id)).toMatch(/reserved/);
    expect(errors.get(setting.id)).toMatch(/document setting/);
  });

  it('requires a name on a loaded row whose name was cleared', () => {
    const cleared = row('', 'Ines', 'author');
    expect(validatePropertyRows([cleared]).get(cleared.id)).toMatch(/name/);
  });
});

describe('planPropertyEdits / applyPropertyEdits', () => {
  it('leaves the source byte-identical when nothing was changed', () => {
    const properties = readCustomProperties(SOURCE);
    const plan = planPropertyEdits(properties, rowsFromProperties(properties));
    expect(isEmptyPropertyPlan(plan)).toBe(true);
    expect(applyPropertyEdits(SOURCE, plan)).toBe(SOURCE);
  });

  it('treats retyping the same value as no change', () => {
    const properties = readCustomProperties(SOURCE);
    const rows = setRow(rowsFromProperties(properties), 'author', { text: 'Ines Duarte ' });
    expect(isEmptyPropertyPlan(planPropertyEdits(properties, rows))).toBe(true);
  });

  it('changes a value in place, keeping a text value text', () => {
    const out = edit(SOURCE, (rows) => setRow(rows, 'version', { text: '2.0' }));
    expect(out).toBe(SOURCE.replace('version: "1.0"', 'version: "2.0"'));
  });

  it('renames in place and changes the value of the same row', () => {
    const out = edit(SOURCE, (rows) => setRow(rows, 'author', { key: 'writer', text: 'Ines' }));
    expect(out).toBe(SOURCE.replace('author: Ines Duarte', 'writer: Ines'));
  });

  it('writes an edited list back as a list', () => {
    const out = edit(SOURCE, (rows) => setRow(rows, 'tags', { text: 'harbor, silt, storms' }));
    expect(out).toContain('tags:\n  - harbor\n  - silt\n  - storms\nversion:');
    expect(parseMarkdown(out).frontmatter?.tags).toEqual(['harbor', 'silt', 'storms']);
  });

  it('renames a nested value without touching its body', () => {
    const out = edit(SOURCE, (rows) => setRow(rows, 'notes', { key: 'memo' }));
    expect(out).toBe(SOURCE.replace('notes: |-', 'memo: |-'));
  });

  it('deletes a property, body and all, keeping managed keys and comments', () => {
    const out = edit(SOURCE, (rows) => rows.filter((row) => row.originalKey !== 'extra'));
    expect(out).toBe(SOURCE.replace('extra:\n  nested: yes\n', ''));
    expect(out).toContain('# who wrote it');
  });

  it('lets a renamed row take the name of a deleted one', () => {
    const out = edit(SOURCE, (rows) =>
      setRow(
        rows.filter((row) => row.originalKey !== 'author'),
        'description',
        { key: 'author' },
      ),
    );
    const frontmatter = parseMarkdown(out).frontmatter;
    expect(frontmatter?.author).toBe('A season of measurements');
    expect(frontmatter).not.toHaveProperty('description');
  });

  it('appends a new property typed as hand-written YAML', () => {
    const out = edit(SOURCE, (rows) => [
      ...rows,
      { ...newPropertyRow(), key: 'published', text: 'false' },
    ]);
    expect(out).toContain('extra:\n  nested: yes\npublished: false\n---');
  });

  it('adds the first property to a document with no frontmatter', () => {
    const out = edit('# Body\n', (rows) => [
      ...rows,
      { ...newPropertyRow(), key: 'author', text: 'Ines' },
    ]);
    expect(out).toBe('---\nauthor: Ines\n---\n# Body\n');
  });

  it('drops the block when the last key goes', () => {
    expect(edit('---\nauthor: Ines\n---\n\n# Body\n', () => [])).toBe('\n# Body\n');
  });
});

describe('reconcilePropertyRows', () => {
  it('keeps row ids, takes source values, and keeps an unwritten edit', () => {
    const before = readCustomProperties('---\na: 1\nb: 2\n---\n');
    const rows = rowsFromProperties(before);
    const typing = rows.map((row) => (row.key === 'b' ? { ...row, text: '3' } : row));
    const after = readCustomProperties('---\na: 9\nb: 2\nc: 4\n---\n');
    const next = reconcilePropertyRows(typing, before, after);
    expect(next.map((row) => [row.key, row.text])).toEqual([
      ['a', '9'],
      ['b', '3'],
      ['c', '4'],
    ]);
    expect(next[0].id).toBe(rows[0].id);
    expect(next[1].id).toBe(rows[1].id);
  });

  it('carries a just-written row’s id to its new key', () => {
    const before = readCustomProperties('---\nauthor: Ines\n---\n');
    const [row] = rowsFromProperties(before);
    const added = { ...newPropertyRow(), key: 'tags', text: 'x' };
    const renamed = { ...row, key: 'writer', text: 'Ines D' };
    const after = readCustomProperties('---\nwriter: Ines D\ntags: x\n---\n');
    const next = reconcilePropertyRows(
      [renamed, added],
      before,
      after,
      new Map([
        ['writer', row.id],
        ['tags', added.id],
      ]),
    );
    expect(next.map((entry) => [entry.id, entry.originalKey, entry.key])).toEqual([
      [row.id, 'writer', 'writer'],
      [added.id, 'tags', 'tags'],
    ]);
  });

  it('keeps a new row nobody has written yet', () => {
    const before = readCustomProperties('---\na: 1\n---\n');
    const blank = newPropertyRow();
    const next = reconcilePropertyRows([...rowsFromProperties(before), blank], before, []);
    expect(next).toEqual([blank]);
  });
});
