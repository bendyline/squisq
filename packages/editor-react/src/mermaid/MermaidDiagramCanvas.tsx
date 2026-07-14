import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { mermaidErrorMessage, renderMermaidDiagram } from './mermaidRenderer';

let renderSequence = 0;

export interface MermaidDiagramCanvasProps {
  source: string;
  maximized?: boolean;
  onToggleMaximize?: () => void;
}

export function MermaidDiagramCanvas({
  source,
  maximized = false,
  onToggleMaximize,
}: MermaidDiagramCanvasProps) {
  const renderContainerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState('');
  const [diagramType, setDiagramType] = useState('mermaid');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let current = true;
    const id = `squisq-mermaid-svg-${++renderSequence}`;
    setRendering(true);
    setError('');
    void renderMermaidDiagram(id, source, renderContainerRef.current ?? undefined)
      .then((result) => {
        if (!current) return;
        setSvg(result.svg);
        setDiagramType(result.diagramType);
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setSvg('');
        setError(mermaidErrorMessage(caught));
      })
      .finally(() => {
        if (current) setRendering(false);
      });
    return () => {
      current = false;
    };
  }, [source]);

  return (
    <div className="squisq-mermaid-canvas" aria-label={`${diagramType} diagram editor`}>
      <div
        ref={renderContainerRef}
        className="squisq-mermaid-render-container"
        aria-hidden="true"
      />
      <div className="squisq-mermaid-canvas-controls" role="toolbar" aria-label="Diagram view">
        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(0.4, value - 0.2))}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Icon icon="fa-solid fa-minus" />
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          title="Fit diagram"
          aria-label="Fit diagram"
        >
          <span>{Math.round(zoom * 100)}%</span>
        </button>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(3, value + 0.2))}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Icon icon="fa-solid fa-plus" />
        </button>
      </div>
      {onToggleMaximize && (
        <button
          type="button"
          className="squisq-diagram-maximize-btn"
          onClick={onToggleMaximize}
          aria-label={maximized ? 'Restore diagram' : 'Maximize diagram'}
          title={maximized ? 'Restore diagram' : 'Maximize diagram'}
        >
          <Icon icon={maximized ? 'fa-solid fa-compress' : 'fa-solid fa-expand'} />
        </button>
      )}
      <div className="squisq-mermaid-canvas-scroll">
        {rendering && <div className="squisq-mermaid-status">Rendering Mermaid diagram…</div>}
        {!rendering && error && (
          <div className="squisq-mermaid-error" role="alert">
            <strong>Mermaid could not render this source.</strong>
            <pre>{error}</pre>
            <span>Open Source to edit the code block without losing it.</span>
          </div>
        )}
        {!error && svg && (
          <div
            className="squisq-mermaid-svg"
            style={{ width: `${zoom * 100}%` }}
            // Mermaid's strict security level sanitizes authored markup.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}

export default MermaidDiagramCanvas;
