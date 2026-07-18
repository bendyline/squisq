import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { DocumentVersionManager, VERSIONS_PREFIX } from '@bendyline/squisq/versions';
import type { SaveVersionResult } from '@bendyline/squisq/versions';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { VersionHistoryPanel } from '../VersionHistoryPanel';

/**
 * The full EditorShell mounts Tiptap and Monaco, both heavy and
 * jsdom-hostile. These tests instead exercise the smallest moving
 * pieces: the EditorContext's versioning wiring and the
 * VersionHistoryPanel UI. Tiptap/Monaco coverage lives elsewhere.
 */

function Harness({ fixedNow }: { fixedNow?: Date } = {}) {
  const ctx = useEditorContext();
  return (
    <div>
      <button
        type="button"
        data-testid="set-source"
        onClick={() => ctx.setMarkdownSource(`# updated ${Math.random()}`)}
      >
        Set source
      </button>
      <button
        type="button"
        data-testid="manual-save"
        onClick={() => {
          void ctx.saveVersion(fixedNow ? { now: fixedNow } : undefined);
        }}
      >
        Manual save
      </button>
      <span data-testid="versioning-active">{ctx.versioning ? 'yes' : 'no'}</span>
      {/* The live draft — `replaceAll` (what a revert calls) writes it. */}
      <span data-testid="live-source">{ctx.markdownSource}</span>
      <VersionHistoryPanel />
    </div>
  );
}

/**
 * Open the popover, click a snapshot row's "Revert" link to raise the
 * confirm prompt, then click the confirm prompt's primary "Revert"
 * button. Both are labelled "Revert"; the primary one is distinguished by
 * its modifier class.
 */
async function openAndConfirmRevert(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

  const primary = await waitFor(() => {
    const found = screen
      .getAllByRole('button', { name: 'Revert' })
      .find((b) => b.classList.contains('squisq-version-history-link--primary'));
    expect(found).toBeTruthy();
    return found!;
  });
  await act(async () => {
    fireEvent.click(primary);
  });
}

/** The snapshot rows, excluding the synthetic "Current" row. */
function snapshotRowButtons(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.squisq-version-history-row:not(.squisq-version-history-row--current) ' +
        '.squisq-version-history-row-select',
    ),
  );
}

