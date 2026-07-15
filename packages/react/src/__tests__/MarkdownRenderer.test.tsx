import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import {
  parseMarkdown,
  type MarkdownBlockNode,
  type MarkdownInlineNode,
} from '@bendyline/squisq/markdown';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 100 50"><text>Rendered graph</text></svg>`,
      diagramType: 'flowchart-v2',
    })),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────

function text(value: string): MarkdownInlineNode {
  return { type: 'text', value };
}

function paragraph(...children: MarkdownInlineNode[]): MarkdownBlockNode {
  return { type: 'paragraph', children };
}

function heading(
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  ...children: MarkdownInlineNode[]
): MarkdownBlockNode {
  return { type: 'heading', depth, children };
}

function parseNodes(markdown: string): MarkdownBlockNode[] {
  return parseMarkdown(markdown).children;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('MarkdownRenderer', () => {
  it('renders null for empty nodes', () => {
    const { container } = render(<MarkdownRenderer nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a paragraph', () => {
    const { container } = render(<MarkdownRenderer nodes={[paragraph(text('Hello world'))]} />);
    const p = container.querySelector('p.squisq-md-p');
    expect(p).toBeTruthy();
    expect(p?.textContent).toBe('Hello world');
  });

  it('renders headings at correct depth', () => {
    const nodes: MarkdownBlockNode[] = [
      heading(1, text('Title')),
      heading(2, text('Subtitle')),
      heading(3, text('Section')),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('h2')?.textContent).toBe('Subtitle');
    expect(container.querySelector('h3')?.textContent).toBe('Section');
  });

  it('renders emphasis and strong inline', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph(text('normal '), { type: 'emphasis', children: [text('italic')] }, text(' and '), {
        type: 'strong',
        children: [text('bold')],
      }),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });

  it('renders inline code', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph(text('run '), { type: 'inlineCode', value: 'npm install' }),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const code = container.querySelector('code.squisq-md-inline-code');
    expect(code?.textContent).toBe('npm install');
  });

  it('renders a link with target _blank', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph({
        type: 'link',
        url: 'https://example.com',
        title: 'Example',
        children: [text('click')],
      }),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const a = container.querySelector('a.squisq-md-link') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.href).toContain('example.com');
    expect(a.target).toBe('_blank');
    expect(a.textContent).toBe('click');
  });

  it('renders unsafe links as inert text by default', () => {
    const { container } = render(
      <MarkdownRenderer nodes={parseNodes('[x](javascript:alert(1))')} />,
    );
    expect(container.querySelector('a.squisq-md-link')).toBeNull();
    expect(container.querySelector('.squisq-md-link--blocked')?.textContent).toBe('x');
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('linkSchemes allows a host scheme as a real anchor, never executable ones', () => {
    const nodes = parseNodes('[a](workspace-nav:src%2Fa.ts) [b](javascript:alert(1))');
    const blocked = render(<MarkdownRenderer nodes={nodes} />);
    expect(blocked.container.querySelector('a.squisq-md-link')).toBeNull();

    const allowed = render(<MarkdownRenderer nodes={nodes} linkSchemes={['workspace-nav']} />);
    const a = allowed.container.querySelector('a.squisq-md-link') as HTMLAnchorElement;
    expect(a?.getAttribute('href')).toBe('workspace-nav:src%2Fa.ts');
    // javascript: stays blocked even when a host lists it
    const evil = render(
      <MarkdownRenderer
        nodes={parseNodes('[b](javascript:alert(1))')}
        linkSchemes={['javascript']}
      />,
    );
    expect(evil.container.querySelector('a.squisq-md-link')).toBeNull();
  });

  it('renders an image', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph({
        type: 'image',
        url: '/cat.jpg',
        alt: 'A cat',
      }),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const img = container.querySelector('img.squisq-md-image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.alt).toBe('A cat');
  });

  it('renders an unordered list', () => {
    const nodes: MarkdownBlockNode[] = [
      {
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', children: [paragraph(text('Item A'))] },
          { type: 'listItem', children: [paragraph(text('Item B'))] },
        ],
      },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const ul = container.querySelector('ul.squisq-md-ul');
    expect(ul).toBeTruthy();
    const items = ul?.querySelectorAll('li');
    expect(items?.length).toBe(2);
    expect(items?.[0]?.textContent).toBe('Item A');
  });

  it('renders an ordered list with start number', () => {
    const nodes: MarkdownBlockNode[] = [
      {
        type: 'list',
        ordered: true,
        start: 3,
        children: [{ type: 'listItem', children: [paragraph(text('Third'))] }],
      },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const ol = container.querySelector('ol.squisq-md-ol') as HTMLOListElement;
    expect(ol).toBeTruthy();
    expect(ol.start).toBe(3);
  });

  it('renders a task list item with checkbox', () => {
    const nodes: MarkdownBlockNode[] = [
      {
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', checked: true, children: [paragraph(text('Done'))] },
          { type: 'listItem', checked: false, children: [paragraph(text('Todo'))] },
        ],
      },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it('renders a code block', () => {
    const nodes: MarkdownBlockNode[] = [
      { type: 'code', lang: 'typescript', value: 'const x = 1;' },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const pre = container.querySelector('pre.squisq-md-code-block');
    expect(pre).toBeTruthy();
    const code = pre?.querySelector('code.language-typescript');
    expect(code?.textContent).toBe('const x = 1;');
  });

  it('renders Mermaid fences as diagrams instead of source markup', async () => {
    const nodes = parseNodes('```mermaid\nflowchart LR\n  a --> b\n```');
    const { container } = render(<MarkdownRenderer nodes={nodes} />);

    await waitFor(() => {
      expect(container.querySelector('.squisq-mermaid-render-svg svg')).not.toBeNull();
    });
    expect(container.querySelector('pre.squisq-md-code-block')).toBeNull();
    expect(container.textContent).toContain('Rendered graph');
    expect(container.textContent).not.toContain('flowchart LR');
  });

  it('renders a blockquote', () => {
    const nodes: MarkdownBlockNode[] = [
      { type: 'blockquote', children: [paragraph(text('Quoted text'))] },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const bq = container.querySelector('blockquote.squisq-md-blockquote');
    expect(bq).toBeTruthy();
    expect(bq?.textContent).toBe('Quoted text');
  });

  it('renders a thematic break', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph(text('Before')),
      { type: 'thematicBreak' },
      paragraph(text('After')),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('hr.squisq-md-hr')).toBeTruthy();
  });

  it('renders a table', () => {
    const nodes: MarkdownBlockNode[] = [
      {
        type: 'table',
        align: ['left', 'right'],
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', isHeader: true, children: [text('Name')] },
              { type: 'tableCell', isHeader: true, children: [text('Value')] },
            ],
          },
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [text('A')] },
              { type: 'tableCell', children: [text('1')] },
            ],
          },
        ],
      },
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const table = container.querySelector('table.squisq-md-table');
    expect(table).toBeTruthy();
    expect(table?.querySelectorAll('th').length).toBe(2);
    expect(table?.querySelectorAll('td').length).toBe(2);
  });

  it('renders strikethrough', () => {
    const nodes: MarkdownBlockNode[] = [paragraph({ type: 'delete', children: [text('removed')] })];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const del = container.querySelector('del.squisq-md-del');
    expect(del?.textContent).toBe('removed');
  });

  it('renders a hard break', () => {
    const nodes: MarkdownBlockNode[] = [paragraph(text('line1'), { type: 'break' }, text('line2'))];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('br')).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(
      <MarkdownRenderer nodes={[paragraph(text('test'))]} className="custom" />,
    );
    expect(container.querySelector('.squisq-md.custom')).toBeTruthy();
  });

  it('sanitizes raw HTML by default', () => {
    const nodes = parseNodes(
      '<div><img src="x.jpg" onerror="alert(1)"><script>alert(1)</script><span onclick="alert(1)">ok</span></div>',
    );
    const { container } = render(<MarkdownRenderer nodes={nodes} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('x.jpg');
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('span')?.getAttribute('onclick')).toBeNull();
    expect(container.textContent).toContain('ok');
    expect(container.textContent).not.toContain('alert(1)');
  });

  it('strips raw HTML when requested', () => {
    const { container } = render(
      <MarkdownRenderer nodes={parseNodes('<div><span>hidden</span></div>')} htmlPolicy="strip" />,
    );
    expect(container.textContent).not.toContain('hidden');
    expect(container.querySelector('span')).toBeNull();
  });

  it('preserves trusted HTML structure without executable attributes', () => {
    const { container } = render(
      <MarkdownRenderer
        nodes={parseNodes('<div><span class="trusted" onclick="alert(1)">ok</span></div>')}
        htmlPolicy="trusted"
      />,
    );
    const span = container.querySelector('span.trusted');
    expect(span?.getAttribute('onclick')).toBeNull();
  });

  it('blocks executable URLs under the trusted policy', () => {
    const { container } = render(
      <MarkdownRenderer
        nodes={parseNodes('<a href="javascript:alert(1)">bad</a><img src="javascript:x">')}
        htmlPolicy="trusted"
      />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBeNull();
  });

  // Host-affecting tags (style/script/…) must never reach the document.
  // A bare <style> applies page-wide (CSS isn't scoped outside shadow DOM
  // / iframes), so an embedded game's <style> in a chat message used to
  // restyle the whole app chrome. Guard it across every policy.
  it('drops a raw <style> by default so it cannot leak onto the host', () => {
    const { container } = render(
      <MarkdownRenderer
        nodes={parseNodes('<div><style>body{font-family:monospace}</style><p>hi</p></div>')}
      />,
    );
    expect(container.querySelector('style')).toBeNull();
    expect(container.textContent).toContain('hi');
    expect(container.textContent).not.toContain('font-family');
  });

  it('drops <style>/<script> even under the trusted policy, keeping safe content', () => {
    const { container } = render(
      <MarkdownRenderer
        nodes={parseNodes(
          '<div class="game"><style>body{font-family:monospace}</style><script>alert(1)</script><p>play</p></div>',
        )}
        htmlPolicy="trusted"
      />,
    );
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('div.game')).toBeTruthy();
    expect(container.textContent).toContain('play');
    expect(container.textContent).not.toContain('font-family');
  });

  // A raw-HTML anchor reconstructed with `target=_blank` and no `rel` hands the
  // destination a live `window.opener` back to this page — reverse tabnabbing,
  // in markup that ships inside customer-exported standalone HTML. Markdown
  // links hardcode `rel="noopener noreferrer"`; raw HTML must not opt out.
  describe('raw-HTML anchor targets', () => {
    const anchor = (html: string): HTMLAnchorElement | null => {
      const { container } = render(
        <MarkdownRenderer nodes={parseNodes(html)} htmlPolicy="trusted" />,
      );
      return container.querySelector('a');
    };

    it('forces noopener on target=_blank authored without rel', () => {
      const a = anchor('<a href="https://evil.example.test" target="_blank">x</a>');
      expect(a?.getAttribute('target')).toBe('_blank');
      expect(a?.getAttribute('rel')?.split(/\s+/)).toContain('noopener');
    });

    it('preserves an authored rel while adding noopener', () => {
      const a = anchor('<a href="https://example.test" target="_blank" rel="nofollow">x</a>');
      const rel = a?.getAttribute('rel')?.split(/\s+/) ?? [];
      expect(rel).toContain('nofollow');
      expect(rel).toContain('noopener');
    });

    it('does not duplicate an already-correct rel', () => {
      const a = anchor(
        '<a href="https://example.test" target="_blank" rel="noopener noreferrer">x</a>',
      );
      expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('overrides an explicit opener token', () => {
      const a = anchor('<a href="https://evil.example.test" target="_blank" rel="opener">x</a>');
      const rel = a?.getAttribute('rel')?.split(/\s+/) ?? [];
      expect(rel).toContain('noopener');
      expect(rel).not.toContain('opener');
    });

    it('forces noopener on a named target, which also opens a new context', () => {
      const a = anchor('<a href="https://evil.example.test" target="win1">x</a>');
      expect(a?.getAttribute('rel')?.split(/\s+/)).toContain('noopener');
    });

    it('leaves a same-context target alone', () => {
      const a = anchor('<a href="https://example.test" target="_self">x</a>');
      expect(a?.getAttribute('rel')).toBeNull();
    });

    it('leaves an anchor with no target alone', () => {
      const a = anchor('<a href="https://example.test">x</a>');
      expect(a?.getAttribute('rel')).toBeNull();
    });
  });

  it('drops a raw <style> on the verbatim path when htmlChildren was not parsed', () => {
    // parseHtml:false leaves htmlChildren empty while rawHtml keeps the
    // markup — the raw-string backstop must still refuse the fast path.
    const node = {
      type: 'htmlBlock',
      rawHtml: '<style>body{font-family:monospace}</style><p>play</p>',
      htmlChildren: [],
    } as unknown as MarkdownBlockNode;
    const { container } = render(<MarkdownRenderer nodes={[node]} htmlPolicy="trusted" />);
    expect(container.querySelector('style')).toBeNull();
    expect(container.textContent).not.toContain('font-family');
  });
});
