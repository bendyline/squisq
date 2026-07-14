import { Icon } from '../Icon';

interface SceneViewControlsProps {
  scale: number;
  fit: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}

/** Shared zoom/fit chrome for source-backed simple and complex diagrams. */
export function SceneViewControls({
  scale,
  fit,
  onZoomOut,
  onZoomIn,
  onFit,
}: SceneViewControlsProps) {
  return (
    <div className="squisq-scene-view-controls" role="toolbar" aria-label="Diagram view">
      <button type="button" onClick={onZoomOut} title="Zoom out" aria-label="Zoom out">
        <Icon icon="fa-solid fa-minus" />
      </button>
      <output className="squisq-scene-view-scale" aria-label="Diagram zoom">
        {Math.round(scale * 100)}%
      </output>
      <button type="button" onClick={onZoomIn} title="Zoom in" aria-label="Zoom in">
        <Icon icon="fa-solid fa-plus" />
      </button>
      <button
        type="button"
        className="squisq-scene-view-fit"
        data-active={fit || undefined}
        aria-pressed={fit}
        onClick={onFit}
        title="Fit all shapes in the canvas"
        aria-label="Fit diagram"
      >
        Fit
      </button>
    </div>
  );
}
