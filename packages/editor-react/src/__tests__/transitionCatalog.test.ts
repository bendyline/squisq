import { describe, it, expect } from 'vitest';
import { isTransitionType } from '@bendyline/squisq/schemas';
import {
  TRANSITION_GROUPS,
  TRANSITION_ENTRIES,
  DIRECTION_OPTIONS,
  findTransitionEntry,
  transitionLabel,
} from '../transitionCatalog';

describe('transition catalog', () => {
  it('every curated value is a real core transition type', () => {
    for (const entry of TRANSITION_ENTRIES) {
      expect(isTransitionType(entry.value), entry.value).toBe(true);
    }
  });

  it('has no duplicate values across groups', () => {
    const values = TRANSITION_ENTRIES.map((e) => e.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('gives every entry a non-empty label', () => {
    for (const entry of TRANSITION_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('only uses known direction models', () => {
    for (const entry of TRANSITION_ENTRIES) {
      if (entry.direction) {
        expect(DIRECTION_OPTIONS[entry.direction]).toBeDefined();
      }
    }
  });

  it('flat list matches the groups', () => {
    expect(TRANSITION_ENTRIES).toEqual(TRANSITION_GROUPS.flatMap((g) => g.entries));
  });
});

describe('transitionLabel', () => {
  it('maps the empty value to None', () => {
    expect(transitionLabel('')).toBe('None');
  });

  it('uses the curated label for a known value', () => {
    expect(transitionLabel('pageCurl')).toBe('Page Curl');
  });

  it('humanizes an uncurated (but valid) alias', () => {
    expect(transitionLabel('ferris')).toBe('Ferris');
  });
});

describe('findTransitionEntry', () => {
  it('finds a curated entry', () => {
    expect(findTransitionEntry('push')?.direction).toBe('lrud');
  });

  it('returns undefined for an uncurated value', () => {
    expect(findTransitionEntry('ferris')).toBeUndefined();
  });
});
