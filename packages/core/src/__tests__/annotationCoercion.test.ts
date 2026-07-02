import { describe, it, expect } from 'vitest';
import {
  coerceAnnotationValues,
  parseTimeSeconds,
  parseConnectionList,
  KNOWN_BLOCK_META_KEYS,
  BLOCK_META_KEY_DESCRIPTORS,
} from '../markdown/annotationCoercion.js';
import { TRANSITION_TYPES, TRANSITION_DIRECTIONS } from '../schemas/Transitions.js';

describe('parseTimeSeconds', () => {
  it('accepts bare seconds (integer)', () => {
    expect(parseTimeSeconds('5')).toBe(5);
  });

  it('accepts bare seconds (decimal)', () => {
    expect(parseTimeSeconds('5.5')).toBe(5.5);
  });

  it('accepts mm:ss', () => {
    expect(parseTimeSeconds('01:30')).toBe(90);
    expect(parseTimeSeconds('0:05')).toBe(5);
    expect(parseTimeSeconds('10:00')).toBe(600);
  });

  it('accepts mm:ss.ms (fractional seconds)', () => {
    expect(parseTimeSeconds('01:30.500')).toBeCloseTo(90.5, 6);
    expect(parseTimeSeconds('02:30.5')).toBeCloseTo(150.5, 6);
  });

  it('accepts Nms (milliseconds)', () => {
    expect(parseTimeSeconds('1500ms')).toBe(1.5);
    expect(parseTimeSeconds('0ms')).toBe(0);
  });

  it('trims leading/trailing whitespace', () => {
    expect(parseTimeSeconds('  90  ')).toBe(90);
  });

  it('rejects malformed input', () => {
    expect(parseTimeSeconds('not-a-time')).toBeNull();
    expect(parseTimeSeconds('99:bad')).toBeNull();
    expect(parseTimeSeconds('')).toBeNull();
    expect(parseTimeSeconds('  ')).toBeNull();
  });

  it('rejects seconds field >= 60', () => {
    expect(parseTimeSeconds('1:60')).toBeNull();
    expect(parseTimeSeconds('1:75')).toBeNull();
  });
});

describe('parseConnectionList', () => {
  it('parses a single bare target', () => {
    expect(parseConnectionList('foo')).toEqual({
      list: [{ target: 'foo' }],
      warning: null,
    });
  });

  it('parses target:type pairs', () => {
    expect(parseConnectionList('foo:flow')).toEqual({
      list: [{ target: 'foo', type: 'flow' }],
      warning: null,
    });
  });

  it('parses mixed bare + typed entries', () => {
    expect(parseConnectionList('foo:veryImportant,bar:requires,baz:requires')).toEqual({
      list: [
        { target: 'foo', type: 'veryImportant' },
        { target: 'bar', type: 'requires' },
        { target: 'baz', type: 'requires' },
      ],
      warning: null,
    });
  });

  it('trims whitespace around items', () => {
    expect(parseConnectionList('foo, bar:flow , baz').list).toEqual([
      { target: 'foo' },
      { target: 'bar', type: 'flow' },
      { target: 'baz' },
    ]);
  });

  it('returns empty list for empty input', () => {
    expect(parseConnectionList('')).toEqual({ list: [], warning: null });
    expect(parseConnectionList('   ')).toEqual({ list: [], warning: null });
  });

  it('filters empty segments and warns', () => {
    const result = parseConnectionList('a,,b');
    expect(result.list).toEqual([{ target: 'a' }, { target: 'b' }]);
    expect(result.warning).toContain('empty');
  });

  it('drops entries with empty target before colon', () => {
    const result = parseConnectionList(':flow,foo');
    expect(result.list).toEqual([{ target: 'foo' }]);
    expect(result.warning).toContain('empty');
  });

  it('treats target:<empty> as a bare target (no type)', () => {
    expect(parseConnectionList('foo:').list).toEqual([{ target: 'foo' }]);
  });
});

