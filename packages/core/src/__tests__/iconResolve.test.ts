import { describe, it, expect } from 'vitest';
import {
  resolveIcon,
  canonicalIconToken,
  looksLikeIconToken,
  suggestIcons,
} from '../icons/resolve';

describe('resolveIcon — bare tokens', () => {
  it('resolves a name that is unique across families', () => {
    // `github` only exists in fa-brands.
    const icon = resolveIcon('github');
    expect(icon).not.toBeNull();
    expect(icon!.family).toBe('brands');
    expect(icon!.name).toBe('github');
  });

  it('returns null for a name that collides across families', () => {
    // `user` ships in both solid and regular — bare form is ambiguous.
    const icon = resolveIcon('user');
    expect(icon).toBeNull();
  });

  it('returns null for unknown names', () => {
    expect(resolveIcon('totallyMadeUp_____Name')).toBeNull();
  });
});

describe('resolveIcon — qualified tokens', () => {
  it('resolves an ambiguous name with the fa-solid: prefix', () => {
    const icon = resolveIcon('fa-solid:user');
    expect(icon).not.toBeNull();
    expect(icon!.family).toBe('solid');
    expect(icon!.name).toBe('user');
  });

  it('resolves the same name in the other family', () => {
    const icon = resolveIcon('fa-regular:user');
    expect(icon).not.toBeNull();
    expect(icon!.family).toBe('regular');
  });

  it('accepts short family prefixes too', () => {
    const icon = resolveIcon('brands:github');
    expect(icon).not.toBeNull();
    expect(icon!.family).toBe('brands');
  });

  it('returns null for an unknown family prefix', () => {
    expect(resolveIcon('fa-foo:github')).toBeNull();
  });

  it('returns null for a qualified token whose name does not exist in that family', () => {
    expect(resolveIcon('fa-brands:user')).toBeNull();
  });
});

describe('canonicalIconToken', () => {
  it('emits the bare form for unique names', () => {
    const icon = resolveIcon('github')!;
    expect(canonicalIconToken(icon)).toBe('github');
  });

  it('emits the qualified form for ambiguous names', () => {
    const icon = resolveIcon('fa-solid:user')!;
    expect(canonicalIconToken(icon)).toBe('fa-solid:user');
  });
});

describe('suggestIcons', () => {
  it('ranks "starts with" matches above "contains" matches', () => {
    const results = suggestIcons('git');
    // `github` (brands) starts with "git" → score 0; `digital-tachograph`
    // contains "git" → score 1. The first must outrank the latter.
    const githubIdx = results.findIndex((r) => r.entry.name === 'github');
    const containsIdx = results.findIndex(
      (r) => r.entry.name.includes('git') && !r.entry.name.startsWith('git'),
    );
    expect(githubIdx).toBeGreaterThanOrEqual(0);
    if (containsIdx >= 0) {
      expect(githubIdx).toBeLessThan(containsIdx);
    }
  });

  it('returns canonical tokens (bare when unique, qualified otherwise)', () => {
    const results = suggestIcons('user');
    const userTokens = results.filter((r) => r.entry.name === 'user').map((r) => r.token);
    // `user` is ambiguous — each match must be qualified.
    expect(userTokens.every((t) => t.startsWith('fa-'))).toBe(true);
  });

  it('matches by keyword too', () => {
    const results = suggestIcons('octocat'); // a github keyword
    expect(results.some((r) => r.entry.name === 'github')).toBe(true);
  });

  it('honors the limit parameter', () => {
    expect(suggestIcons('e', 5)).toHaveLength(5);
  });

  it('returns nothing useful for whitespace-only queries', () => {
    // Empty / whitespace queries return the first N icons (score 3
    // bucket) — useful as a "browse the catalog" affordance in pickers.
    const results = suggestIcons('   ', 10);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.score === 3)).toBe(true);
  });
});

describe('looksLikeIconToken', () => {
  it('accepts alphanumeric tokens with hyphens, underscores, and one colon', () => {
    expect(looksLikeIconToken('github')).toBe(true);
    expect(looksLikeIconToken('fa-solid:user')).toBe(true);
    expect(looksLikeIconToken('face-smile_wink')).toBe(true);
  });

  it('rejects whitespace and special characters', () => {
    expect(looksLikeIconToken('hello world')).toBe(false);
    expect(looksLikeIconToken('with/slash')).toBe(false);
    expect(looksLikeIconToken('with$dollar')).toBe(false);
  });
});
