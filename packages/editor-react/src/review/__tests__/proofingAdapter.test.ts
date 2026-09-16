import { describe, expect, it, vi } from 'vitest';
import type { ProofFinding } from '@bendyline/squisq/proof';
import type { ReviewEvent, ReviewRequest } from '@bendyline/squisq/review';
import type { ProofingProvider } from '../../proofing/types.js';
import { createProofingReviewProvider } from '../proofingAdapter.js';

function fakeProofingProvider(
  lint: (text: string) => Promise<ProofFinding[]> | ProofFinding[],
): ProofingProvider {
  return {
    setup: vi.fn(async () => {}),
    lint: vi.fn(async (text: string) => lint(text)),
    ignoreFinding: vi.fn(async () => {}),
    addWord: vi.fn(async () => {}),
    addWords: vi.fn(async () => {}),
    exportIgnored: vi.fn(async () => ''),
    importIgnored: vi.fn(async () => {}),
    clearIgnored: vi.fn(async () => {}),
    setDialect: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

/** Two blocks, the second starting at offset 100 in the document. */
function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    source: 'ignored by the adapter',
    documentRef: { articleId: 'a' },
    blocks: [
      { key: 1, startLine: 1, heading: null, text: 'First block.', offset: 0 },
      { key: 2, startLine: 5, heading: 'Two', text: 'Second block.', offset: 100 },
    ],
    ...overrides,
  };
}

async function collect(events: AsyncIterable<ReviewEvent>): Promise<ReviewEvent[]> {
  const out: ReviewEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('createProofingReviewProvider', () => {
  it('lints the blocks joined, so a finding spanning a paragraph break survives', async () => {
    // A per-block call would lose every cross-block grammar finding, which is
    // the reason the adapter joins rather than looping.
    const seen: string[] = [];
    const provider = createProofingReviewProvider(
      fakeProofingProvider((text) => {
        seen.push(text);
        return [];
      }),
    );
    await collect(provider.review(request(), new AbortController().signal));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('First block.');
    expect(seen[0]).toContain('Second block.');
  });

  it('maps a finding back to its own block and document offset', async () => {
    // 'Second block.' starts at 14 in the joined text ('First block.' + '\n\n').
    const finding: ProofFinding = {
      id: 'f1',
      start: 14,
      end: 20,
      category: 'spelling',
      kind: 'Typo',
      message: 'x',
      originalText: 'Second',
      suggestions: [],
    };
    const provider = createProofingReviewProvider(fakeProofingProvider(() => [finding]));
    const events = await collect(provider.review(request(), new AbortController().signal));
    const found = events.find((event) => event.type === 'findings');

    expect(found?.type === 'findings' && found.findings[0]).toMatchObject({
      blockKey: 2,
      // Offset 0 within the second block, which starts at 100 in the document.
      start: 100,
      end: 106,
      source: 'harper',
    });
  });

  it('drops a finding that straddles the join, since no block owns it', async () => {
    const straddling: ProofFinding = {
      id: 'f2',
      start: 10,
      end: 18,
      category: 'grammar',
      kind: 'x',
      message: 'x',
      originalText: 'ck.\n\nSe',
      suggestions: [],
    };
    const provider = createProofingReviewProvider(fakeProofingProvider(() => [straddling]));
    const events = await collect(provider.review(request(), new AbortController().signal));
    const found = events.find((event) => event.type === 'findings');
    expect(found?.type === 'findings' && found.findings).toHaveLength(0);
  });

  it('yields nothing once the document has moved under it', async () => {
    // Findings are about text that no longer exists, so emitting them would
    // put a squiggle on an unrelated word.
    const controller = new AbortController();
    const provider = createProofingReviewProvider(
      fakeProofingProvider(() => {
        controller.abort();
        return [
          {
            id: 'f3',
            start: 0,
            end: 5,
            category: 'spelling',
            kind: 'x',
            message: 'x',
            originalText: 'First',
            suggestions: [],
          },
        ];
      }),
    );
    expect(await collect(provider.review(request(), controller.signal))).toEqual([]);
  });

  it('reports a failing engine without ending the pass for other providers', async () => {
    const provider = createProofingReviewProvider(
      fakeProofingProvider(() => {
        throw new Error('wasm did not load');
      }),
    );
    const events = await collect(provider.review(request(), new AbortController().signal));
    expect(events).toEqual([{ type: 'error', message: 'wasm did not load' }]);
  });

  it('completes immediately on an empty document', async () => {
    const provider = createProofingReviewProvider(fakeProofingProvider(() => []));
    const events = await collect(
      provider.review(request({ blocks: [] }), new AbortController().signal),
    );
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('routes dismissal to the engine ignore, not to a local list', async () => {
    const underlying = fakeProofingProvider(() => []);
    const provider = createProofingReviewProvider(underlying);
    await provider.dismissFinding?.('f1');
    expect(underlying.ignoreFinding).toHaveBeenCalledWith('f1');
  });

  it('keeps proofing on its own fast cadence', async () => {
    // Proofing is cheap; a reviewer that takes seconds is not. The delay is
    // per provider for exactly this reason.
    const provider = createProofingReviewProvider(fakeProofingProvider(() => []));
    expect(provider.debounceMs).toBe(450);
    expect(provider.hue).toBe('spelling');
  });
});
