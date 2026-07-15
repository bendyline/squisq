/**
 * @vitest-environment jsdom
 *
 * EditorContext lifecycle behavior.
 *
 * 1. Versioning auto-save ARMS ON MOUNT, deliberately: the first tick
 *    captures the document as-opened, which is the baseline a user reverts
 *    to. A review flagged this as "snapshot churn burning the keep-last-50
 *    budget", on the theory that a host normalizing line endings on load
 *    re-snapshots on every open. MEASURED — it does not: three opens of a
 *    CRLF document normalized to LF yield reasons
 *    ['saved', 'unchanged', 'unchanged']. The divergent form is stamped
 *    ONCE, and every later open compares against that new snapshot and
 *    dedupes. The cost is one baseline per document, not one per open.
 *    (Whether a read-only open should write a baseline AT ALL is a separate
 *    product question — snapshotting the pre-edit content on first edit
 *    would keep the baseline and write nothing on a pure read. Not decided
 *    here; these tests pin the shipped behavior.)
 *
 * 2. `replaceAll` pushed FRONTMATTER-INCLUSIVE markdown straight into
 *    Tiptap, unlike WysiwygEditor's own sync path which strips it. YAML
 *    rendered as an `<hr>` plus literal `title: …` paragraphs until a
 *    post-paint effect re-set the stripped content. Both pushes were
 *    redundant with the `editorSource` sync effects each surface runs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { EditorProvider, useEditorContext } from '../EditorContext';

function Probe() {
  const ctx = useEditorContext();
  return <span data-testid="active">{ctx.versioning ? 'yes' : 'no'}</span>;
}

/** Snapshot paths currently in the container. */
async function snapshots(container: ContentContainer): Promise<string[]> {
  const files = await container.listFiles();
  return files.map((f) => f.path).filter((p) => p.startsWith('.versions/'));
}

async function seedSnapshot(container: ContentContainer, content: string): Promise<void> {
  await container.writeFile(
    '.versions/index.20260101T000000Z.md',
    new TextEncoder().encode(content),
    'text/markdown',
  );
}

const DOC = '# Doc\n\nBody.\n';

describe('EditorContext — versioning auto-save arming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function open(container: ContentContainer, initialMarkdown = DOC) {
    return render(
      <EditorProvider
        initialMarkdown={initialMarkdown}
        allowVersioning
        workspaceContainer={container}
        versioningAutoSaveIdleMs={5000}
      >
        <Probe />
      </EditorProvider>,
    );
  }

  async function idle(ms = 6000): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('an open captures the as-opened document as a baseline snapshot', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument(DOC, 'index.md');

    open(container);
    await idle();

    // This is the point of arming on mount: without it there is nothing to
    // revert to but the post-edit states.
    expect(await snapshots(container)).toHaveLength(1);
  });

  it('an open whose source already matches the latest snapshot stamps nothing', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument(DOC, 'index.md');
    await seedSnapshot(container, DOC);

    open(container);
    await idle();

    // `saveVersion`'s unchanged-check is what keeps the mount arm cheap.
    expect(await snapshots(container)).toHaveLength(1);
  });

  /**
   * The scenario the review predicted would churn: the host loaded CRLFs but
   * the editor's live source is LF-normalized, so the first compare against
   * the seeded snapshot misses. It stamps ONCE — the second and third opens
   * compare against the NEW (normalized) snapshot and dedupe. One baseline
   * per document, not one per open.
   */
  it('a normalizing host stamps exactly one baseline across repeated opens', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# Doc\r\n\r\nBody.\r\n', 'index.md');
    await seedSnapshot(container, '# Doc\r\n\r\nBody.\r\n');

    for (let i = 0; i < 3; i++) {
      const { unmount } = open(container, DOC); // LF live source ≠ CRLF seed
      await idle();
      unmount();
    }

    // The seeded CRLF snapshot + exactly one LF baseline. NOT one per open.
    expect(await snapshots(container)).toHaveLength(2);
  });

  it('does not re-arm when the effect re-runs without a source change', async () => {
    // A container/prop identity change must not restart the idle clock or
    // stamp a duplicate — only an actual edit (or the mount baseline) should.
    const container = new MemoryContentContainer();
    await container.writeDocument(DOC, 'index.md');

    const { rerender } = open(container);
    await idle();
    const afterMount = await snapshots(container);

    rerender(
      <EditorProvider
        initialMarkdown={DOC}
        allowVersioning
        workspaceContainer={container}
        versioningAutoSaveIdleMs={5000}
      >
        <Probe />
      </EditorProvider>,
    );
    await idle();

    expect(await snapshots(container)).toEqual(afterMount);
  });

  /**
   * The timer must arm for its actual purpose — this is what stops any
   * arming change from silently becoming "disable auto-save".
   */
  it('an edit arms the timer and stamps the edited content', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument(DOC, 'index.md');

    let setSource!: (s: string) => void;
    function Editor() {
      const ctx = useEditorContext();
      setSource = ctx.setMarkdownSource;
      return null;
    }
    render(
      <EditorProvider
        initialMarkdown={DOC}
        allowVersioning
        workspaceContainer={container}
        versioningAutoSaveIdleMs={5000}
      >
        <Editor />
      </EditorProvider>,
    );
    await idle();
    const baseline = await snapshots(container);
    expect(baseline).toHaveLength(1); // the as-opened baseline

    act(() => {
      setSource('# Doc\n\nBody edited by a human.\n');
    });
    await idle();

    const after = await snapshots(container);
    expect(after).toHaveLength(2); // baseline + the edit
    const saved = await container.readFile(after[after.length - 1]!);
    expect(new TextDecoder().decode(saved!)).toContain('edited by a human');
    // The baseline still holds the as-opened text, which is what makes
    // "revert to how I found it" possible.
    const first = await container.readFile(baseline[0]!);
    expect(new TextDecoder().decode(first!)).not.toContain('edited by a human');
  });

  it('the idle delay is still honored — no snapshot before it elapses', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument(DOC, 'index.md');

    let setSource!: (s: string) => void;
    function Editor() {
      setSource = useEditorContext().setMarkdownSource;
      return null;
    }
    render(
      <EditorProvider
        initialMarkdown={DOC}
        allowVersioning
        workspaceContainer={container}
        versioningAutoSaveIdleMs={5000}
      >
        <Editor />
      </EditorProvider>,
    );
    act(() => {
      setSource('# Doc\n\nTyping…\n');
    });
    await idle(2000);
    expect(await snapshots(container)).toEqual([]);
    await idle(4000);
    expect(await snapshots(container)).toHaveLength(1);
  });
});

