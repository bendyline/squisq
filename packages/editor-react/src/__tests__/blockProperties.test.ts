import { describe, it, expect } from 'vitest';
import {
  readBlockAttrsParams,
  readBlockAttrsValue,
  setBlockAttrsValue,
  summarizeBlockProps,
} from '../blockProperties';

describe('readBlockAttrsParams', () => {
  it('returns empty for null/empty inner', () => {
    expect(readBlockAttrsParams(null)).toEqual({});
    expect(readBlockAttrsParams('')).toEqual({});
  });

  it('parses key=value params (ignoring #id / .class)', () => {
    expect(readBlockAttrsParams('#intro .lead duration=45 startTime=5')).toEqual({
      duration: '45',
      startTime: '5',
    });
  });
});

describe('readBlockAttrsValue', () => {
  it('reads a single param or empty string', () => {
    expect(readBlockAttrsValue('duration=45', 'duration')).toBe('45');
    expect(readBlockAttrsValue('duration=45', 'startTime')).toBe('');
    expect(readBlockAttrsValue(null, 'duration')).toBe('');
  });
});

describe('setBlockAttrsValue', () => {
  it('adds a param to a fresh block', () => {
    expect(setBlockAttrsValue(null, 'duration', '45')).toBe('duration=45');
  });

  it('updates an existing param in place, preserving order and other keys', () => {
    expect(setBlockAttrsValue('#intro duration=10 startTime=2', 'duration', '20')).toBe(
      '#intro duration=20 startTime=2',
    );
  });

  it('removes a param when set to empty, dropping the block when nothing remains', () => {
    expect(setBlockAttrsValue('duration=45', 'duration', '')).toBeNull();
    expect(setBlockAttrsValue('#intro duration=45', 'duration', '  ')).toBe('#intro');
  });

  it('does not disturb a transition already present', () => {
    expect(setBlockAttrsValue('transition=fade', 'duration', '3')).toBe(
      'transition=fade duration=3',
    );
  });

  it('round-trips through read', () => {
    const inner = setBlockAttrsValue(setBlockAttrsValue(null, 'duration', '12'), 'startTime', '4');
    expect(readBlockAttrsValue(inner, 'duration')).toBe('12');
    expect(readBlockAttrsValue(inner, 'startTime')).toBe('4');
  });
});

describe('summarizeBlockProps', () => {
  it('returns empty when nothing is set', () => {
    expect(summarizeBlockProps(null, null)).toBe('');
    expect(summarizeBlockProps('#intro', null)).toBe('');
  });

  it('names the transition using its friendly label', () => {
    expect(summarizeBlockProps('transition=doors', null)).toBe('Doors');
  });

  it('formats start time and duration as m:ss', () => {
    expect(summarizeBlockProps('startTime=90', null)).toBe('1:30 start');
    expect(summarizeBlockProps('duration=200', null)).toBe('3:20 long');
  });

  it('accepts already-formatted m:ss time values', () => {
    expect(summarizeBlockProps('startTime=1:30', null)).toBe('1:30 start');
  });

  it('joins all set properties in order with a middot', () => {
    expect(summarizeBlockProps('transition=vortex startTime=90 duration=200', null)).toBe(
      'Vortex · 1:30 start · 3:20 long',
    );
  });

  it('reads a hand-typed transition from the {[…]} params', () => {
    expect(summarizeBlockProps(null, 'title transition=zoom')).toBe('Zoom');
  });

  it('normalizes a transition alias spelling for the label', () => {
    expect(summarizeBlockProps('transition=Doors', null)).toBe('Doors');
  });
});
