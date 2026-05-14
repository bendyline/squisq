/**
 * ImageEditorDemo
 *
 * Sample harness for `<ImageEditor>` — wraps it in a `MemoryContentContainer`
 * scoped to `pic_files/` and seeds it with a small generated PNG so the
 * editor has a base layer to manipulate. Exists purely to exercise the
 * editor in the dev site.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MemoryContentContainer,
  scopeContainer,
  type ContentContainer,
} from '@bendyline/squisq/storage';
import { ImageEditor } from '@bendyline/squisq-editor-react';

/** Build a small radial-gradient PNG that we can hand to the editor. */
async function buildSeedPng(width = 480, height = 320): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    20,
    width / 2,
    height / 2,
    Math.max(width, height) / 1.2,
  );
  grad.addColorStop(0, '#ffd29b');
  grad.addColorStop(1, '#7a3b00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Squisq Image Editor', width / 2, height / 2);
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export function ImageEditorDemo() {
  // One container per mount of this demo so reloads start fresh.
  const parent = useMemo<ContentContainer>(() => new MemoryContentContainer(), []);
  const sidecar = useMemo(() => scopeContainer(parent, 'pic_files'), [parent]);

  const [seedUrl, setSeedUrl] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      try {
        const blob = await buildSeedPng();
        if (!blob) {
          setSeedError('Failed to build seed PNG — canvas not available.');
          return;
        }
        url = URL.createObjectURL(blob);
        setSeedUrl(url);
      } catch (err: unknown) {
        setSeedError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  if (seedError) {
    return (
      <div style={{ padding: '2rem', color: '#a33' }}>
        Image editor demo failed to seed: {seedError}
      </div>
    );
  }
  if (!seedUrl) {
    return <div style={{ padding: '2rem' }}>Generating seed image…</div>;
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex' }}>
      <ImageEditor
        filesContainer={sidecar}
        initialSrc={seedUrl}
        allowVersioning
        versioningAutoSaveIdleMs={3000}
      />
    </div>
  );
}