describe('EditorContext — replaceAll', () => {
  const SRC = '---\ntitle: My Doc\nsquisq-theme: bold\n---\n\n# Heading\n\nBody text.\n';

  function harness() {
    const setContentCalls: unknown[] = [];
    const setValueCalls: string[] = [];
    let replaceAll!: (t: string) => void;
    let read!: () => string;

    function Wire() {
      const ctx = useEditorContext();
      replaceAll = ctx.replaceAll;
      read = () => ctx.markdownSource;
      return (
        <button
          data-testid="register"
          onClick={() => {
            ctx.setTiptapEditor({
              commands: { setContent: (html: unknown) => setContentCalls.push(html) },
            } as unknown as Parameters<typeof ctx.setTiptapEditor>[0]);
            ctx.setMonacoEditor({
              setValue: (v: string) => setValueCalls.push(v),
              getModel: () => null,
              getPosition: () => null,
            } as unknown as Parameters<typeof ctx.setMonacoEditor>[0]);
          }}
        >
          register
        </button>
      );
    }

    const utils = render(
      <EditorProvider initialMarkdown="# Old\n">
        <Wire />
      </EditorProvider>,
    );
    act(() => {
      utils.getByTestId('register').click();
    });
    return {
      setContentCalls,
      setValueCalls,
      replaceAll: (t: string) => act(() => replaceAll(t)),
      // Indirect: `read` is re-bound on every render, so capturing it here
      // would freeze the first render's closure.
      read: () => read(),
    };
  }

  it('never hands raw frontmatter to Tiptap', () => {
    const h = harness();
    h.replaceAll(SRC);
    // The old push produced:
    //   <hr><p>title: My Doc</p><p>squisq-theme: bold</p><hr><h1>Heading</h1>…
    expect(h.setContentCalls).toEqual([]);
  });

  it('does not bypass the editors own editorSource sync (no direct pushes at all)', () => {
    const h = harness();
    h.replaceAll(SRC);
    // Both surfaces sync themselves from `editorSource`, applying the
    // transform their view needs (Tiptap strips frontmatter; block mode
    // scopes to the active block's slice). Pushing here skipped all of it.
    expect(h.setContentCalls).toEqual([]);
    expect(h.setValueCalls).toEqual([]);
  });

  it('still updates the source of truth, which is what the sync effects read', () => {
    const h = harness();
    h.replaceAll(SRC);
    expect(h.read()).toBe(SRC);
  });
});
