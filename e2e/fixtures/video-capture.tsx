import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Doc } from '@bendyline/squisq/schemas';
import { useFrameCapture } from '../../packages/video-react/src/hooks/useFrameCapture';

const doc: Doc = {
  articleId: 'capture-pixels',
  duration: 4,
  startBlock: { title: 'Visible cover title', subtitle: 'Visible cover subtitle' },
  audio: { segments: [] },
  blocks: ['#ffffff', '#0066ff'].map((fill, index) => ({
    id: `slide-${index}`,
    audioSegment: 0,
    startTime: index * 2,
    duration: 2,
    transition: index === 1 ? { type: 'fade', duration: 0.5 } : undefined,
    layers: [
      {
        id: `background-${index}`,
        type: 'shape',
        content: { shape: 'rect', fill },
        position: { x: 0, y: 0, width: '100%', height: '100%' },
      },
      {
        id: `entrance-${index}`,
        type: 'shape',
        content: { shape: 'rect', fill: '#ff4400' },
        position: { x: '25%', y: '25%', width: '50%', height: '50%' },
        animation: { type: 'fadeIn', duration: 1 },
      },
    ],
  })),
};

function CaptureFixture() {
  const capture = useFrameCapture();
  const [state, setState] = useState('idle');
  const [frame, setFrame] = useState('');
  return (
    <>
      <button
        onClick={async () => {
          try {
            setState('working');
            await capture.init(doc, { width: 640, height: 360, animationsEnabled: true });
            setState('ready');
          } catch (error) {
            setState(String(error));
          }
        }}
      >
        Initialize
      </button>
      <label>
        Time
        <input id="time" type="number" defaultValue="0" step="0.05" />
      </label>
      <label>
        Cover
        <input id="cover" type="checkbox" />
      </label>
      <button
        onClick={async () => {
          try {
            setState('working');
            const time = Number((document.getElementById('time') as HTMLInputElement).value);
            await capture.setCoverVisible(
              (document.getElementById('cover') as HTMLInputElement).checked,
            );
            const canvas = await capture.captureCanvasFrame(time, { reuseIfUnchanged: true });
            setFrame(canvas.toDataURL('image/png'));
            setState('captured');
          } catch (error) {
            setState(String(error));
          }
        }}
      >
        Capture
      </button>
      <output id="state">{state}</output>
      <img id="captured" src={frame || undefined} alt="Captured frame" />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<CaptureFixture />);
