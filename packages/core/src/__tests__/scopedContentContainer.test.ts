import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryContentContainer } from '../storage/ContentContainer';
import { ScopedContentContainer, scopeContainer } from '../storage/ScopedContentContainer';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: ArrayBuffer | null) => (b ? new TextDecoder().decode(b) : null);

describe('ScopedContentContainer', () => {
  let parent: MemoryContentContainer;

  beforeEach(() => {
    parent = new MemoryContentContainer();
  });

  it('writeFile + readFile route through the prefix', async () => {
    const scoped = scopeContainer(parent, 'image_files');
    await scoped.writeFile('state.json', enc('{}'), 'application/json');

    expect(dec(await parent.readFile('image_files/state.json'))).toBe('{}');
    expect(dec(await scoped.readFile('state.json'))).toBe('{}');
  });

  it('exists + removeFile honor the prefix', async () => {
    const scoped = scopeContainer(parent, 'image_files');
    await scoped.writeFile('a.txt', enc('a'));
    expect(await scoped.exists('a.txt')).toBe(true);
    expect(await parent.exists('image_files/a.txt')).toBe(true);

    await scoped.removeFile('a.txt');
    expect(await scoped.exists('a.txt')).toBe(false);
    expect(await parent.exists('image_files/a.txt')).toBe(false);
  });

  it('listFiles returns prefix-stripped paths and ignores siblings', async () => {
    const scoped = scopeContainer(parent, 'image_files');
    await parent.writeFile('outside.txt', enc('x'));
    await parent.writeFile('image_files_sibling/peek.txt', enc('y')); // not in scope
    await scoped.writeFile('a.txt', enc('1'));
    await scoped.writeFile('sub/b.txt', enc('2'));

    const list = await scoped.listFiles();
    const paths = list.map((e) => e.path).sort();
    expect(paths).toEqual(['a.txt', 'sub/b.txt']);
  });

  it('listFiles with prefix joins the scope prefix', async () => {
    const scoped = scopeContainer(parent, 'sidecar');
    await scoped.writeFile('assets/a.png', enc('a'));
    await scoped.writeFile('assets/b.png', enc('b'));
    await scoped.writeFile('state.json', enc('{}'));

    const list = await scoped.listFiles('assets/');
    expect(list.map((e) => e.path).sort()).toEqual(['assets/a.png', 'assets/b.png']);
  });

  it('nested scopes compose', async () => {
    const a = scopeContainer(parent, 'a');
    const ab = scopeContainer(a, 'b');
    await ab.writeFile('c.txt', enc('hi'));
    expect(dec(await parent.readFile('a/b/c.txt'))).toBe('hi');
    expect(dec(await ab.readFile('c.txt'))).toBe('hi');
  });

  it('normalizes leading/trailing slashes in prefix and paths', async () => {
    const scoped = scopeContainer(parent, '/sidecar/');
    expect(scoped.prefix).toBe('sidecar');
    await scoped.writeFile('/x.txt', enc('x'));
    expect(dec(await parent.readFile('sidecar/x.txt'))).toBe('x');
  });

  it('rejects empty / dotted prefixes', () => {
    expect(() => scopeContainer(parent, '')).toThrow();
    expect(() => scopeContainer(parent, '/')).toThrow();
    expect(() => scopeContainer(parent, 'a/../b')).toThrow();
    expect(() => scopeContainer(parent, './a')).toThrow();
  });

  it('getDocumentPath / readDocument always return null', async () => {
    const scoped = scopeContainer(parent, 'sidecar');
    await scoped.writeFile('index.md', enc('# hi'));
    expect(await scoped.getDocumentPath()).toBeNull();
    expect(await scoped.readDocument()).toBeNull();
  });

  it('writeDocument throws', async () => {
    const scoped = new ScopedContentContainer(parent, 'sidecar');
    await expect(scoped.writeDocument()).rejects.toThrow();
  });
});
