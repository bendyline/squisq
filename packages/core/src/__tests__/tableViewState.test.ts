import { describe, expect, it } from 'vitest';
import {
  applyTableViewState,
  inferNumericColumn,
  isNumericCellText,
  parseTableViewState,
  serializeTableViewState,
  type TableViewState,
} from '../table';
import { parseMarkdown, stringifyMarkdown } from '../markdown';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';

const HEADERS = ['Region', 'Revenue', 'Ratio A:B', 'Note'];

describe('parseTableViewState', () => {
  it('parses multi-term sort with default asc', () => {
    const { view, issues } = parseTableViewState('Revenue:desc,Region', undefined, HEADERS);
    expect(issues).toEqual([]);
    expect(view.sort).toEqual([
      { column: 'Revenue', dir: 'desc' },
      { column: 'Region', dir: 'asc' },
    ]);
  });

  it('parses quoted column names containing structural characters', () => {
    const { view, issues } = parseTableViewState('"Ratio A:B":desc', undefined, HEADERS);
    expect(issues).toEqual([]);
    expect(view.sort).toEqual([{ column: 'Ratio A:B', dir: 'desc' }]);
  });

  it('parses filter conjunctions with every operator', () => {
    const { view, issues } = parseTableViewState(
      undefined,
      'Region=West;Revenue>=1000;Note~beach;Note!~cold;Revenue!=0;Revenue<9000;Revenue>1;Revenue<=9000',
      HEADERS,
    );
    expect(issues).toEqual([]);
    expect(view.filter.map((c) => c.op)).toEqual(['=', '>=', '~', '!~', '!=', '<', '>', '<=']);
  });

  it('parses quoted filter values containing the clause separator', () => {
    const { view, issues } = parseTableViewState(undefined, 'Note~"a;b"', HEADERS);
    expect(issues).toEqual([]);
    expect(view.filter).toEqual([{ column: 'Note', op: '~', value: 'a;b' }]);
  });

  it('handles doubled quotes inside quoted tokens', () => {
    const { view } = parseTableViewState('"He said ""hi"""', undefined, ['He said "hi"']);
    expect(view.sort).toEqual([{ column: 'He said "hi"', dir: 'asc' }]);
  });

  it('drops unknown columns with an issue, keeping the rest', () => {
    const { view, issues } = parseTableViewState(
      'Nope:desc,Region',
      'Missing=1;Revenue>5',
      HEADERS,
    );
    expect(view.sort).toEqual([{ column: 'Region', dir: 'asc' }]);
    expect(view.filter).toEqual([{ column: 'Revenue', op: '>', value: '5' }]);
    expect(issues.map((i) => i.code)).toEqual([
      'data-view-unknown-column',
      'data-view-unknown-column',
    ]);
  });

  it('drops a malformed param wholesale while the other survives', () => {
    const { view, issues } = parseTableViewState('Revenue:sideways', 'Revenue>5', HEADERS);
    expect(view.sort).toEqual([]);
    expect(view.filter).toEqual([{ column: 'Revenue', op: '>', value: '5' }]);
    expect(issues.map((i) => i.code)).toEqual(['data-view-invalid']);
  });

  it('never throws on garbage', () => {
    for (const garbage of ['"unterminated', ':::', ',,,', 'a==b', ';;;', 'a>']) {
      expect(() => parseTableViewState(garbage, garbage, HEADERS)).not.toThrow();
    }
  });
});

describe('serializeTableViewState', () => {
  it('round-trips through parse, quoting only when needed', () => {
    const view: TableViewState = {
      sort: [
        { column: 'Revenue', dir: 'desc' },
        { column: 'Ratio A:B', dir: 'asc' },
      ],
      filter: [
        { column: 'Region', op: '=', value: 'West' },
        { column: 'Note', op: '~', value: 'a;b' },
      ],
    };
    const raw = serializeTableViewState(view);
    expect(raw.sort).toBe('Revenue:desc,"Ratio A:B"');
    expect(raw.filter).toBe('Region=West;Note~"a;b"');

    const reparsed = parseTableViewState(raw.sort, raw.filter, HEADERS);
    expect(reparsed.issues).toEqual([]);
    expect(reparsed.view).toEqual(view);
  });

  it('omits empty halves', () => {
    expect(serializeTableViewState({ sort: [], filter: [] })).toEqual({});
  });
});

