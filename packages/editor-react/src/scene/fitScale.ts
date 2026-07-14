export interface SceneSize {
  width: number;
  height: number;
}

/**
 * Scale content so it is wholly visible, without enlarging it past the
 * supplied maximum (100% by default). Invalid or not-yet-measured dimensions
 * fall back to 100%.
 */
export function calculateFitScale(content: SceneSize, container: SceneSize, maxScale = 1): number {
  if (content.width <= 0 || content.height <= 0 || container.width <= 0 || container.height <= 0) {
    return Math.min(1, maxScale);
  }

  return Math.min(maxScale, container.width / content.width, container.height / content.height);
}
