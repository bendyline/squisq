import { describe, it, expect } from 'vitest';
import { wrapMarkdownSource } from '@bendyline/squisq/markdown';
import { ingestForWrite, persistFromWrite } from '../wrapPolicy';

const LONG = Array.from({ length: 60 }, (_, i) => `word${String(i).padStart(2, '0')}`).join(' ');

describe('wrapPolicy', () => {
  it('unwraps a confidently wrapped body for display and remembers the state', () => {
    const wrapped = wrapMarkdownSource(`${LONG}\n\n${LONG}\n`, { width: 80, strict: true });
    const { displayBody, state } = ingestForWrite(wrapped);
    expect(state?.kind).toBe('wrapped');
    expect(state?.width).toBe(80);
    // Each paragraph is one line in the display form.
    const paragraphs = displayBody.trimEnd().split('\n\n');
    expect(paragraphs).toHaveLength(2);
    for (const p of paragraphs) expect(p.includes('\n')).toBe(false);
  });

  it('passes unwrapped bodies through untouched with a null state', () => {
    const body = `${LONG}\n`;
    const { displayBody, state } = ingestForWrite(body);
    expect(displayBody).toBe(body);
    expect(state).toBeNull();
  });

  it('passes inconclusive (mixed) bodies through untouched', () => {
    const wrapped = wrapMarkdownSource(`${LONG.slice(0, 200)}\n`, { width: 60, strict: true });
    const body = `${wrapped}\n${LONG}\n\n${LONG}\n\n${LONG}\n`;
    const { displayBody, state } = ingestForWrite(body);
    expect(displayBody).toBe(body);
    expect(state).toBeNull();
  });

  it('serialize→ingest is a fixpoint: persisting the display body restores the source', () => {
    const wrapped = wrapMarkdownSource(`${LONG}\n\n${LONG}\n`, { width: 80, strict: true });
    const { displayBody, state } = ingestForWrite(wrapped);
    expect(persistFromWrite(displayBody, state)).toBe(wrapped);
  });

  it('persist is a pass-through when there is no wrapped state', () => {
    const body = `${LONG}\n`;
    expect(persistFromWrite(body, null)).toBe(body);
  });

  it('never touches non-prose regions when re-wrapping the persisted form', () => {
    const doc = `${LONG}\n\n\`\`\`\ncode line that is very long and must never ever be wrapped by the policy\n\`\`\`\n`;
    const wrapped = wrapMarkdownSource(doc, { width: 80, strict: true });
    const { displayBody, state } = ingestForWrite(wrapped);
    const persisted = persistFromWrite(displayBody, state);
    expect(persisted).toContain(
      'code line that is very long and must never ever be wrapped by the policy',
    );
  });
});
