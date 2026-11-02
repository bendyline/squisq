import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { handleMarkdownParseRequest, type MarkdownParseRequest } from '../markdownParseProtocol';

const large = (title: string) => `# ${title}\n\n${'A paragraph of words.\n\n'.repeat(1700)}`;
let context: EditorContextValue;
function Probe() {
  context = useEditorContext();
  return null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('editor background parsing', () => {
  it('keeps source current, discards stale parses and disposes the worker on unmount', async () => {
    vi.useFakeTimers();
    const requests: MarkdownParseRequest[] = [];
    const terminate = vi.fn();
    let worker: Worker;
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror = null;
        onmessageerror = null;
        constructor() {
          worker = this as unknown as Worker;
        }
        postMessage(request: MarkdownParseRequest) {
          requests.push(request);
        }
        terminate = terminate;
      },
    );
    const mounted = render(
      <EditorProvider initialMarkdown="# Initial">
        <Probe />
      </EditorProvider>,
    );
    act(() => context.setMarkdownSource(large('First')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(requests).toHaveLength(1);
    const previous = context.markdownDoc;
    act(() => context.setMarkdownSource(large('Latest')));
    expect(context.markdownSource).toBe(large('Latest'));
    act(() =>
      worker.onmessage?.(
        new MessageEvent('message', { data: handleMarkdownParseRequest(requests[0]) }),
      ),
    );
    expect(context.markdownDoc).toBe(previous);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(requests).toHaveLength(2);
    act(() =>
      worker.onmessage?.(
        new MessageEvent('message', { data: handleMarkdownParseRequest(requests[1]) }),
      ),
    );
    expect(context.markdownDoc).toEqual(handleMarkdownParseRequest(requests[1])?.markdown);
    expect(context.markdownSource).toBe(large('Latest'));
    expect(context.isParsing).toBe(false);
    mounted.unmount();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('continues parsing when the host cannot start a worker', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          attempt();
          throw new Error('Unavailable');
        }
      },
    );
    render(
      <EditorProvider initialMarkdown="# Initial">
        <Probe />
      </EditorProvider>,
    );
    for (const title of ['First', 'Second']) {
      act(() => context.setMarkdownSource(large(title)));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(context.parseError).toBeNull();
      expect(context.isParsing).toBe(false);
      expect(context.markdownDoc).toEqual(
        handleMarkdownParseRequest({ id: 1, source: large(title) })?.markdown,
      );
    }
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
