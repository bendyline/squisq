/** @vitest-environment jsdom */

/**
 * Orchestration contract, driven through `ProofingRoot` with a FAKE
 * provider injected via the `proofing` prop (the designed mock seam —
 * no module mocks). Pins: no engine bytes until a doc is active with
 * proofing effective; the frontmatter and host-default opt-outs; the
 * 450 ms debounce; squiggle decorations landing in a real Tiptap
 * editor; native-spellcheck suppression; ignore/dictionary frontmatter
 * writes; and factory-vs-instance disposal.
 */

import { act, render } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { EditorProvider, useEditorContext } from '../../EditorContext';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { ProofingExtension } from '../ProofingExtension';
import { ProofingRoot, useProofingState } from '../ProofingContext';
import type { ProofingState } from '../useProofing';
import type { ProofingDocumentRef, ProofingIgnoreStore, ProofingProvider } from '../types';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

interface FakeProvider extends ProofingProvider {
  setupCalls: number;
  lintCalls: { text: string; language?: string }[];
  disposed: boolean;
  /** Words routed to APP storage (the host callback path). */
  appWords: string[];
  /** Words accepted session-only (the doc word-list path). */
  sessionWords: string[];
  /** Engine-side ignore state, as the editor drives it. */
  ignoredJson: string | null;
  clearIgnoredCalls: number;
  importedIgnored: string[];
  /** Findings the next lint() returns (offsets into the linted text). */
  nextFindings: (text: string) => ProofFinding[];
}

function makeFakeProvider(options: { hasAppDictionary?: boolean } = {}): FakeProvider {
  const provider: FakeProvider = {
    setupCalls: 0,
    lintCalls: [],
    disposed: false,
    appWords: [],
    sessionWords: [],
    ignoredJson: null,
    clearIgnoredCalls: 0,
    importedIgnored: [],
    hasAppDictionary: options.hasAppDictionary,
    nextFindings: (text) => {
      // One spelling finding on every literal "teh" in the linted text —
      // unless the word has been accepted, so an "add" that actually
      // reached the engine clears the squiggle on the next pass the way
      // a real engine would.
      if ([...provider.appWords, ...provider.sessionWords].includes('teh')) return [];
      const findings: ProofFinding[] = [];
      let index = text.indexOf('teh');
      let n = 0;
      while (index >= 0) {
        findings.push({
          id: `f${(n += 1)}`,
          start: index,
          end: index + 3,
          category: 'spelling',
          kind: 'Typo',
          message: 'Did you mean `the`?',
          originalText: 'teh',
          suggestions: [{ text: 'the', kind: 'replace' }],
        });
        index = text.indexOf('teh', index + 1);
      }
      return findings;
    },
    async setup() {
      provider.setupCalls += 1;
    },
    async lint(text, options) {
      provider.lintCalls.push({ text, language: options?.language });
      return provider.nextFindings(text);
    },
    async ignoreFinding() {
      provider.ignoredJson = '{"context_hashes":[2617823912457726629]}';
    },
    async addWord(word) {
      provider.appWords.push(word);
    },
    async addWords(words) {
      provider.sessionWords.push(...words);
    },
    async exportIgnored() {
      return provider.ignoredJson ?? '{"context_hashes":[]}';
    },
    async importIgnored(json) {
      provider.importedIgnored.push(json);
      provider.ignoredJson = json;
    },
    async clearIgnored() {
      provider.clearIgnoredCalls += 1;
      provider.ignoredJson = null;
    },
    async setDialect() {},
    dispose() {
      provider.disposed = true;
    },
  };
  return provider;
}

let tiptap: Editor | null = null;
let lastState: ProofingState | null = null;
let lastSource = '';

