import { useMemo } from 'react';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import {
  resolveTemplateContentPreviewResult,
  type TemplatePreviewSource,
} from './templateContentPreviewResolver';

export interface TemplateContentPreviewProps {
  templateName: string;
  source?: TemplatePreviewSource;
  fallback: JSX.Element;
}

export function TemplateContentPreview({
  templateName,
  source,
  fallback,
}: TemplateContentPreviewProps) {
  const preview = useMemo(
    () => (source ? resolveTemplateContentPreviewResult(templateName, source) : null),
    [templateName, source],
  );

  if (!source) return fallback;

  if (!preview?.visual) {
    if (!preview?.warning) return fallback;
    return (
      <div
        className="squisq-template-gallery-content-preview squisq-template-gallery-content-preview--fallback"
        style={{ aspectRatio: `${source.viewport.width} / ${source.viewport.height}` }}
        aria-hidden="true"
      >
        <div className="squisq-template-gallery-content-preview-fallback">{fallback}</div>
        <span className="squisq-template-gallery-content-preview-warning">{preview.warning}</span>
      </div>
    );
  }

  return (
    <div
      className="squisq-template-gallery-content-preview"
      style={{ aspectRatio: `${source.viewport.width} / ${source.viewport.height}` }}
      aria-hidden="true"
    >
      <MediaContext.Provider value={source.mediaProvider ?? null}>
        <BlockRenderer
          block={preview.visual}
          blockTime={0}
          basePath={source.basePath ?? '/'}
          viewport={source.viewport}
        />
      </MediaContext.Provider>
    </div>
  );
}
