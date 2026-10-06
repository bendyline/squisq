import { useMemo } from 'react';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import {
  resolveTemplateContentPreviewResult,
  type TemplatePreviewResult,
  type TemplatePreviewSource,
} from './templateContentPreviewResolver';

export interface TemplateContentPreviewProps {
  templateName: string;
  source?: TemplatePreviewSource;
  resolvedPreview?: TemplatePreviewResult;
  fallback: JSX.Element;
}

export function TemplateContentPreview({
  templateName,
  source,
  resolvedPreview,
  fallback,
}: TemplateContentPreviewProps) {
  const preview = useMemo(
    () =>
      resolvedPreview ??
      (source ? resolveTemplateContentPreviewResult(templateName, source) : null),
    [templateName, source, resolvedPreview],
  );

  if (!source || !preview?.visual) return fallback;

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
          theme={source.theme}
          animationsEnabled={false}
        />
      </MediaContext.Provider>
    </div>
  );
}
