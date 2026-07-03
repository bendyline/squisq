import { describe, expect, it } from 'vitest';
import {
  hasIconMarker,
  iconClass,
  iconMarker,
  splitIconMarkers,
  stripIconMarkers,
} from '../icons/inlineIconMarker';

describe('inline icon markers', () => {
  it('encodes icons with a private-use sentinel', () => {
    expect(iconMarker('solid', 'rocket')).toBe('\uE000solid:rocket\uE000');
  });

  it('detects and strips encoded markers from plain-text projections', () => {
    const text = `Launch ${iconMarker('solid', 'rocket')} now`;

    expect(hasIconMarker(text)).toBe(true);
    expect(stripIconMarkers(text)).toBe('Launch  now');
  });

  it('splits marker-bearing text into text and icon runs', () => {
    const text = `A ${iconMarker('regular', 'star')} and ${iconMarker('brands', 'github')}`;

    expect(splitIconMarkers(text)).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'icon', family: 'regular', name: 'star' },
      { type: 'text', text: ' and ' },
      { type: 'icon', family: 'brands', name: 'github' },
    ]);
  });

  it('builds FontAwesome class names', () => {
    expect(iconClass('solid', 'rocket')).toBe('fa-solid fa-rocket');
  });
});