function Harness(): null {
  const { setTiptapEditor, markdownSource } = useEditorContext();
  lastState = useProofingState();
  lastSource = markdownSource;
  useEffect(() => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: false }),
        HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
        ProofingExtension,
      ],
      content: markdownToTiptap(markdownSource),
    });
    tiptap = editor;
    setTiptapEditor(editor);
    return () => {
      setTiptapEditor(null);
      editor.destroy();
      tiptap = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

interface MountOptions {
  markdown?: string;
  proofingDefaultEnabled?: boolean;
  capability?: ProofingProvider | (() => ProofingProvider);
  ignoreStore?: ProofingIgnoreStore | null;
  articleId?: string;
  fileName?: string;
}

/** In-memory stand-in for a host's per-document ignore storage. */
function makeIgnoreStore() {
  const saved = new Map<string, string>();
  const calls: { load: ProofingDocumentRef[]; save: ProofingDocumentRef[] } = {
    load: [],
    save: [],
  };
  const key = (doc: ProofingDocumentRef) => doc.fileName ?? doc.articleId;
  const store: ProofingIgnoreStore = {
    load(doc) {
      calls.load.push(doc);
      return saved.get(key(doc));
    },
    save(doc, json) {
      calls.save.push(doc);
      saved.set(key(doc), json);
    },
  };
  return { store, saved, calls, key };
}

const DEFAULT_MD = '# Title\n\nThis is teh body.\n';

function mount(options: MountOptions = {}) {
  const provider = options.capability ?? makeFakeProvider();
  const view = render(
    <EditorProvider
      initialMarkdown={options.markdown ?? DEFAULT_MD}
      initialView="wysiwyg"
      proofing={provider}
      proofingDefaultEnabled={options.proofingDefaultEnabled}
      proofingIgnoreStore={options.ignoreStore}
      articleId={options.articleId}
      fileName={options.fileName}
    >
      <ProofingRoot>
        <Harness />
      </ProofingRoot>
    </EditorProvider>,
  );
  return { view, provider };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  lastState = null;
  lastSource = '';
  vi.useRealTimers();
});

describe('activation', () => {
  it('sets up and lints when a capability is present (default on)', async () => {
    const { provider } = mount() as { provider: FakeProvider; view: unknown };
    await flush();
    await vi.waitFor(() => expect(lastState?.status).toBe('ready'));
    await vi.waitFor(() => expect((provider as FakeProvider).lintCalls.length).toBeGreaterThan(0));
    const fake = provider as FakeProvider;
    expect(fake.setupCalls).toBe(1);
    expect(fake.lintCalls[0].language).toBe('plaintext');
    // The joined Write-view text, not the markdown source.
    expect(fake.lintCalls[0].text).toContain('Title\n\nThis is teh body.');
    await vi.waitFor(() => expect(lastState?.findings).toHaveLength(1));
    expect(lastState?.findings[0].category).toBe('spelling');
  });

  it('applies squiggle decorations to the Tiptap editor', async () => {
    mount();
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    // The decoration wraps "teh" — resolve it from the live plugin state.
    const html = tiptap!.view.dom.innerHTML;
    expect(html).toContain('squisq-proof-underline--spelling');
  });

  it('suppresses native spellcheck only while ready', async () => {
    mount();
    await vi.waitFor(() => expect(tiptap?.view.dom.getAttribute('spellcheck')).toBe('false'));
    act(() => lastState!.setEnabled(false));
    await flush();
    expect(tiptap?.view.dom.hasAttribute('spellcheck')).toBe(false);
  });

  it('never touches the engine when the host default is off', async () => {
    const { provider } = mount({ proofingDefaultEnabled: false });
    await flush();
    await flush();
    expect((provider as FakeProvider).setupCalls).toBe(0);
    expect(lastState?.enabled).toBe(false);
  });

  it('never touches the engine when the doc opts out via frontmatter', async () => {
    const { provider } = mount({
      markdown: '---\nsquisq-proofing: false\n---\n\n# T\n\nteh body.\n',
    });
    await flush();
    await flush();
    expect((provider as FakeProvider).setupCalls).toBe(0);
    expect(lastState?.enabled).toBe(false);
  });

  it('doc frontmatter overrides a host default of off', async () => {
    const { provider } = mount({
      markdown: '---\nsquisq-proofing: true\n---\n\n# T\n\nteh body.\n',
      proofingDefaultEnabled: false,
    });
    await vi.waitFor(() => expect((provider as FakeProvider).setupCalls).toBe(1));
    expect(lastState?.enabled).toBe(true);
  });
});

describe('session toggle & disable', () => {
  it('disable clears findings and keeps the provider; re-enable relints', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));

    act(() => lastState!.setEnabled(false));
    await flush();
    expect(lastState?.findings).toHaveLength(0);
    expect(fake.disposed).toBe(false);
    expect(tiptap!.view.dom.innerHTML).not.toContain('squisq-proof-underline');

    const callsBefore = fake.lintCalls.length;
    act(() => lastState!.setEnabled(true));
    await vi.waitFor(() => expect(fake.lintCalls.length).toBeGreaterThan(callsBefore));
  });
});

