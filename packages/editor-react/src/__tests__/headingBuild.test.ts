import { describe, expect, it } from 'vitest';
import { readHeadingBuild, setHeadingBuild } from '../headingBuild';

describe('build authoring', () => {
  it('reads both channels with Pandoc precedence and migrates the entire family atomically', () => {
    expect(readHeadingBuild('build=branches', 'build=items')).toEqual({ mode: 'branches' });
    const next = setHeadingBuild(
      'build=branches buildDuration=2 duration=12 #stable',
      'build=items buildEffect=fadeIn colorScheme=blue',
      { mode: 'chunks', duration: 0.4 },
    );
    expect(next.blockAttrsInner).toContain('duration=12');
    expect(next.blockAttrsInner).toContain('#stable');
    expect(next.blockAttrsInner).not.toContain('build');
    expect(readHeadingBuild(next.blockAttrsInner, next.templateParams)).toEqual({
      mode: 'chunks',
      duration: 0.4,
    });
    expect(next.templateParams).toContain('colorScheme=blue');
    const cleared = setHeadingBuild(next.blockAttrsInner, next.templateParams);
    expect(readHeadingBuild(cleared.blockAttrsInner, cleared.templateParams)).toBeUndefined();
    expect(cleared.templateParams).toBe('colorScheme=blue');
  });
});
