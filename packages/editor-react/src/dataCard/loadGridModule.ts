export type GridModule = typeof import('@bendyline/squisq-grid-react');

let pending: Promise<GridModule | null> | null = null;

/** One lazy boundary shared by the Write and Slideshow grid hosts. */
export function loadGridModule(): Promise<GridModule | null> {
  pending ??= import('@bendyline/squisq-grid-react').catch(() => {
    pending = null;
    return null;
  });
  return pending;
}
