import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { FenceRendererContext } from '../hooks/FenceRendererContext';
import { createJsonFormFenceRenderer } from '../jsonView/jsonFormFenceRenderer';
import { LinearDocView } from '../LinearDocView';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}"><text>mermaid</text></svg>`,
      diagramType: 'flowchart-v2',
    })),
  },
}));

function parseNodes(markdown: string): MarkdownBlockNode[] {
  return parseMarkdown(markdown).children;
}

const ACTION_MD = '```gezel-action\nkind: fire-craftbook\ntitle: Fix it\n```';

describe('MarkdownRenderer fenceRenderers', () => {
  it('renders a claimed fence through the host renderer', () => {
    const renderers: FenceRendererMap = {
      'gezel-action': (ctx) => <div data-testid="widget">{`lang=${ctx.lang} mode=${ctx.mode}`}</div>,
    };
    const { container, getByTestId } = render(
      <MarkdownRenderer nodes={parseNodes(ACTION_MD)} fenceRenderers={renderers} />,
    );
    expect(getByTestId('widget').textContent).toBe('lang=gezel-action mode=read');
    expect(container.querySelector('.squisq-md-fence-widget-gezel-action')).toBeTruthy();
    expect(container.querySelector('pre.squisq-md-code-block')).toBeNull();
  });

  it('passes the verbatim fence body and read-path meta', () => {
    const seen: Array<{ value: string; meta?: string }> = [];
    const renderers: FenceRendererMap = {
      'gezel-action': (ctx) => {
        seen.push({ value: ctx.value, ...(ctx.meta !== undefined ? { meta: ctx.meta } : {}) });
        return null;
      },
    };
    render(
      <MarkdownRenderer
        nodes={parseNodes('```gezel-action v=1\nkind: create-task\n```')}
        fenceRenderers={renderers}
      />,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].value).toBe('kind: create-task');
    expect(seen[0].meta).toBe('v=1');
  });

  it('leaves unclaimed fences as ordinary code blocks', () => {
    const renderers: FenceRendererMap = { 'gezel-action': () => <div data-testid="widget" /> };
    const { container, queryByTestId } = render(
      <MarkdownRenderer nodes={parseNodes('```ts\nconst x = 1;\n```')} fenceRenderers={renderers} />,
    );
    expect(queryByTestId('widget')).toBeNull();
    expect(container.querySelector('code.language-ts')).toBeTruthy();
  });

  it('a host renderer registered for mermaid wins over the built-in diagram', () => {
    const renderers: FenceRendererMap = { mermaid: () => <div data-testid="custom-mermaid" /> };
    const { getByTestId, container } = render(
      <MarkdownRenderer
        nodes={parseNodes('```mermaid\nflowchart LR\n a --> b\n```')}
        fenceRenderers={renderers}
      />,
    );
    expect(getByTestId('custom-mermaid')).toBeTruthy();
    expect(container.querySelector('.squisq-md-mermaid')).toBeNull();
  });

  it('a throwing renderer falls back to the plain code block', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderers: FenceRendererMap = {
      'gezel-action': () => {
        throw new Error('widget exploded');
      },
    };
    const { container } = render(
      <MarkdownRenderer nodes={parseNodes(ACTION_MD)} fenceRenderers={renderers} />,
    );
    expect(container.querySelector('code.language-gezel-action')?.textContent).toContain(
      'kind: fire-craftbook',
    );
    spy.mockRestore();
  });

  it('falls back to the ambient FenceRendererContext, with the prop winning', () => {
    const ambient: FenceRendererMap = { 'gezel-action': () => <div data-testid="ambient" /> };
    const explicit: FenceRendererMap = { 'gezel-action': () => <div data-testid="explicit" /> };

    const fromContext = render(
      <FenceRendererContext.Provider value={ambient}>
        <MarkdownRenderer nodes={parseNodes(ACTION_MD)} />
      </FenceRendererContext.Provider>,
    );
    expect(fromContext.getByTestId('ambient')).toBeTruthy();
    fromContext.unmount();

    const overridden = render(
      <FenceRendererContext.Provider value={ambient}>
        <MarkdownRenderer nodes={parseNodes(ACTION_MD)} fenceRenderers={explicit} />
      </FenceRendererContext.Provider>,
    );
    expect(overridden.getByTestId('explicit')).toBeTruthy();
    expect(overridden.queryByTestId('ambient')).toBeNull();
  });
});

describe('LinearDocView fenceRenderers threading', () => {
  it('renders claimed fences in prose sections', () => {
    const renderers: FenceRendererMap = {
      'gezel-action': () => <div data-testid="linear-widget" />,
    };
    const { getByTestId } = render(
      <LinearDocView markdown={`# Report\n\nSome findings.\n\n${ACTION_MD}`} fenceRenderers={renderers} />,
    );
    expect(getByTestId('linear-widget')).toBeTruthy();
  });

  it('renders claimed fences preserved inside typed template sections', () => {
    const renderers: FenceRendererMap = {
      'gezel-action': () => <div data-testid="template-widget" />,
    };
    const { getByTestId } = render(
      <LinearDocView
        markdown={`# Rich {[factCard]}\n\nNarrative copy.\n\n${ACTION_MD}`}
        fenceRenderers={renderers}
      />,
    );
    expect(getByTestId('template-widget')).toBeTruthy();
  });
});

describe('createJsonFormFenceRenderer', () => {
  it('renders a YAML body through JsonView and fires action callbacks with parsed data', () => {
    const onAction = vi.fn();
    const renderers: FenceRendererMap = {
      'gezel-action': createJsonFormFenceRenderer({
        actions: [{ id: 'fire', label: 'Fire', variant: 'primary' }],
        onAction,
      }),
    };
    const { container, getByRole } = render(
      <MarkdownRenderer nodes={parseNodes(ACTION_MD)} fenceRenderers={renderers} />,
    );
    expect(container.querySelector('.squisq-json-view')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Fire' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toBe('fire');
    expect(onAction.mock.calls[0][1]).toMatchObject({ kind: 'fire-craftbook', title: 'Fix it' });
  });

  it('renders an unparseable body as a visible code block with a diagnostic', () => {
    const renderers: FenceRendererMap = {
      'gezel-action': createJsonFormFenceRenderer({}),
    };
    const { container } = render(
      <MarkdownRenderer
        nodes={parseNodes('```gezel-action\n{ not: valid json\n```')}
        fenceRenderers={renderers}
      />,
    );
    expect(container.querySelector('.squisq-json-fence--invalid')).toBeTruthy();
    expect(container.querySelector('.squisq-json-fence-error')).toBeTruthy();
  });
});
