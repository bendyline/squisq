/**
 * Pins the fix for GHSA-cp6q-959q-f8rh.
 *
 * Tiptap's `mergeAttributes()` used to assign every key with bracket syntax, so
 * an own `__proto__` key — exactly what `JSON.parse` produces from document or
 * model output — invoked the legacy prototype setter. ProseMirror's DOM
 * serializer walks the result with `for…in`, so the injected prototype's keys
 * became real attributes: an `onerror` handler, for instance.
 *
 * Tiptap fixed it in 3.30.4 and backported the same guard to 2.27.3, but the
 * advisory still lists every 2.x release as affected, so an audit cannot tell
 * the two apart. This test can: it fails on an unpatched `@tiptap/core`,
 * whether that arrives through a downgrade or a migration to an unpatched line.
 */
import { mergeAttributes } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

function enumeratedKeys(value: object): string[] {
  const keys: string[] = [];
  // Deliberately `for…in`: it is how ProseMirror's serializer reads attributes,
  // and unlike Object.keys it reaches inherited properties.
  for (const key in value) keys.push(key);
  return keys;
}

describe('mergeAttributes prototype safety', () => {
  it('keeps an own __proto__ key from becoming the merged prototype', () => {
    const hostile = JSON.parse('{"__proto__": {"onerror": "alert(1)"}}') as Record<string, unknown>;

    const merged = mergeAttributes({ class: 'squisq-node' }, hostile);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(enumeratedKeys(merged)).not.toContain('onerror');
  });

  it('still merges ordinary attributes normally', () => {
    expect(mergeAttributes({ class: 'a', title: 'x' }, { class: 'b' })).toEqual({
      class: 'a b',
      title: 'x',
    });
  });
});
