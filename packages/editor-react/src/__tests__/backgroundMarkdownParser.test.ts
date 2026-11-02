import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundMarkdownParser } from '../backgroundMarkdownParser';
import {
  handleMarkdownParseRequest,
  isMarkdownParseResult,
  type MarkdownParseRequest,
} from '../markdownParseProtocol';
import { parseMarkdown } from '@bendyline/squisq/markdown';

function harness() {
  const sent: MarkdownParseRequest[] = [];
  const terminate = vi.fn();
  const worker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (request: MarkdownParseRequest) => sent.push(request),
    terminate,
  } as unknown as Worker;
  const factory = vi.fn(() => worker);
  const parser = new BackgroundMarkdownParser(factory);
  const reply = (index: number) =>
    worker.onmessage?.(
      new MessageEvent('message', {
        data: handleMarkdownParseRequest(sent[index]),
      }),
    );
  return { parser, worker, sent, reply, terminate, factory };
}

afterEach(() => vi.useRealTimers());

describe('background Markdown parsing', () => {
  it('keeps one active job and only the newest queued source', () => {
    const h = harness();
    const stale = vi.fn(),
      superseded = vi.fn(),
      latest = vi.fn();
    h.parser.parse('# Old', stale);
    h.parser.parse('# Skipped', superseded);
    h.parser.parse('# Latest', latest);
    expect(h.sent).toHaveLength(1);
    h.reply(0);
    expect(stale).not.toHaveBeenCalled();
    expect(superseded).not.toHaveBeenCalled();
    expect(h.sent.map((job) => job.source)).toEqual(['# Old', '# Latest']);
    h.reply(1);
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: parseMarkdown('# Latest'), error: null }),
    );
    h.parser.dispose();
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it('invalidates results on source changes and disposal', () => {
    const h = harness();
    const done = vi.fn();
    h.parser.parse('# Old', done);
    h.parser.cancel();
    h.reply(0);
    expect(done).not.toHaveBeenCalled();
    h.parser.parse('# Next', done);
    h.parser.dispose();
    h.reply(1);
    h.parser.parse('# Closed', done);
    expect(done).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(2);
  });

  it('falls back once on worker startup failure without retrying the worker', () => {
    const factory = vi.fn(() => {
      throw new Error('Worker blocked');
    });
    const parser = new BackgroundMarkdownParser(factory);
    const done = vi.fn();
    parser.parse('# First', done);
    parser.parse('# Second', done);
    expect(done.mock.calls).toEqual([[null], [null]]);
    expect(factory).toHaveBeenCalledTimes(1);
    parser.dispose();
  });

  it.each(['error', 'messageerror', 'invalid response', 'timeout'])(
    'falls back to the latest job on %s',
    (failure) => {
      vi.useFakeTimers();
      const h = harness();
      const stale = vi.fn(),
        latest = vi.fn();
      h.parser.parse('# Old', stale);
      h.parser.parse('# Latest', latest);
      if (failure === 'error') h.worker.onerror?.(new ErrorEvent('error'));
      if (failure === 'messageerror') h.worker.onmessageerror?.(new MessageEvent('messageerror'));
      if (failure === 'invalid response')
        h.worker.onmessage?.(new MessageEvent('message', { data: {} }));
      if (failure === 'timeout') vi.advanceTimersByTime(30_000);
      expect(stale).not.toHaveBeenCalled();
      expect(latest).toHaveBeenCalledExactlyOnceWith(null);
      expect(h.terminate).toHaveBeenCalledTimes(1);
      h.parser.dispose();
    },
  );

  it('matches the synchronous parser and rejects malformed envelopes', () => {
    const source = '---\ntitle: Example\n---\n\n# Heading\n\n- **bold**\n\n```js\nx < 2\n```\n';
    const result = handleMarkdownParseRequest({ id: 1, source });
    expect(result).toEqual({ id: 1, markdown: parseMarkdown(source), error: null });
    expect(isMarkdownParseResult(result)).toBe(true);
    for (const invalid of [
      null,
      {},
      { id: -1, source },
      { id: 1, source, extra: true },
      { id: 1, source: 42 },
    ]) {
      expect(handleMarkdownParseRequest(invalid)).toBeNull();
    }
    expect(isMarkdownParseResult({ id: 1, markdown: {}, error: null })).toBe(false);
    expect(isMarkdownParseResult({ id: 1, markdown: null, error: 'Parse failed' })).toBe(true);
  });
});