describe('numeric-column inference', () => {
  it('follows the shared rule: all non-blank numeric, no leading zeros', () => {
    expect(isNumericCellText('42')).toBe(true);
    expect(isNumericCellText('-5.5')).toBe(true);
    expect(isNumericCellText('007')).toBe(false);
    expect(isNumericCellText('abc')).toBe(false);
    expect(isNumericCellText('')).toBe(false);

    const rows = [
      ['1', 'x'],
      ['', 'y'],
      ['3', '2'],
    ];
    expect(inferNumericColumn(rows, 0)).toBe(true);
    expect(inferNumericColumn(rows, 1)).toBe(false);
  });
});

describe('applyTableViewState', () => {
  const rows = [
    ['West', '100', 'v2'],
    ['East', '2000', 'v10'],
    ['West', '', 'v1'],
    ['North', '30', 'v10'],
  ];
  const headers = ['Region', 'Revenue', 'Tag'];

  it('sorts numerically on numeric columns with blanks last', () => {
    const { rows: sorted, rowIds } = applyTableViewState(headers, rows, {
      sort: [{ column: 'Revenue', dir: 'asc' }],
      filter: [],
    });
    expect(sorted.map((r) => r[1])).toEqual(['30', '100', '2000', '']);
    expect(rowIds).toEqual([3, 0, 1, 2]);
  });

  it('keeps blanks last under desc too', () => {
    const { rows: sorted } = applyTableViewState(headers, rows, {
      sort: [{ column: 'Revenue', dir: 'desc' }],
      filter: [],
    });
    expect(sorted.map((r) => r[1])).toEqual(['2000', '100', '30', '']);
  });

  it('uses numeric-aware collation for text ("v2" < "v10")', () => {
    const { rows: sorted } = applyTableViewState(headers, rows, {
      sort: [{ column: 'Tag', dir: 'asc' }],
      filter: [],
    });
    expect(sorted.map((r) => r[2])).toEqual(['v1', 'v2', 'v10', 'v10']);
  });

  it('is stable across equal keys (source order preserved)', () => {
    const { rowIds } = applyTableViewState(headers, rows, {
      sort: [{ column: 'Region', dir: 'asc' }],
      filter: [],
    });
    // Two 'West' rows keep source order 0 then 2.
    expect(rowIds.filter((id) => rows[id][0] === 'West')).toEqual([0, 2]);
  });

  it('filters numerically and reports unfiltered count', () => {
    const applied = applyTableViewState(headers, rows, {
      sort: [],
      filter: [{ column: 'Revenue', op: '>=', value: '100' }],
    });
    expect(applied.rows.map((r) => r[0])).toEqual(['West', 'East']);
    expect(applied.unfilteredRowCount).toBe(4);
  });

  it('matches blanks only via equality with empty', () => {
    const blanks = applyTableViewState(headers, rows, {
      sort: [],
      filter: [{ column: 'Revenue', op: '=', value: '' }],
    });
    expect(blanks.rowIds).toEqual([2]);
    const nonBlank = applyTableViewState(headers, rows, {
      sort: [],
      filter: [{ column: 'Revenue', op: '>', value: '0' }],
    });
    expect(nonBlank.rowIds).toEqual([0, 1, 3]);
  });

  it('applies contains case-insensitively', () => {
    const applied = applyTableViewState(headers, rows, {
      sort: [],
      filter: [{ column: 'Region', op: '~', value: 'wEsT' }],
    });
    expect(applied.rowIds).toEqual([0, 2]);
  });
});

