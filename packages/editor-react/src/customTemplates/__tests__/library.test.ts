/**
 * library — localStorage-backed library of user-defined templates.
 *
 * Verifies the CRUD shape (list / save / delete / clear), and that
 * each operation persists across reads. Uses jsdom's localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listLibraryTemplates,
  saveLibraryTemplate,
  deleteLibraryTemplate,
  clearLibrary,
  LIBRARY_STORAGE_KEY,
} from '../library';
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';

function defn(name: string, label = name): CustomTemplateDefinition {
  return {
    name,
    label,
    viewport: { width: 1920, height: 1080 },
    layers: [
      {
        id: 'a',
        type: 'text',
        position: { x: '0%', y: '0%', width: '100%' },
        content: { text: name, style: { fontSize: 24, color: '#000' } },
      },
    ],
  };
}

describe('library', () => {
  beforeEach(() => {
    clearLibrary();
  });

  it('returns an empty list when no templates are saved', () => {
    expect(listLibraryTemplates()).toEqual([]);
  });

  it('saveLibraryTemplate persists across reads', () => {
    saveLibraryTemplate(defn('a', 'Alpha'));
    expect(listLibraryTemplates().map((t) => t.name)).toEqual(['a']);
    expect(window.localStorage.getItem(LIBRARY_STORAGE_KEY)).toBeTruthy();
  });

  it('saving a template with an existing name replaces it', () => {
    saveLibraryTemplate(defn('a', 'Alpha'));
    saveLibraryTemplate({ ...defn('a', 'Alpha v2'), description: 'updated' });
    const list = listLibraryTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('Alpha v2');
    expect(list[0].description).toBe('updated');
  });

  it('list sorts by label', () => {
    saveLibraryTemplate(defn('z', 'Zebra'));
    saveLibraryTemplate(defn('a', 'Aardvark'));
    saveLibraryTemplate(defn('m', 'Mango'));
    expect(listLibraryTemplates().map((t) => t.label)).toEqual(['Aardvark', 'Mango', 'Zebra']);
  });

  it('deleteLibraryTemplate removes by name and is a no-op for missing names', () => {
    saveLibraryTemplate(defn('a'));
    saveLibraryTemplate(defn('b'));
    let after = deleteLibraryTemplate('a');
    expect(after.map((t) => t.name)).toEqual(['b']);
    after = deleteLibraryTemplate('not-there');
    expect(after.map((t) => t.name)).toEqual(['b']);
  });

  it('clearLibrary wipes everything', () => {
    saveLibraryTemplate(defn('a'));
    saveLibraryTemplate(defn('b'));
    clearLibrary();
    expect(listLibraryTemplates()).toEqual([]);
  });

  it('gracefully recovers from a corrupt payload', () => {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, '{not-valid-json');
    expect(listLibraryTemplates()).toEqual([]);
    // Subsequent save replaces the corrupt blob with a clean one.
    saveLibraryTemplate(defn('a'));
    expect(listLibraryTemplates().map((t) => t.name)).toEqual(['a']);
  });

  it('filters structurally invalid array entries instead of crashing sort', () => {
    window.localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: 1, templates: [null, {}, defn('valid')] }),
    );
    expect(listLibraryTemplates().map((template) => template.name)).toEqual(['valid']);
  });
});
