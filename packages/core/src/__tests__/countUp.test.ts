import { describe, expect, it } from 'vitest';
import {
  countUpSpecFor,
  formatCountUp,
  formatCountValue,
  parseStatNumber,
} from '../doc/utils/countUp.js';

describe('parseStatNumber', () => {
  it('splits prefix, number and suffix', () => {
    expect(parseStatNumber('73%')).toEqual({
      prefix: '',
      value: 73,
      decimals: 0,
      grouping: false,
      suffix: '%',
    });
    expect(parseStatNumber('$1.25M')).toEqual({
      prefix: '$',
      value: 1.25,
      decimals: 2,
      grouping: false,
      suffix: 'M',
    });
    expect(parseStatNumber('12,000 km')).toEqual({
      prefix: '',
      value: 12000,
      decimals: 0,
      grouping: true,
      suffix: ' km',
    });
    expect(parseStatNumber('−5°C')).toMatchObject({ value: -5, suffix: '°C' });
    expect(parseStatNumber('Over 3 rivers')).toMatchObject({
      prefix: 'Over ',
      value: 3,
      suffix: ' rivers',
    });
  });

  it('refuses prose and bare years', () => {
    expect(parseStatNumber('Unknown')).toBeNull();
    expect(parseStatNumber('1889')).toBeNull();
    expect(parseStatNumber('2021')).toBeNull();
    // Money and suffixed magnitudes are not years.
    expect(parseStatNumber('$1889')).toMatchObject({ value: 1889 });
    expect(parseStatNumber('1889 km')).toMatchObject({ value: 1889 });
    expect(parseStatNumber('12345')).toMatchObject({ value: 12345 });
  });
});

describe('formatCountUp', () => {
  const animation = { type: 'countUp' as const, duration: 2, delay: 0.5 };

  it('shows the start value before the delay and the authored text once done', () => {
    expect(formatCountUp('73%', animation, 0)).toBe('0%');
    expect(formatCountUp('73%', animation, 0.5)).toBe('0%');
    expect(formatCountUp('73%', animation, 2.5)).toBe('73%');
    expect(formatCountUp('73%', animation, 99)).toBe('73%');
  });

  it('eases toward the target and keeps decimals and grouping', () => {
    const mid = formatCountUp('12,000 km', animation, 1.5);
    const value = Number(mid.replace(/,/g, '').replace(' km', ''));
    expect(value).toBeGreaterThan(6000);
    expect(value).toBeLessThan(12000);
    expect(mid).toMatch(/^\d{1,2},\d{3} km$/);
    expect(formatCountUp('$1.25M', animation, 1.5)).toMatch(/^\$\d\.\d{2}M$/);
  });

  it('uses an explicit count spec over the text', () => {
    const spec = countUpSpecFor('73%')!;
    expect(formatCountUp('anything', { ...animation, count: { ...spec, to: 50 } }, 99)).toBe('50%');
    expect(formatCountUp('no number here', animation, 1)).toBe('no number here');
  });

  it('formats values', () => {
    expect(formatCountValue(1234567.891, 1, true)).toBe('1,234,567.9');
    expect(formatCountValue(-0.4, 0, false)).toBe('0');
    expect(formatCountValue(-12, 0, false)).toBe('-12');
  });
});