describe('disposal ownership', () => {
  it('disposes a factory-created provider on unmount', async () => {
    const fake = makeFakeProvider();
    const { view } = mount({ capability: () => fake });
    await vi.waitFor(() => expect(fake.setupCalls).toBe(1));
    view.unmount();
    expect(fake.disposed).toBe(true);
  });

  it('leaves a host-owned instance alive on unmount', async () => {
    const fake = makeFakeProvider();
    const { view } = mount({ capability: fake });
    await vi.waitFor(() => expect(fake.setupCalls).toBe(1));
    view.unmount();
    expect(fake.disposed).toBe(false);
  });
});

describe('apply suggestion', () => {
  it('replaces the squiggled text in one transaction', async () => {
    mount();
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    const id = lastState!.findings[0].id;
    act(() => lastState!.applySuggestion(id, 0));
    await flush();
    expect(tiptap!.state.doc.textBetween(0, tiptap!.state.doc.content.size, ' ')).toContain(
      'This is the body.',
    );
    // Optimistically removed from the published list.
    expect(lastState?.findings).toHaveLength(0);
  });
});

describe('dictionary scopes', () => {
  it('"Add to dictionary" routes to app storage and writes nothing to the doc', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    const sourceBefore = lastSource;

    await act(async () => {
      lastState!.addToAppDictionary(lastState!.findings[0].id);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(fake.appWords).toEqual(['teh']));
    // The document is the part the user must opt into explicitly.
    expect(lastSource).toBe(sourceBefore);
    expect(lastSource).not.toContain('squisq-proof-dictionary');
    expect(lastState?.findings).toHaveLength(0);
  });

  it('"Add to document word list" writes frontmatter and skips the host callback', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));

    await act(async () => {
      lastState!.addToDocWordList(lastState!.findings[0].id);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(lastSource).toContain('squisq-proof-dictionary: teh'));
    // Never reaches app storage — that is the whole point of the split.
    expect(fake.appWords).toEqual([]);
    expect(fake.sessionWords).toContain('teh');
    expect(lastState?.findings).toHaveLength(0);
  });

  it('appends to an existing doc word list rather than replacing it', async () => {
    mount({
      markdown: '---\nsquisq-proof-dictionary: Squisq, Noord\n---\n\n# T\n\nThis is teh body.\n',
    });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));

    await act(async () => {
      lastState!.addToDocWordList(lastState!.findings[0].id);
      await Promise.resolve();
    });

    await vi.waitFor(() =>
      expect(lastSource).toContain('squisq-proof-dictionary: Squisq, Noord, teh'),
    );
  });

  it('reports the app dictionary as unavailable when the host wired no storage', async () => {
    mount({ capability: makeFakeProvider({ hasAppDictionary: false }) });
    await vi.waitFor(() => expect(lastState?.status).toBe('ready'));
    expect(lastState?.canAddToAppDictionary).toBe(false);
  });

  it('treats a provider that does not report the capability as capable', async () => {
    mount();
    await vi.waitFor(() => expect(lastState?.status).toBe('ready'));
    expect(lastState?.canAddToAppDictionary).toBe(true);
  });
});