describe('coerceAnnotationValues', () => {
  it('routes known keys to blockMeta, unknown to metadata', () => {
    const result = coerceAnnotationValues({
      x: '400',
      y: '200',
      priority: 'high',
      caption: 'hello',
    });
    expect(result.blockMeta).toEqual({ x: 400, y: 200 });
    expect(result.metadata).toEqual({ priority: 'high', caption: 'hello' });
    expect(result.warnings).toEqual([]);
  });

  it('coerces startTime and duration to seconds', () => {
    const result = coerceAnnotationValues({
      startTime: '01:30',
      duration: '00:15',
    });
    expect(result.blockMeta).toEqual({ startTime: 90, duration: 15 });
  });

  it('coerces connectsTo into a BlockConnection list', () => {
    const result = coerceAnnotationValues({
      connectsTo: 'foo:veryImportant,bar:requires,baz:requires',
    });
    expect(result.blockMeta.connectsTo).toEqual([
      { target: 'foo', type: 'veryImportant' },
      { target: 'bar', type: 'requires' },
      { target: 'baz', type: 'requires' },
    ]);
  });

  it('drops malformed numbers with a warning', () => {
    const result = coerceAnnotationValues({ x: 'not-a-number' });
    expect(result.blockMeta.x).toBeUndefined();
    expect(result.metadata).toEqual({});
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('x');
  });

  it('drops malformed time values with a warning', () => {
    const result = coerceAnnotationValues({ startTime: '99:bad' });
    expect(result.blockMeta.startTime).toBeUndefined();
    expect(result.warnings.length).toBe(1);
  });

  it('preserves empty connection list without warning', () => {
    const result = coerceAnnotationValues({ connectsTo: '' });
    expect(result.blockMeta.connectsTo).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('coerces transition metadata', () => {
    const result = coerceAnnotationValues({
      transition: 'random-bars',
      transitionDuration: '850ms',
      transitionDirection: 'left',
    });

    expect(result.blockMeta.transition).toEqual({
      type: 'randomBars',
      duration: 0.85,
      direction: 'left',
    });
    expect(result.metadata).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it('drops malformed transition values with warnings', () => {
    const result = coerceAnnotationValues({
      transition: 'sideways-fold',
      transitionDuration: 'fast',
      transitionDirection: 'diagonal',
    });

    expect(result.blockMeta.transition).toBeUndefined();
    expect(result.metadata).toEqual({});
    expect(result.warnings).toHaveLength(3);
  });

  it('emits a warning for connectsTo with empty segments', () => {
    const result = coerceAnnotationValues({ connectsTo: 'a,,b' });
    expect(result.blockMeta.connectsTo).toEqual([{ target: 'a' }, { target: 'b' }]);
    expect(result.warnings.length).toBe(1);
  });

  it('handles an empty input map', () => {
    expect(coerceAnnotationValues({})).toEqual({
      blockMeta: {},
      metadata: {},
      warnings: [],
    });
  });
});

describe('KNOWN_BLOCK_META_KEYS', () => {
  it('lists the expected typed keys', () => {
    expect(Object.keys(KNOWN_BLOCK_META_KEYS).sort()).toEqual([
      'connectsTo',
      'duration',
      'startTime',
      'transition',
      'transitionDirection',
      'transitionDuration',
      'x',
      'y',
    ]);
  });
});

describe('BLOCK_META_KEY_DESCRIPTORS', () => {
  it('describes exactly the keys in KNOWN_BLOCK_META_KEYS', () => {
    const described = BLOCK_META_KEY_DESCRIPTORS.map((d) => d.key).sort();
    expect(described).toEqual(Object.keys(KNOWN_BLOCK_META_KEYS).sort());
  });

  it('has no duplicate keys', () => {
    const keys = BLOCK_META_KEY_DESCRIPTORS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives each key either a closed value set or a format hint, never both', () => {
    for (const d of BLOCK_META_KEY_DESCRIPTORS) {
      expect(Boolean(d.values) !== Boolean(d.valueHint)).toBe(true);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('sources transition value sets from the canonical vocabulary', () => {
    const transition = BLOCK_META_KEY_DESCRIPTORS.find((d) => d.key === 'transition');
    const direction = BLOCK_META_KEY_DESCRIPTORS.find((d) => d.key === 'transitionDirection');
    expect(transition?.values).toBe(TRANSITION_TYPES);
    expect(direction?.values).toBe(TRANSITION_DIRECTIONS);
  });
});