describe('view-state params round-trip through the document', () => {
  it('re-emits sort/filter params byte-stably', () => {
    const source = [
      '## Q3 {[dataTable src=data/q3.csv sort=Revenue:desc filter=Region=West]}',
      '',
      '[q3.csv](data/q3.csv)',
      '',
    ].join('\n');

    const doc = markdownToDoc(parseMarkdown(source));
    expect(doc.blocks[0].templateOverrides?.sort).toBe('Revenue:desc');
    expect(doc.blocks[0].templateOverrides?.filter).toBe('Region=West');

    const emitted = stringifyMarkdown(docToMarkdown(doc));
    expect(emitted).toBe(source);
  });

  describe('operator extensions (starts/ends-with + case modifier)', () => {
    const HEADERS = ['Region', 'Note'];

    it('parses and round-trips the anchored ops and the * modifier', () => {
      const { view, issues } = parseTableViewState(
        undefined,
        'Region^~No;Note$~ing;Region=*West;Note!~*COLD',
        HEADERS,
      );
      expect(issues).toEqual([]);
      expect(view.filter).toEqual([
        { column: 'Region', op: '^~', value: 'No' },
        { column: 'Note', op: '$~', value: 'ing' },
        { column: 'Region', op: '=', value: 'West', caseSensitive: true },
        { column: 'Note', op: '!~', value: 'COLD', caseSensitive: true },
      ]);
      const raw = serializeTableViewState(view);
      expect(raw.filter).toBe('Region^~No;Note$~ing;Region=*West;Note!~*COLD');
      // Byte-stable through a second cycle.
      const again = parseTableViewState(undefined, raw.filter, HEADERS);
      expect(serializeTableViewState(again.view).filter).toBe(raw.filter);
    });

    it('quotes values that would fuse with op/modifier characters', () => {
      const view = {
        sort: [],
        filter: [
          { column: 'Note', op: '~' as const, value: '*star' },
          { column: 'Note', op: '=' as const, value: '^caret$' },
        ],
      };
      const raw = serializeTableViewState(view).filter!;
      expect(raw).toBe('Note~"*star";Note="^caret$"');
      const { view: reparsed, issues } = parseTableViewState(undefined, raw, HEADERS);
      expect(issues).toEqual([]);
      expect(reparsed.filter).toEqual(view.filter);
    });

    it('never serializes the modifier on comparison ops', () => {
      const raw = serializeTableViewState({
        sort: [],
        filter: [{ column: 'Region', op: '>', value: 'M', caseSensitive: true }],
      });
      expect(raw.filter).toBe('Region>M');
    });
  });
});

describe('applyTableViewState — operator semantics', () => {
  const HEADERS = ['Region', 'Revenue'];
  const ROWS = [
    ['West', '100'],
    ['west', '200'],
    ['Northwest', '300'],
    ['South', '400'],
    ['', '500'],
  ];
  const apply = (filter: import('../table').FilterClause[]) =>
    applyTableViewState(HEADERS, ROWS, { sort: [], filter }).rowIds;

  it('text equality is case-insensitive by default, exact with the flag', () => {
    expect(apply([{ column: 'Region', op: '=', value: 'west' }])).toEqual([0, 1]);
    expect(apply([{ column: 'Region', op: '=', value: 'west', caseSensitive: true }])).toEqual([1]);
    expect(apply([{ column: 'Region', op: '!=', value: 'west' }])).toEqual([2, 3, 4]);
  });

  it('starts-with and ends-with anchor correctly, honoring the case flag', () => {
    expect(apply([{ column: 'Region', op: '^~', value: 'west' }])).toEqual([0, 1]);
    expect(apply([{ column: 'Region', op: '^~', value: 'West', caseSensitive: true }])).toEqual([
      0,
    ]);
    expect(apply([{ column: 'Region', op: '$~', value: 'WEST' }])).toEqual([0, 1, 2]);
    expect(apply([{ column: 'Region', op: '$~', value: 'west', caseSensitive: true }])).toEqual([
      1, 2,
    ]);
    // Blanks never match the anchored ops.
    expect(apply([{ column: 'Region', op: '^~', value: '' }])).toEqual([0, 1, 2, 3]);
  });

  it('case-sensitive contains narrows what ci contains matched', () => {
    expect(apply([{ column: 'Region', op: '~', value: 'WEST' }])).toEqual([0, 1, 2]);
    expect(apply([{ column: 'Region', op: '~', value: 'West', caseSensitive: true }])).toEqual([0]); // "Northwest" has a lowercase w
    expect(apply([{ column: 'Region', op: '~', value: 'west', caseSensitive: true }])).toEqual([
      1, 2,
    ]);
  });

  it('numeric equality is untouched by the case machinery', () => {
    expect(apply([{ column: 'Revenue', op: '=', value: '200', caseSensitive: true }])).toEqual([1]);
  });
});
