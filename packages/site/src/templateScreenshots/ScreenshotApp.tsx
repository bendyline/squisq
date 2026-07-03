import { useEffect, useMemo } from 'react';
import { BlockRenderer } from '@bendyline/squisq-react';
import { TEMPLATE_METADATA, expandDocBlocks, templateRegistry } from '@bendyline/squisq/doc';
import {
  VIEWPORT_PRESETS,
  buildGoogleFontsUrl,
  getThemeSummaries,
  resolveTheme,
  type Block,
} from '@bendyline/squisq/schemas';
import '@bendyline/squisq-react/styles';
import { TEMPLATE_SCREENSHOT_FIXTURES } from './templateSamples';

export const TEMPLATE_SCREENSHOT_CSS_SIZE = {
  width: 1280,
  height: 720,
} as const;

export const TEMPLATE_SCREENSHOT_VIEWPORT = VIEWPORT_PRESETS.landscape;

export interface TemplateScreenshotManifest {
  viewport: {
    width: number;
    height: number;
  };
  cssSize: {
    width: number;
    height: number;
  };
  themes: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  templates: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  missingFixtureIds: string[];
  extraFixtureIds: string[];
}

declare global {
  interface Window {
    __SQUISQ_TEMPLATE_SCREENSHOT__?: {
      ready: boolean;
      manifest: TemplateScreenshotManifest;
      error?: string;
    };
  }
}

const MANIFEST = buildManifest();

if (typeof window !== 'undefined') {
  window.__SQUISQ_TEMPLATE_SCREENSHOT__ = {
    ready: false,
    manifest: MANIFEST,
  };
}

function buildManifest(): TemplateScreenshotManifest {
  const templateIds = Object.keys(templateRegistry);
  const fixtureIds = Object.keys(TEMPLATE_SCREENSHOT_FIXTURES);
  const fixtureIdSet = new Set(fixtureIds);
  const templateIdSet = new Set(templateIds);

  return {
    viewport: {
      width: TEMPLATE_SCREENSHOT_VIEWPORT.width,
      height: TEMPLATE_SCREENSHOT_VIEWPORT.height,
    },
    cssSize: TEMPLATE_SCREENSHOT_CSS_SIZE,
    themes: getThemeSummaries(),
    templates: templateIds.map((id) => {
      const metadata = TEMPLATE_METADATA[id];
      return {
        id,
        label: metadata?.label ?? id,
        description: metadata?.description ?? 'No template metadata found.',
      };
    }),
    missingFixtureIds: templateIds.filter((id) => !fixtureIdSet.has(id)),
    extraFixtureIds: fixtureIds.filter((id) => !templateIdSet.has(id)),
  };
}

function getQueryParam(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function resolveExpandedBlock(
  templateId: string,
  themeId: string,
): { block?: Block; error?: string } {
  if (MANIFEST.missingFixtureIds.length > 0) {
    return {
      error: `Missing screenshot fixtures for templates: ${MANIFEST.missingFixtureIds.join(', ')}`,
    };
  }

  const fixture = TEMPLATE_SCREENSHOT_FIXTURES[templateId];
  if (!fixture) {
    return { error: `Unknown template fixture: ${templateId}` };
  }

  const theme = resolveTheme(themeId);
  const [block] = expandDocBlocks([fixture.block], {
    theme,
    viewport: TEMPLATE_SCREENSHOT_VIEWPORT,
  });

  if (!block) return { error: `Template did not expand: ${templateId}` };
  return { block };
}

export function ScreenshotApp() {
  const initialTemplateId = MANIFEST.templates[0]?.id ?? '';
  const initialThemeId = MANIFEST.themes[0]?.id ?? '';
  const templateId = getQueryParam('template', initialTemplateId);
  const themeId = getQueryParam('theme', initialThemeId);
  const theme = resolveTheme(themeId);

  const result = useMemo(() => resolveExpandedBlock(templateId, themeId), [templateId, themeId]);

  useEffect(() => {
    window.__SQUISQ_TEMPLATE_SCREENSHOT__ = {
      ready: false,
      manifest: MANIFEST,
      ...(result.error ? { error: result.error } : {}),
    };

    // Load the theme's web fonts before signaling readiness — otherwise
    // every screenshot renders fallback faces (e.g. Oswald → Impact) and
    // the review judges typography the player never actually ships.
    const fontsUrl = buildGoogleFontsUrl([
      theme.typography.titleFont,
      theme.typography.bodyFont,
      theme.typography.monoFont,
    ]);

    let timeout: number | undefined;
    let cancelled = false;

    const waitForStylesheet = (): Promise<void> => {
      if (!fontsUrl) return Promise.resolve();
      const existing = document.querySelector<HTMLLinkElement>(`link[href="${fontsUrl}"]`);
      if (existing?.dataset.loaded === 'true') return Promise.resolve();
      return new Promise((resolve) => {
        const link = existing ?? document.createElement('link');
        const done = () => {
          link.dataset.loaded = 'true';
          resolve();
        };
        link.addEventListener('load', done, { once: true });
        link.addEventListener('error', done, { once: true });
        // Don't hang the capture on a slow/offline font fetch.
        window.setTimeout(done, 3000);
        if (!existing) {
          link.rel = 'stylesheet';
          link.href = fontsUrl;
          document.head.appendChild(link);
        }
      });
    };

    // Two animation frames after the stylesheet applies so layout kicks
    // off the face fetches, then document.fonts.ready observes them.
    const twoFrames = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

    // fonts.ready has no built-in deadline; a slow face fetch late in a
    // 253-shot run can hang past the capture timeout. Cap it — a fallback
    // face in one shot beats a failed run.
    const fontsReadyWithDeadline = (): Promise<unknown> =>
      Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 5000)),
      ]);

    waitForStylesheet()
      .then(twoFrames)
      .then(fontsReadyWithDeadline)
      .then(() => {
        if (cancelled) return;
        timeout = window.setTimeout(() => {
          window.__SQUISQ_TEMPLATE_SCREENSHOT__ = {
            ready: true,
            manifest: MANIFEST,
            ...(result.error ? { error: result.error } : {}),
          };
        }, 75);
      });

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [result.error, templateId, themeId, theme]);

  if (result.error || !result.block) {
    return (
      <main className="template-screenshot-page">
        <section data-screenshot-error className="template-screenshot-error">
          {result.error ?? 'Unable to render template screenshot.'}
        </section>
      </main>
    );
  }

  return (
    <main className="template-screenshot-page">
      <section
        id="template-screenshot-frame"
        aria-label={`${theme.name} / ${templateId}`}
        style={{ background: theme.colors.background }}
      >
        <BlockRenderer
          block={result.block}
          blockTime={2}
          basePath="/"
          viewport={TEMPLATE_SCREENSHOT_VIEWPORT}
          isPlaying={false}
        />
      </section>
    </main>
  );
}
