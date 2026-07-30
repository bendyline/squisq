/**
 * Shared render context for page section components — theme, resolved
 * page style, media base path, and the SVG materialization options canvas
 * embeds need. Provided by `LinearDocView`, consumed by every section.
 */

import { createContext, useContext } from 'react';
import type { Theme, ThemePageStyle, ViewportConfig } from '@bendyline/squisq/schemas';
import type { MaterializeBlockLayersOptions } from '@bendyline/squisq/doc';
import { DEFAULT_THEME, resolvePageStyle } from '@bendyline/squisq/doc';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import type { ImageDisplayMode } from '../LinearDocView';
import type { CodeBlockCopyHandler } from '../MarkdownRenderer';

export interface PageViewContextValue {
  theme: Theme;
  pageStyle: ThemePageStyle;
  basePath: string;
  viewport: ViewportConfig;
  /** Options for `materializeBlockLayers` inside canvas embeds. */
  renderContext: MaterializeBlockLayersOptions;
  animationsEnabled: boolean;
  imageDisplayMode: ImageDisplayMode;
  showCodeCopyButton: boolean;
  onCopyCode?: CodeBlockCopyHandler;
}

const defaultValue: PageViewContextValue = {
  theme: DEFAULT_THEME,
  pageStyle: resolvePageStyle(DEFAULT_THEME),
  basePath: '/',
  viewport: VIEWPORT_PRESETS.landscape,
  renderContext: { theme: DEFAULT_THEME },
  animationsEnabled: true,
  imageDisplayMode: 'inline',
  showCodeCopyButton: false,
};

export const PageViewContext = createContext<PageViewContextValue>(defaultValue);

export function usePageView(): PageViewContextValue {
  return useContext(PageViewContext);
}