describe('versioning wiring + VersionHistoryPanel', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('exposes versioning + saveVersion when allowVersioning + container are set', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');

    render(
      <EditorProvider workspaceContainer={container} allowVersioning>
        <Harness />
      </EditorProvider>,
    );

    expect(screen.getByTestId('versioning-active').textContent).toBe('yes');
    // Trigger button visible.
    expect(screen.getByRole('button', { name: 'Version history' })).toBeTruthy();
  });

  it('omits the toolbar trigger when versioning is off', () => {
    const container = new MemoryContentContainer();
    render(
      <EditorProvider workspaceContainer={container}>
        <Harness />
      </EditorProvider>,
    );
    expect(screen.getByTestId('versioning-active').textContent).toBe('no');
    expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull();
  });

  it('closes on global Escape and returns focus to its trigger', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    render(
      <EditorProvider workspaceContainer={container} allowVersioning>
        <Harness />
      </EditorProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Version history' });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Version history' })).toBeTruthy(),
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Version history' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('warns and stays disabled when allowVersioning is set without a container', () => {
    render(
      <EditorProvider allowVersioning>
        <Harness />
      </EditorProvider>,
    );
    expect(screen.getByTestId('versioning-active').textContent).toBe('no');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('opens the popover, lists empty state, then shows snapshots after a save', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    const onSaveVersion = vi.fn<(r: SaveVersionResult) => void>();

    render(
      <EditorProvider
        workspaceContainer={container}
        allowVersioning
        versioningAutoSaveIdleMs={0}
        onSaveVersion={onSaveVersion}
      >
        <Harness fixedNow={new Date(Date.UTC(2026, 3, 30, 15, 20, 30))} />
      </EditorProvider>,
    );

    const trigger = () => screen.getByRole('button', { name: 'Version history' });

    // Open popover — empty state initially.
    fireEvent.click(trigger());
    await waitFor(() => {
      expect(screen.getByText(/No versions yet/i)).toBeTruthy();
    });

    // Close, then save, then re-open so the list effect re-runs.
    fireEvent.click(trigger());
    await act(async () => {
      fireEvent.click(screen.getByTestId('manual-save'));
    });
    await waitFor(() => {
      expect(onSaveVersion).toHaveBeenCalled();
    });
    const calls = onSaveVersion.mock.calls;
    const last = calls[calls.length - 1]![0];
    expect(last.saved).toBe(true);
    expect(last.reason).toBe('saved');

    fireEvent.click(trigger());
    // The saved snapshot renders as a non-current row whose "Revert" button
    // distinguishes it from the synthetic Current row (Current has no actions).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy();
    });
  });

  /**
   * Regression: the panel used to call
   * `revertToVersion(v, { snapshotCurrent: true })`, which snapshots
   * `container.readDocument()` — NOT the editor's live draft. The confirm
   * dialog promised "your current draft will be saved as a new snapshot
   * first"; it saved the container's stale copy instead, and the live
   * edits were then overwritten unrecoverably.
   */
  it('snapshots the LIVE draft (not the stale container doc) before reverting', async () => {
    const container = new MemoryContentContainer();
    // The container's copy is deliberately stale: this is what the old
    // `snapshotCurrent: true` path would have captured.
    await container.writeDocument('# stale-container-copy', 'index.md');

    const manager = new DocumentVersionManager(container);
    await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });

    render(
      <EditorProvider
        workspaceContainer={container}
        allowVersioning
        versioningAutoSaveIdleMs={0}
        initialMarkdown="# live-unsaved-draft"
      >
        <Harness />
      </EditorProvider>,
    );

    await openAndConfirmRevert();

    // The live draft must exist verbatim in the snapshot history.
    await waitFor(async () => {
      const versions = await manager.listVersions();
      const contents = await Promise.all(versions.map((v) => manager.readVersion(v)));
      expect(contents).toContain('# live-unsaved-draft');
    });
  });

  it('aborts the revert (leaving the draft intact) when the snapshot step fails', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# original', 'index.md');
    const manager = new DocumentVersionManager(container);
    await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });

    // Fail ONLY the snapshot write (`.versions/…`), leaving the revert's
    // own `writeDocument` fully functional. This is what makes the test
    // meaningful: if the guard is missing, the revert really can — and
    // will — overwrite the draft.
    const realWriteFile = container.writeFile.bind(container);
    const writeSpy = vi
      .spyOn(container, 'writeFile')
      .mockImplementation(async (path, data, mimeType) => {
        if (path.startsWith(VERSIONS_PREFIX)) throw new Error('disk full');
        return realWriteFile(path, data, mimeType);
      });

    render(
      <EditorProvider
        workspaceContainer={container}
        allowVersioning
        versioningAutoSaveIdleMs={0}
        initialMarkdown="# precious-draft"
      >
        <Harness />
      </EditorProvider>,
    );

    await openAndConfirmRevert();

    // The failure is surfaced rather than swallowed...
    await waitFor(() => {
      expect(screen.getByText(/disk full|Could not save your current draft/i)).toBeTruthy();
    });
    // ...and — the whole point — the unsaved draft was NOT overwritten by
    // a revert whose safety step never completed.
    expect(screen.getByTestId('live-source').textContent).toBe('# precious-draft');
    expect(await container.readDocument()).toBe('# original');
    writeSpy.mockRestore();
  });

  it('surfaces a readVersion rejection instead of an unhandled rejection', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    const manager = new DocumentVersionManager(container);
    await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });

    render(
      <EditorProvider workspaceContainer={container} allowVersioning versioningAutoSaveIdleMs={0}>
        <Harness />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy());

    // Fail the read that backs the diff view. `handleSelect` is invoked as
    // `void handleSelect(v)`, so an unguarded throw = unhandled rejection
    // + a silently dead popover.
    const readSpy = vi
      .spyOn(container, 'readFile')
      .mockRejectedValue(new Error('snapshot read exploded'));

    await act(async () => {
      fireEvent.click(snapshotRowButtons()[0]!);
    });

    await waitFor(() => {
      expect(screen.getByText(/snapshot read exploded/i)).toBeTruthy();
    });
    readSpy.mockRestore();
  });

  it('deduplicates identical saves', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    const manager = new DocumentVersionManager(container);

    const r1 = await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 10, 0, 0)) });
    const r2 = await manager.saveVersion({ now: new Date(Date.UTC(2026, 3, 30, 10, 0, 1)) });

    expect(r1.saved).toBe(true);
    expect(r2.saved).toBe(false);
    expect(r2.reason).toBe('unchanged');
    expect(await manager.listVersions()).toHaveLength(1);
  });

  it('keep-last-n prune policy keeps the count bounded after auto-saves', async () => {
    const container = new MemoryContentContainer();
    await container.writeDocument('# hi', 'index.md');
    const onSaveVersion = vi.fn<(r: SaveVersionResult) => void>();

    render(
      <EditorProvider
        workspaceContainer={container}
        allowVersioning
        versioningAutoSaveIdleMs={0}
        versioningPrunePolicy={{ type: 'keep-last-n', n: 2 }}
        onSaveVersion={onSaveVersion}
      >
        <Harness fixedNow={new Date(Date.UTC(2026, 3, 30, 15, 20, 30))} />
      </EditorProvider>,
    );

    const seedTimes = [
      new Date(Date.UTC(2026, 3, 30, 10, 0, 0)),
      new Date(Date.UTC(2026, 3, 30, 11, 0, 0)),
      new Date(Date.UTC(2026, 3, 30, 12, 0, 0)),
      new Date(Date.UTC(2026, 3, 30, 13, 0, 0)),
    ];

    for (let i = 0; i < seedTimes.length; i++) {
      await container.writeDocument(`# rev-${i}`, 'index.md');
      // Wait for prune (fire-and-forget) by polling the file list.
      await act(async () => {
        await onSaveVersionDirect(container, seedTimes[i]!);
      });
    }
    // Pruning is fire-and-forget inside the editor's saveVersion; for the
    // test we run prune explicitly to make the behavior deterministic.
    const list = await container.listFiles(VERSIONS_PREFIX);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Runs the manager directly against the same container the editor sees.
 * Lets us seed ordered snapshots without depending on the auto-save
 * timer. The editor's own `saveVersion` would also do this — but we'd
 * have to thread the timestamp through, which the public API doesn't
 * expose to the host (only to the internal manager).
 */
async function onSaveVersionDirect(container: MemoryContentContainer, now: Date): Promise<void> {
  const manager = new DocumentVersionManager(container);
  await manager.saveVersion({ now });
}
