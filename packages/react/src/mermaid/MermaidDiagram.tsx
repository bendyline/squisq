import { useEffect, useState } from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import { DEFAULT_THEME } from '@bendyline/squisq/doc';
import { mermaidRenderErrorMessage, renderMermaidSvg } from './mermaidRuntime.js';

let renderSequence = 0;

export interface MermaidDiagramProps {
  source: string;
  className?: string;
  ariaLabel?: string;
  /** Resolved Squisq theme whose palette Mermaid should inherit. */
  theme?: Theme;
}

/** Read-only Mermaid rendering for page bodies and slide layers. */
export function MermaidDiagram({
  source,
  className,
  ariaLabel = 'Mermaid diagram',
  theme = DEFAULT_THEME,
}: MermaidDiagramProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let current = true;
    const id = `squisq-rich-mermaid-${++renderSequence}`;
    setRendering(true);
    setError('');
    // Let Mermaid use its temporary document.body host. Rendering inside this
    // component can put the measurement pass beneath a scaled slide SVG
    // foreignObject; getBoundingClientRect() then reports transformed label
    // sizes and Mermaid bakes clipped foreignObject dimensions into the SVG.
    void renderMermaidSvg(id, source, undefined, theme)
      .then((result) => {
        if (!current) return;
        setSvg(result.svg);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setSvg('');
        setError(mermaidRenderErrorMessage(caught));
      })
      .finally(() => {
        if (current) setRendering(false);
      });
    return () => {
      current = false;
    };
  }, [source, theme]);

  const classes = ['squisq-mermaid-rendered', className].filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      role="img"
      aria-label={ariaLabel}
      style={{ background: theme.colors.backgroundLight, color: theme.colors.text }}
    >
      {rendering && <div className="squisq-mermaid-render-status">Rendering diagram…</div>}
      {!rendering && error && (
        <div className="squisq-mermaid-render-error" role="alert">
          <strong>Mermaid could not render this diagram.</strong>
          <pre>{error}</pre>
        </div>
      )}
      {!rendering && !error && svg && (
        <div
          className="squisq-mermaid-render-svg"
          // Mermaid's strict security level sanitizes authored markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
