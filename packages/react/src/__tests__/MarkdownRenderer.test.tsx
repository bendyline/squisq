import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownRenderer } from '../MarkdownRenderer';
import type { MarkdownBlockNode, MarkdownInlineNode } from '@bendyline/squisq/markdown';

// ── Helpers ────────────────────────────────────────────────────────

function text(value: string): MarkdownInlineNode {
  return { type: 'text', value };
}

function paragraph(...children: MarkdownInlineNode[]): MarkdownBlockNode {
  return { type: 'paragraph', children };
}

function heading(depth: 1 | 2 | 3 | 4 | 5 | 6, ...children: MarkdownInlineNode[]): MarkdownBlockNode {
  return { type: 'heading', depth, children };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('MarkdownRenderer', () => {
  it('renders null for empty nodes', () => {
    const { container } = render(<MarkdownRenderer nodes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a paragraph', () => {
    const { container } = render(
      <MarkdownRenderer nodes={[paragraph(text('Hello world'))]} />,
    );
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
      paragraph(
        text('normal '),
        { type: 'emphasis', children: [text('italic')] },
        text(' and '),
        { type: 'strong', children: [text('bold')] },
      ),
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
        children: [
          { type: 'listItem', children: [paragraph(text('Third'))] },
        ],
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
    const nodes: MarkdownBlockNode[] = [
      paragraph({ type: 'delete', children: [text('removed')] }),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const del = container.querySelector('del.squisq-md-del');
    expect(del?.textContent).toBe('removed');
  });

  it('renders a hard break', () => {
    const nodes: MarkdownBlockNode[] = [
      paragraph(text('line1'), { type: 'break' }, text('line2')),
    ];
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('br')).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(
      <MarkdownRenderer nodes={[paragraph(text('test'))]} className="custom" />,
    );
    expect(container.querySelector('.squisq-md.custom')).toBeTruthy();
  });
});
