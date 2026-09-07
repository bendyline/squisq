/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Block, Doc, TableLayer } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import {
  SlideshowDataGridProvider,
  SlideshowDataGridRenderer,
} from '../slideshow/SlideshowDataGrid';
import { collectSlideshowDataSources } from '../slideshow/slideshowDataSources';

const SIDECAR = 'report_files/data/report.csv';

function sourceDoc(): Doc {
  return {
    articleId: 'report',
    duration: 5,
    themeId: 'standard-light',
    audio: { segments: [] },
    blocks: [
      {
        id: 'report-table',
        startTime: 0,
        duration: 5,
        audioSegment: 0,
        template: 'dataTable',
        templateOverrides: { src: SIDECAR },
      },
    ],
  };
}

const layer: TableLayer = {
  type: 'table',
  id: 'table',
  content: {
    headers: ['Text#', 'Title'],
    // The bounded projection still carries 50 rows. The slideshow adapter
    // must report and render against the full source instead of this window.
    rows: Array.from({ length: 50 }, (_, index) => [String(index + 1), `Preview ${index + 1}`]),
    maxVisibleRows: 10,
    style: {
      headerBackground: '#c98f65',
      headerColor: '#172033',
      cellBackground: '#231f1c',
      cellColor: '#fff8e8',
      borderColor: '#675c54',
      fontSize: 28,
      fontFamily: 'system-ui',
    },
  },
  position: { x: 0, y: 0, width: 1500, height: 720 },
};

const renderedBlock: Block = {
  id: 'report-table',
  startTime: 0,
  duration: 5,
  audioSegment: 0,
  layers: [layer],
};

describe('SlideshowDataGrid', () => {
  it('collects sidecar-backed dataTable blocks but leaves authored rows alone', () => {
    const doc = sourceDoc();
    doc.blocks.push({
      id: 'authored-table',
      startTime: 0,
      duration: 5,
      audioSegment: 0,
      template: 'dataTable',
      templateOverrides: { src: 'report_files/data/other.csv' },
      templateData: { headers: ['A'], rows: [['1']] },
    });

    expect([...collectSlideshowDataSources(doc).keys()]).toEqual(['report-table']);
  });

  it('mounts the full themed virtual grid instead of stopping at the 50-row preview', async () => {
    const container = new MemoryContentContainer();
    const csv = [
      'Text#,Title',
      ...Array.from({ length: 75 }, (_, index) => `${index + 1},Full row ${index + 1}`),
    ].join('\n');
    await container.writeFile(SIDECAR, new TextEncoder().encode(csv), 'text/csv');

    const { container: rendered } = render(
      <SlideshowDataGridProvider doc={sourceDoc()} container={container} mediaRevision={0}>
        <SlideshowDataGridRenderer
          block={renderedBlock}
          layer={layer}
          width={1500}
          height={720}
          fallback={<table data-testid="bounded-fallback" />}
        />
      </SlideshowDataGridProvider>,
    );

    await waitFor(() => {
      expect(rendered.querySelector('.squisq-grid-status')?.textContent).toContain(
        '75 rows, 2 columns',
      );
    });
    const grid = rendered.querySelector<HTMLElement>('.squisq-slideshow-data-grid');
    expect(grid?.style.getPropertyValue('--squisq-grid-header-bg')).toBe('#c98f65');
    expect(grid?.style.getPropertyValue('--squisq-grid-bg')).toBe('#231f1c');
    expect(rendered.querySelector('.squisq-grid-filterrow')).toBeNull();
    expect(rendered.querySelector('[data-testid="bounded-fallback"]')).toBeNull();
  });
});
