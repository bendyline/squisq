import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { imageExportFilename } from '../imageExportShared.js';

const mocks = vi.hoisted(() => {
  const fakeCanvas = {
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['png-bytes'])),
  } as unknown as HTMLCanvasElement;
  return {
    init: vi.fn(async (..._args: unknown[]) => 0),
    captureCanvasFrame: vi.fn(async (..._args: unknown[]) => fakeCanvas),
    destroy: vi.fn(),
  };
});

vi.mock('../hooks/useFrameCapture.js', () => ({
  useFrameCapture: () => ({
    init: mocks.init,
    setCoverVisible: vi.fn(),
    captureFrame: vi.fn(),
    captureCanvasFrame: mocks.captureCanvasFrame,
    destroy: mocks.destroy,
  }),
}));

import { DashboardImageExportModal } from '../DashboardImageExportModal';

function testDoc(): Doc {
  return {
    articleId: 'modal-test',
    duration: 10,
    blocks: [
      { id: 'b1', startTime: 0, duration: 5, audioSegment: 0, title: 'One' },
      { id: 'b2', startTime: 5, duration: 5, audioSegment: 0, title: 'Two' },
    ],
    audio: { segments: [] },
  } as Doc;
}

beforeEach(() => {
  mocks.init.mockClear();
  mocks.captureCanvasFrame.mockClear();
  mocks.destroy.mockClear();
});

describe('imageExportShared filename helper', () => {
  it('builds sanitized suffixed filenames', () => {
    expect(imageExportFilename('Quarterly plan.md', 'dashboard', 'png')).toBe(
      'Quarterly plan-dashboard.png',
    );
    expect(imageExportFilename('bad:<name>.md', 'dashboard', 'jpeg')).toBe(
      'bad--name--dashboard.jpg',
    );
    expect(imageExportFilename(undefined, 'dashboard', 'webp')).toBe('document-dashboard.webp');
  });
});

describe('DashboardImageExportModal', () => {
  it('renders a dashboard capture and hands the blob to the host save flow', async () => {
    const saveOutput = vi.fn((_blob: Blob, _filename: string) => true);
    const onClose = vi.fn();
    render(
      <DashboardImageExportModal
        doc={testDoc()}
        defaultFileName="Fleet Report.md"
        saveOutput={saveOutput}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Choose location|Rendering/ }));

    await waitFor(() => expect(saveOutput).toHaveBeenCalledTimes(1));
    // The capture mounted the DASHBOARD rendition at the default resolution.
    expect(mocks.init).toHaveBeenCalledTimes(1);
    const [docArg, renderOptions, captionMode] = mocks.init.mock.calls[0] as unknown as [
      Doc,
      Record<string, unknown>,
      string,
    ];
    expect(docArg.articleId).toBe('modal-test');
    expect(renderOptions).toMatchObject({
      width: 1920,
      height: 1080,
      animationsEnabled: false,
      displayMode: 'dashboard',
      dashboard: { layout: 'auto', title: true, documentTitle: 'Fleet Report' },
    });
    expect(captionMode).toBe('off');
    expect(mocks.captureCanvasFrame).toHaveBeenCalledWith(0);
    expect(saveOutput.mock.calls[0][1]).toBe('Fleet Report-dashboard.png');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.destroy).toHaveBeenCalled();
  });

  it('threads the selected resolution, layout, and title toggle into the capture', async () => {
    const saveOutput = vi.fn();
    render(
      <DashboardImageExportModal
        doc={testDoc()}
        defaultResolution="square"
        defaultLayout="grid-2x2"
        defaultShowTitle={false}
        saveOutput={saveOutput}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Choose location/ }));
    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    expect(mocks.init.mock.calls[0][1]).toMatchObject({
      width: 1080,
      height: 1080,
      dashboard: { layout: 'grid-2x2', title: false },
    });
  });

  it('disables export while custom dimensions are invalid', () => {
    render(<DashboardImageExportModal doc={testDoc()} saveOutput={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Image resolution'), {
      target: { value: 'custom' },
    });
    fireEvent.change(screen.getByLabelText('Image width'), { target: { value: '10' } });

    expect(screen.getByRole('alert').textContent).toContain('at least 64');
    const exportButton = screen.getByRole('button', {
      name: /Choose location/,
    }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
  });

  it('keeps the dialog open when the host save flow reports a cancel', async () => {
    const saveOutput = vi.fn((_blob: Blob, _filename: string) => false);
    const onClose = vi.fn();
    render(<DashboardImageExportModal doc={testDoc()} saveOutput={saveOutput} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Choose location/ }));
    await waitFor(() => expect(saveOutput).toHaveBeenCalledTimes(1));
    expect(mocks.destroy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
