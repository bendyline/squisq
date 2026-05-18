import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EmojiPicker } from '../EmojiPicker';
import {
  EMOJI_CATEGORIES,
  ALL_EMOJIS,
  searchEmojis,
  PICKER_CATEGORIES,
  ALL_PICKER_ENTRIES,
  searchPickerEntries,
} from '../emojiData';

describe('emojiData — legacy emoji exports', () => {
  it('exposes the standard CLDR category buckets', () => {
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      'smileys',
      'people',
      'nature',
      'food',
      'travel',
      'activities',
      'objects',
      'symbols',
      'flags',
    ]);
  });

  it('each entry has a non-empty char and name', () => {
    for (const entry of ALL_EMOJIS) {
      expect(entry.char.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('searchEmojis matches by name (case-insensitive)', () => {
    const results = searchEmojis('HEART');
    expect(results.some((e) => e.char === '❤️')).toBe(true);
  });
});

describe('emojiData — unified picker entries', () => {
  it('appends FA Brands, Solid, and Regular categories after the emoji buckets', () => {
    const ids = PICKER_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('fa-brands');
    expect(ids).toContain('fa-solid');
    expect(ids).toContain('fa-regular');
    // Order matters — emoji first, FA after.
    expect(ids.indexOf('smileys')).toBeLessThan(ids.indexOf('fa-brands'));
  });

  it('FA categories carry icon-kind entries', () => {
    const brands = PICKER_CATEGORIES.find((c) => c.id === 'fa-brands')!;
    expect(brands.entries.length).toBeGreaterThan(0);
    const github = brands.entries.find((e) => e.kind === 'icon' && e.name === 'github');
    expect(github).toBeDefined();
    expect(github!.kind).toBe('icon');
  });

  it('searchPickerEntries matches across emoji and icons', () => {
    const emojiHit = searchPickerEntries('heart').find((e) => e.kind === 'emoji');
    const iconHit = searchPickerEntries('github').find((e) => e.kind === 'icon');
    expect(emojiHit).toBeDefined();
    expect(iconHit).toBeDefined();
  });

  it('ALL_PICKER_ENTRIES is the concat of all categories', () => {
    const sum = PICKER_CATEGORIES.reduce((acc, c) => acc + c.entries.length, 0);
    expect(ALL_PICKER_ENTRIES.length).toBe(sum);
  });
});

describe('EmojiPicker', () => {
  it('does not render when closed', () => {
    render(<EmojiPicker open={false} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId('emoji-picker')).toBeNull();
  });

  it('renders all emoji + FA tabs when open', () => {
    render(<EmojiPicker open onSelect={() => {}} onClose={() => {}} />);
    for (const cat of EMOJI_CATEGORIES) {
      expect(screen.getByRole('tab', { name: cat.label })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Brands' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Solid' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Regular' })).toBeTruthy();
  });

  it('fires onSelect with an emoji PickerEntry when an emoji tile is clicked', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker open onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'grinning' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: 'emoji', char: '😀' }));
  });

  it('fires onSelect with an icon PickerEntry when an FA tile is clicked', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker open onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Brands' }));
    fireEvent.click(screen.getByRole('button', { name: 'Github' }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'icon', family: 'brands', name: 'github' }),
    );
  });

  it('switches categories when a tab is clicked', () => {
    render(<EmojiPicker open onSelect={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Nature' }));
    expect(screen.getByRole('button', { name: 'dog face' })).toBeTruthy();
  });

  it('shows search results across emoji + icons and hides the tabs', () => {
    render(<EmojiPicker open onSelect={() => {}} onClose={() => {}} />);
    const search = screen.getByLabelText('Search emoji & icons') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'github' } });
    expect(screen.getByRole('button', { name: 'Github' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Smileys' })).toBeNull();
  });

  it('shows a no-matches state when search returns nothing', () => {
    render(<EmojiPicker open onSelect={() => {}} onClose={() => {}} />);
    const search = screen.getByLabelText('Search emoji & icons') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'thisdoesnotexist' } });
    expect(screen.getByText(/No matches for/i)).toBeTruthy();
  });

  it('fires onClose on Escape', () => {
    const onClose = vi.fn();
    render(<EmojiPicker open onSelect={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
