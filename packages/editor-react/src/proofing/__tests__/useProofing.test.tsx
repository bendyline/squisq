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
import Link from '@tiptap/extension-link';
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
      // Ids are issued per pass, as harper's are: the same misspelling comes
      // back from the next pass under a new id.
      const pass = provider.lintCalls.length;
      while (index >= 0) {
        findings.push({
          id: `${pass}:${(n += 1)}`,
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
/** Edit the source out from under the mounted editor, to provoke a re-lint. */
let editSource: (source: string) => void = () => undefined;

function Harness(): null {
  const { setTiptapEditor, markdownSource, setMarkdownSource } = useEditorContext();
  lastState = useProofingState();
  lastSource = markdownSource;
  editSource = setMarkdownSource;
  useEffect(() => {
    // In the document, as the Write view's editor is: a press has to reach
    // the window for tap detection to see what made the click after it.
    const host = document.createElement('div');
    document.body.append(host);
    const editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ heading: false }),
        HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
        Link.configure({ openOnClick: false, autolink: false }),
        ProofingExtension,
      ],
      content: markdownToTiptap(markdownSource),
    });
    tiptap = editor;
    setTiptapEditor(editor);
    return () => {
      setTiptapEditor(null);
      editor.destroy();
      host.remove();
      tiptap = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

interface MountOptions {
  markdown?: string;
  proofingDefaultEnabled?: boolean;
  proofingSpellingEnabled?: boolean;
  proofingGrammarEnabled?: boolean;
  capability?: ProofingProvider | (() => ProofingProvider);
  ignoreStore?: ProofingIgnoreStore | null;
  articleId?: string;
  fileName?: string;
  /** The host's link delegate, as `EditorShell` hands it to `ProofingRoot`. */
  onLinkClick?: (href: string) => boolean | undefined;
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
  const tree = (current: MountOptions) => (
    <EditorProvider
      initialMarkdown={current.markdown ?? DEFAULT_MD}
      initialView="wysiwyg"
      proofing={provider}
      proofingDefaultEnabled={current.proofingDefaultEnabled}
      proofingSpellingEnabled={current.proofingSpellingEnabled}
      proofingGrammarEnabled={current.proofingGrammarEnabled}
      proofingIgnoreStore={current.ignoreStore}
      articleId={current.articleId}
      fileName={current.fileName}
    >
      <ProofingRoot onLinkClick={current.onLinkClick}>
        <Harness />
      </ProofingRoot>
    </EditorProvider>
  );
  const view = render(tree(options));
  /** Re-render the same mounted shell with changed host props. */
  const update = (next: Partial<MountOptions>) => view.rerender(tree({ ...options, ...next }));
  return { view, provider, update };
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
    const { provider } = mount();
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

  it('keeps code and findings crossing it out of prose while checking adjacent words', async () => {
    const fake = makeFakeProvider();
    const original = fake.nextFindings;
    fake.nextFindings = (text) => {
      const findings = original(text);
      const code = text.indexOf('\u0000');
      if (code >= 0) {
        findings.push({
          id: 'crossing-code',
          start: code - 1,
          end: code + 4,
          originalText: text.slice(code - 1, code + 4),
          category: 'style',
          kind: 'Formatting',
          message: 'Artificial gap around inline code.',
          suggestions: [],
        });
      }
      return findings;
    };
    mount({
      capability: fake,
      markdown:
        '# Title\n\nOpen a `teh` file and correct **teh** typo.\n\n```js\nconst teh = 1;\n```\n',
    });
    await vi.waitFor(() => expect(fake.lintCalls.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(lastState?.findings).toHaveLength(1));
    const decoration = tiptap!.view.dom.querySelector('.squisq-proof-underline');
    expect(decoration?.textContent).toBe('teh');
    expect(decoration?.closest('strong')).not.toBeNull();
    expect(tiptap!.view.dom.querySelector('code .squisq-proof-underline')).toBeNull();
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

describe('category preferences', () => {
  /** A provider that flags one spelling and one grammar issue per pass. */
  function makeMixedProvider(): FakeProvider {
    const fake = makeFakeProvider();
    fake.nextFindings = (text) => {
      const findings: ProofFinding[] = [];
      const typo = text.indexOf('teh');
      if (typo >= 0) {
        findings.push({
          id: 'spell-1',
          start: typo,
          end: typo + 3,
          category: 'spelling',
          kind: 'Typo',
          message: 'Did you mean `the`?',
          originalText: 'teh',
          suggestions: [{ text: 'the', kind: 'replace' }],
        });
      }
      const agreement = text.indexOf('This is');
      if (agreement >= 0) {
        findings.push({
          id: 'grammar-1',
          start: agreement,
          end: agreement + 7,
          category: 'grammar',
          kind: 'Agreement',
          message: 'Consider `These are`.',
          originalText: 'This is',
          suggestions: [{ text: 'These are', kind: 'replace' }],
        });
      }
      return findings;
    };
    return fake;
  }

  it('drops spelling findings when the host turns spell checking off', async () => {
    mount({ capability: makeMixedProvider(), proofingSpellingEnabled: false });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    expect(lastState?.findings[0].category).toBe('grammar');
    expect(tiptap!.view.dom.innerHTML).toContain('squisq-proof-underline--grammar');
    expect(tiptap!.view.dom.innerHTML).not.toContain('squisq-proof-underline--spelling');
  });

  it('drops grammar findings when the host turns grammar checking off', async () => {
    mount({ capability: makeMixedProvider(), proofingGrammarEnabled: false });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    expect(lastState?.findings[0].category).toBe('spelling');
    expect(tiptap!.view.dom.innerHTML).not.toContain('squisq-proof-underline--grammar');
  });

  it('reads as an absent capability when both categories are off', async () => {
    const { provider } = mount({
      capability: makeMixedProvider(),
      proofingSpellingEnabled: false,
      proofingGrammarEnabled: false,
    });
    await flush();
    await flush();
    expect((provider as FakeProvider).setupCalls).toBe(0);
    // Null, not a disabled state: the View-menu toggle and status segment
    // key off this, and a toggle that cannot toggle is worse than none.
    // (`lastSource` proves the harness rendered, so the null is the hook's.)
    expect(lastSource).toContain('teh');
    expect(lastState).toBe(null);
  });

  it('re-lints when a category preference flips', async () => {
    const fake = makeMixedProvider();
    const { update } = mount({ capability: fake });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(2));

    act(() => {
      update({ proofingSpellingEnabled: false });
    });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    expect(lastState?.findings[0].category).toBe('grammar');

    act(() => {
      update({ proofingSpellingEnabled: true });
    });
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(2));
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
      target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
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

  it('closes on a scroll, which moves the word out from under the pointer', async () => {
    mount();
    await openCard();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(card()).toBeNull();
  });

  it('stays on its word when a lint pass lands and re-issues the finding’s id', async () => {
    const { provider } = mount();
    const fake = provider as FakeProvider;
    await openCard();
    const before = lastState!.findings[0].id;
    const passes = fake.lintCalls.length;

    act(() => editSource(`${lastSource}\nAnother paragraph.\n`));
    await vi.waitFor(() => expect(fake.lintCalls.length).toBeGreaterThan(passes), {
      timeout: 2000,
    });
    await vi.waitFor(() => expect(lastState!.findings[0].id).not.toBe(before));

    // Same squiggle, new id: the card is still explaining it, and still acts.
    expect(card()?.getAttribute('data-proof-tooltip-id')).toBe(lastState!.findings[0].id);
    await act(async () => {
      card()!.querySelector<HTMLButtonElement>('.squisq-proof-tooltip-chip')!.click();
    });
    await flush();
    expect(tiptap!.state.doc.textBetween(0, tiptap!.state.doc.content.size, ' ')).toContain(
      'This is the body.',
    );
  });

  it('is not started by the mouse events a browser emulates after a tap', async () => {
    mount();
    await vi.waitFor(() => expect(squiggle()).toBeTruthy());
    const touchMove = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperty(touchMove, 'pointerType', { value: 'touch' });
    act(() => {
      squiggle().dispatchEvent(touchMove);
      squiggle().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await wait(OPEN_MS + 40);
    expect(card()).toBeNull();
  });
});

describe('tap card', () => {
  const LINK_MD = '# Title\n\nSee [teh](https://example.com/the) page.\n';

  const card = () => document.querySelector<HTMLElement>('.squisq-proof-tooltip');
  const squiggle = () =>
    tiptap!.view.dom.querySelector<HTMLElement>('[data-proof-id]') as HTMLElement;
  const linkButton = () =>
    card()?.querySelector<HTMLButtonElement>('.squisq-proof-tooltip-link button') ?? null;

  /** A `pointerdown` as `pointerType` would make it. */
  function press(target: Element, pointerType: string): void {
    const event = new MouseEvent('pointerdown', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  /**
   * Press and click, the click a plain `MouseEvent` with no `pointerType` of
   * its own — Safari's shape, where only the press says what made the click.
   */
  function click(target: Element, pointerType: string): MouseEvent {
    press(target, pointerType);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  async function ready(): Promise<void> {
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    await vi.waitFor(() => expect(squiggle()).toBeTruthy());
  }

  afterEach(() => {
    tiptap = null;
  });

  it('a finger on a squiggle raises the card at once, with no dwell', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    expect(card()?.getAttribute('data-trigger')).toBe('tap');
    expect(card()?.querySelector('.squisq-proof-tooltip-chip')?.textContent).toBe('the');
  });

  it('reads the pointer type off the click itself where the browser supplies it', async () => {
    mount();
    await ready();
    // No press first: Chrome and Firefox dispatch `click` as a PointerEvent.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'pen' });
    act(() => {
      squiggle().dispatchEvent(event);
    });
    expect(card()?.getAttribute('data-trigger')).toBe('tap');
  });

  it('a mouse click raises nothing — the mouse has the hover card', async () => {
    mount();
    await ready();
    click(squiggle(), 'mouse');
    expect(card()).toBeNull();
  });

  it('a second tap on the same word puts the card away', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    expect(card()).toBeTruthy();
    click(squiggle(), 'touch');
    expect(card()).toBeNull();
    click(squiggle(), 'touch');
    expect(card()).toBeTruthy();
  });

  it('a press outside the card dismisses it, a press inside does not', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    press(card()!, 'touch');
    expect(card()).toBeTruthy();
    press(document.body, 'touch');
    expect(card()).toBeNull();
  });

  it('typing dismisses it', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    act(() => {
      tiptap!.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(card()).toBeNull();
  });

  it('stays through a scroll and a passing pointer, which a hovered card would not', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      tiptap!.view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(card()).toBeTruthy();
  });

  it('applies a suggestion from its button', async () => {
    mount();
    await ready();
    click(squiggle(), 'touch');
    await act(async () => {
      card()!.querySelector<HTMLButtonElement>('.squisq-proof-tooltip-chip')!.click();
    });
    await flush();
    expect(tiptap!.state.doc.textBetween(0, tiptap!.state.doc.content.size, ' ')).toContain(
      'This is the body.',
    );
    expect(card()).toBeNull();
  });

  it('on a squiggled link, offers the link instead of leaving it to open', async () => {
    const onLinkClick = vi.fn();
    mount({ markdown: LINK_MD, onLinkClick });
    await ready();
    expect(squiggle().closest('a[href]')).toBeTruthy();

    const event = click(squiggle(), 'touch');
    // A read-only surface would otherwise follow the link under the card.
    expect(event.defaultPrevented).toBe(true);
    expect(onLinkClick).not.toHaveBeenCalled();
    expect(card()?.querySelector('.squisq-proof-tooltip-link-href')?.textContent).toBe(
      'https://example.com/the',
    );

    await act(async () => {
      linkButton()!.click();
    });
    expect(onLinkClick).toHaveBeenCalledExactlyOnceWith('https://example.com/the');
    expect(card()).toBeNull();
  });

  it('offers no link when the host opens none', async () => {
    mount({ markdown: LINK_MD });
    await ready();
    const event = click(squiggle(), 'touch');
    expect(card()).toBeTruthy();
    expect(linkButton()).toBeNull();
    // Nothing here claims the link, so whatever the surface did still happens.
    expect(event.defaultPrevented).toBe(false);
  });

  it('the full menu offers the link too when a finger raised it there', async () => {
    const onLinkClick = vi.fn();
    mount({ markdown: LINK_MD, onLinkClick });
    await ready();
    act(() => {
      lastState!.openMenu({
        findingId: lastState!.findings[0].id,
        x: 10,
        y: 10,
        linkHref: 'https://example.com/the',
      });
    });
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent === 'Open link',
    );
    expect(item).toBeTruthy();
    await act(async () => {
      item!.click();
    });
    expect(onLinkClick).toHaveBeenCalledExactlyOnceWith('https://example.com/the');
    expect(document.querySelector('.squisq-proof-menu')).toBeNull();
  });

  it('the right-click menu on a squiggled link offers no link — the mouse clicks it', async () => {
    mount({ markdown: LINK_MD, onLinkClick: vi.fn() });
    await ready();
    act(() => {
      lastState!.openMenu({ findingId: lastState!.findings[0].id, x: 10, y: 10 });
    });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
      (button) => button.textContent,
    );
    expect(labels).toContain('Ignore');
    expect(labels).not.toContain('Open link');
  });
});

describe('right-click', () => {
  const squiggle = () =>
    tiptap!.view.dom.querySelector<HTMLElement>('[data-proof-id]') as HTMLElement;

  /** Document position just inside the first "teh". */
  function tehPos(): number {
    let found = -1;
    tiptap!.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes('teh')) {
        found = pos + node.text.indexOf('teh') + 1;
      }
    });
    return found;
  }

  async function ready(): Promise<void> {
    await vi.waitFor(() => expect(lastState?.findings.length).toBe(1));
    await vi.waitFor(() => expect(squiggle()).toBeTruthy());
  }

  /** A `contextmenu` as `pointerType` would make it, at a point on the squiggle. */
  function rightClick(pointerType: string): MouseEvent {
    vi.spyOn(tiptap!.view, 'posAtCoords').mockReturnValue({ pos: tehPos(), inside: -1 });
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    act(() => {
      squiggle().dispatchEvent(event);
    });
    return event;
  }

  afterEach(() => {
    tiptap = null;
  });

  it('names the squiggled finding under a point in the Write view', async () => {
    mount();
    await ready();
    const posAtCoords = vi.spyOn(tiptap!.view, 'posAtCoords');

    posAtCoords.mockReturnValue({ pos: tehPos(), inside: -1 });
    expect(lastState!.findingAtPoint('wysiwyg', 10, 10)).toBe(lastState!.findings[0].id);

    // "This", clear of the squiggle.
    posAtCoords.mockReturnValue({ pos: tehPos() - 8, inside: -1 });
    expect(lastState!.findingAtPoint('wysiwyg', 10, 10)).toBeNull();
    // Preview has no squiggles, and the Source view here has no editor.
    expect(lastState!.findingAtPoint('preview', 10, 10)).toBeNull();
    expect(lastState!.findingAtPoint('raw', 10, 10)).toBeNull();
  });

  it('leaves a mouse right-click to the editor menu, which leads with the finding', async () => {
    mount();
    await ready();
    const event = rightClick('mouse');
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('.squisq-proof-menu')).toBeNull();
  });

  it('still answers a finger’s long press with the suggestions menu', async () => {
    mount();
    await ready();
    const event = rightClick('touch');
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('.squisq-proof-menu')).toBeTruthy();
  });
});

describe('view switches', () => {
  // EditorShell mounts the Write editor only while its tab is showing, and the
  // new instance reaches the proofing hook in a LATER task than the view
  // switch: React schedules the registering update rather than flushing it in
  // place, so the hook's immediate view-switch pass looks first and finds no
  // live editor. These harnesses keep both halves of that, unlike `Harness`,
  // whose single editor outlives every switch.
  let switchView: ((view: 'raw' | 'wysiwyg' | 'preview') => void) | null = null;

  function WriteSurface(): null {
    const { setTiptapEditor, markdownSource } = useEditorContext();
    useEffect(() => {
      const editor = new Editor({
        extensions: [
          StarterKit.configure({ heading: false }),
          HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
          ProofingExtension,
        ],
        content: markdownToTiptap(markdownSource),
      });
      const register = window.setTimeout(() => {
        tiptap = editor;
        setTiptapEditor(editor);
      }, 0);
      return () => {
        window.clearTimeout(register);
        setTiptapEditor(null);
        editor.destroy();
        if (tiptap === editor) tiptap = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  function SwitchingHarness(): JSX.Element | null {
    const { activeView, setActiveView } = useEditorContext();
    lastState = useProofingState();
    switchView = setActiveView;
    return activeView === 'wysiwyg' ? <WriteSurface /> : null;
  }

  function mountSwitching() {
    const provider = makeFakeProvider();
    render(
      <EditorProvider initialMarkdown={DEFAULT_MD} initialView="wysiwyg" proofing={provider}>
        <ProofingRoot>
          <SwitchingHarness />
        </ProofingRoot>
      </EditorProvider>,
    );
    return provider;
  }

  async function switchTo(view: 'raw' | 'wysiwyg' | 'preview'): Promise<void> {
    await act(async () => {
      switchView!(view);
      await Promise.resolve();
    });
  }

  afterEach(() => {
    switchView = null;
  });

  for (const away of ['raw', 'preview'] as const) {
    it(`re-lints the fresh Write editor after a trip to ${away === 'raw' ? 'Source' : 'Use mode'}`, async () => {
      mountSwitching();
      await vi.waitFor(() => expect(lastState?.findings).toHaveLength(1));

      await switchTo(away);
      await switchTo('wysiwyg');

      // Regression: the panel read "No issues found" and the squiggles were
      // gone, while the misspelling was still in the text.
      await vi.waitFor(() => expect(lastState?.findings).toHaveLength(1));
      expect(lastState?.findingsView).toBe('wysiwyg');
      await vi.waitFor(() =>
        expect(tiptap!.view.dom.innerHTML).toContain('squisq-proof-underline--spelling'),
      );
    });
  }
});