describe('ignore', () => {
  it('hands the opaque state to the host store, keyed by document, and never to the doc', async () => {
    const { store, saved, calls, key } = makeIgnoreStore();
    mount({ ignoreStore: store, articleId: 'a1', fileName: 'notes.md' });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    const sourceBefore = lastSource;

    await act(async () => {
      lastState!.ignoreFinding(lastState!.findings[0].id);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(calls.save).toHaveLength(1));
    expect(calls.save[0]).toEqual({ articleId: 'a1', fileName: 'notes.md' });
    expect(saved.get(key({ articleId: 'a1', fileName: 'notes.md' }))).toBe(
      '{"context_hashes":[2617823912457726629]}',
    );
    // The document itself is untouched — dismissals are personal.
    expect(lastSource).toBe(sourceBefore);
    expect(lastSource).not.toContain('squisq-proof-ignored');
  });

  it('restores a document’s saved ignores on activation', async () => {
    const { store, saved } = makeIgnoreStore();
    saved.set('notes.md', '{"context_hashes":[42]}');
    const { provider } = mount({
      ignoreStore: store,
      articleId: 'a1',
      fileName: 'notes.md',
    });
    const fake = provider as FakeProvider;
    await vi.waitFor(() => expect(fake.importedIgnored).toContain('{"context_hashes":[42]}'));
  });

  it('works without a store — the dismissal simply lasts for the session', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    const sourceBefore = lastSource;

    await act(async () => {
      lastState!.ignoreFinding(lastState!.findings[0].id);
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(fake.ignoredJson).toBeTruthy());
    expect(lastSource).toBe(sourceBefore);
  });

  it('does not leak one document’s ignores into another sharing an engine', async () => {
    // A host-owned singleton provider serving two shells/documents — the
    // engine's ignore set must be re-scoped, not accumulated.
    const { store, saved } = makeIgnoreStore();
    saved.set('a.md', '{"context_hashes":[1]}');
    saved.set('b.md', '{"context_hashes":[2]}');
    const shared = makeFakeProvider();

    const first = mount({
      capability: shared,
      ignoreStore: store,
      articleId: 'a',
      fileName: 'a.md',
    });
    await vi.waitFor(() => expect(shared.importedIgnored).toContain('{"context_hashes":[1]}'));
    first.view.unmount();

    mount({ capability: shared, ignoreStore: store, articleId: 'b', fileName: 'b.md' });
    await vi.waitFor(() => expect(shared.importedIgnored).toContain('{"context_hashes":[2]}'));
    // Document B's state replaced A's rather than stacking on top of it.
    expect(shared.clearIgnoredCalls).toBeGreaterThanOrEqual(2);
    expect(shared.ignoredJson).toBe('{"context_hashes":[2]}');
  });
});

describe('hover card', () => {
  /** Dwell / grace constants in `useProofing`, plus slack for the timer. */
  const OPEN_MS = 300;
  const CLOSE_MS = 260;

  const card = () => document.querySelector<HTMLElement>('.squisq-proof-tooltip');
  const squiggle = () =>
    tiptap!.view.dom.querySelector<HTMLElement>('[data-proof-id]') as HTMLElement;

  async function wait(ms: number): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  function move(target: HTMLElement): void {
    act(() => {
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
  }

  /** Hover the squiggle and wait out the dwell. */
  async function openCard(): Promise<HTMLElement> {
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    await vi.waitFor(() => expect(squiggle()).toBeTruthy());
    move(squiggle());
    await wait(OPEN_MS + 40);
    const element = card();
    expect(element).toBeTruthy();
    return element as HTMLElement;
  }

  afterEach(() => {
    tiptap = null;
  });

  it('opens after the dwell with the suggestion as a button', async () => {
    mount();
    const element = await openCard();
    const chip = element.querySelector<HTMLButtonElement>('.squisq-proof-tooltip-chip');
    expect(chip?.textContent).toBe('the');
    // Interactive, so it must not be click-through.
    expect(getComputedStyle(element).pointerEvents).not.toBe('none');
  });

  it('survives the trip from the squiggle to the card', async () => {
    mount();
    const element = await openCard();
    // Pointer leaves the word — the close is armed, not performed…
    move(tiptap!.view.dom);
    await wait(CLOSE_MS / 2);
    expect(card()).toBeTruthy();
    // …and cancelled outright once the pointer lands on the card.
    act(() => {
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    await wait(CLOSE_MS + 80);
    expect(card()).toBeTruthy();
  });

  it('closes once the pointer leaves the word and never arrives', async () => {
    mount();
    await openCard();
    move(tiptap!.view.dom);
    await wait(CLOSE_MS + 80);
    expect(card()).toBeNull();
  });

  it('applies a suggestion from its button', async () => {
    mount();
    const element = await openCard();
    const chip = element.querySelector<HTMLButtonElement>('.squisq-proof-tooltip-chip');
    await act(async () => {
      chip!.click();
    });
    await flush();
    expect(tiptap!.state.doc.textBetween(0, tiptap!.state.doc.content.size, ' ')).toContain(
      'This is the body.',
    );
    expect(card()).toBeNull();
  });

  it('ignores a finding from its button', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    const element = await openCard();
    const ignore = [
      ...element.querySelectorAll<HTMLButtonElement>('.squisq-proof-tooltip-action'),
    ].find((button) => button.textContent === 'Ignore');
    await act(async () => {
      ignore!.click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fake.ignoredJson).toBeTruthy());
    expect(card()).toBeNull();
  });

  it('hides the app-dictionary action when the host stores nothing', async () => {
    mount({ capability: makeFakeProvider({ hasAppDictionary: false }) });
    const element = await openCard();
    const labels = [
      ...element.querySelectorAll<HTMLButtonElement>('.squisq-proof-tooltip-action'),
    ].map((button) => button.textContent);
    expect(labels).not.toContain('Add to dictionary');
    expect(labels).toContain('Add to document word list');
  });
});
