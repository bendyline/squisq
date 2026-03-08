/**
 * useViewportOrientation Hook
 *
 * Detects the current viewport orientation and returns the appropriate
 * VIEWPORT_PRESET for rendering docs. Automatically updates when
 * the window is resized.
 *
 * Thresholds:
 * - Portrait: height > width * 1.2 (significantly taller than wide)
 * - Square: width and height within 20% of each other
 * - Landscape: width > height * 1.2 (significantly wider than tall)
 */

import { useState, useEffect, useMemo } from 'react';
import { VIEWPORT_PRESETS, type ViewportConfig, type ViewportOrientation } from '@bendyline/squisq/doc';

interface UseViewportOrientationResult {
  /** Current viewport preset configuration */
  viewport: ViewportConfig;
  /** Current orientation name */
  orientation: ViewportOrientation;
  /** Current window dimensions */
  windowSize: { width: number; height: number };
}

/**
 * Determine viewport orientation from window dimensions.
 */
function getOrientationFromWindow(width: number, height: number): ViewportOrientation {
  const ratio = width / height;

  // Use thresholds to determine orientation
  // - Ratio > 1.2 = landscape (wider than tall)
  // - Ratio < 0.83 (1/1.2) = portrait (taller than wide)
  // - Otherwise = square-ish, use landscape for better readability
  if (ratio > 1.2) {
    return 'landscape';
  } else if (ratio < 0.83) {
    return 'portrait';
  } else {
    // Near-square viewports: use landscape for better text readability
    // Could also use 'square' preset if available and desired
    return 'landscape';
  }
}

/**
 * Get the appropriate viewport preset for an orientation.
 */
function getViewportForOrientation(orientation: ViewportOrientation): ViewportConfig {
  switch (orientation) {
    case 'portrait':
      return VIEWPORT_PRESETS.portrait;
    case 'square':
      return VIEWPORT_PRESETS.square;
    case 'landscape':
    default:
      return VIEWPORT_PRESETS.landscape;
  }
}

/**
 * Hook to detect viewport orientation and return appropriate preset.
 * Updates automatically when window is resized.
 */
export function useViewportOrientation(): UseViewportOrientationResult {
  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));

  // Listen for window resize
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    // Debounce resize handler to avoid excessive re-renders
    let timeoutId: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', debouncedResize);
    return () => {
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(timeoutId);
    };
  }, []);

  // Calculate orientation from window size
  const orientation = useMemo(
    () => getOrientationFromWindow(windowSize.width, windowSize.height),
    [windowSize.width, windowSize.height]
  );

  // Get appropriate viewport preset
  const viewport = useMemo(
    () => getViewportForOrientation(orientation),
    [orientation]
  );

  return {
    viewport,
    orientation,
    windowSize,
  };
}

export default useViewportOrientation;