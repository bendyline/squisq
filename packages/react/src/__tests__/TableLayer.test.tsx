import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TableLayer } from '../layers/TableLayer';
import type { TableLayer as TableLayerType } from '@bendyline/squisq/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTableLayer(overrides: Partial<TableLayerType> = {}): TableLayerType {
  return {
    type: 'table',
    id: 'test-table',
    content: {
      headers: ['Name', 'Age', 'City'],
      rows: [
        ['Alice', '30', 'Seattle'],
        ['Bob', '25', 'Portland'],
      ],
      style: {
        headerBackground: '#1e3a5f',
        headerColor: '#ffffff',
        cellBackground: 'rgba(255,255,255,0.05)',
        cellColor: '#e0e0e0',
        borderColor: 'rgba(255,255,255,0.12)',
        fontSize: 28,
        fontFamily: 'system-ui',
        headerFontFamily: 'Georgia',
        borderRadius: 8,
      },
    },
    position: { x: '10%', y: '10%', width: '80%', height: '80%' },
    ...overrides,
  } as TableLayerType;
}

const viewport = { width: 1920, height: 1080 };

function renderTableLayer(layer?: TableLayerType) {
  return render(
    <svg>
      <TableLayer layer={layer ?? makeTableLayer()} viewport={viewport} blockTime={0} />
    </svg>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TableLayer', () => {
  it('renders a foreignObject element', () => {
    const { container } = renderTableLayer();
    const fo = container.querySelector('foreignObject');
    expect(fo).toBeTruthy();
  });

  it('renders a table element', () => {
    const { container } = renderTableLayer();
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
  });

  it('renders the correct number of header cells', () => {
    const { container } = renderTableLayer();
    const headers = container.querySelectorAll('th');
    expect(headers.length).toBe(3);
  });

  it('renders header text content', () => {
    const { container } = renderTableLayer();
    const headers = container.querySelectorAll('th');
    expect(headers[0].textContent).toBe('Name');
    expect(headers[1].textContent).toBe('Age');
    expect(headers[2].textContent).toBe('City');
  });

  it('renders the correct number of data rows', () => {
    const { container } = renderTableLayer();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('renders cell text content', () => {
    const { container } = renderTableLayer();
    const cells = container.querySelectorAll('td');
    expect(cells[0].textContent).toBe('Alice');
    expect(cells[1].textContent).toBe('30');
    expect(cells[2].textContent).toBe('Seattle');
    expect(cells[3].textContent).toBe('Bob');
  });

  it('applies header background color', () => {
    const { container } = renderTableLayer();
    const th = container.querySelector('th');
    expect(th?.style.background).toBe('rgb(30, 58, 95)');
  });

  it('applies font size from style', () => {
    const { container } = renderTableLayer();
    const table = container.querySelector('table');
    expect(table?.style.fontSize).toBe('28px');
  });

  it('applies column alignment when provided', () => {
    const layer = makeTableLayer();
    layer.content.align = ['left', 'center', 'right'];
    const { container } = renderTableLayer(layer);

    const headers = container.querySelectorAll('th');
    expect(headers[0].style.textAlign).toBe('left');
    expect(headers[1].style.textAlign).toBe('center');
    expect(headers[2].style.textAlign).toBe('right');
  });

  it('handles empty headers gracefully', () => {
    const layer = makeTableLayer();
    layer.content.headers = [];
    const { container } = renderTableLayer(layer);
    const thead = container.querySelector('thead');
    // No thead or empty thead
    expect(thead).toBeFalsy();
  });

  it('handles empty rows gracefully', () => {
    const layer = makeTableLayer();
    layer.content.rows = [];
    const { container } = renderTableLayer(layer);
    const tbody = container.querySelector('tbody');
    // No tbody or empty tbody
    expect(tbody).toBeFalsy();
  });

  it('sets foreignObject dimensions based on viewport percentage', () => {
    const { container } = renderTableLayer();
    const fo = container.querySelector('foreignObject');
    // 80% of 1920 = 1536
    expect(fo?.getAttribute('width')).toBe('1536');
    // 80% of 1080 = 864
    expect(fo?.getAttribute('height')).toBe('864');
  });
});
