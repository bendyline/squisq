/**
 * Deck review harness: one document as a whole dynamic-slides deck.
 *
 * `scripts/generate-deck-review.ts` serves documents under /deck-review-docs
 * and opens `?doc=<name>&theme=<id>[&density=…]`. The page builds the deck the
 * way the player does (dynamic-slides summarization → `buildPreviewDoc` →
 * `expandDocBlocks`), renders every slide as it settles, measures each frame,
 * and publishes the plan and metrics on `window.__SQUISQ_DECK_REVIEW__` for
 * the driver to screenshot and score.
 */
import { useEffect, useState } from 'react';
import { BlockRenderer } from '@bendyline/squisq-react';
import { parseMarkdown, setFrontmatterValues } from '@bendyline/squisq/markdown';
import { buildPreviewDoc, expandDocBlocks, markdownToDoc } from '@bendyline/squisq/doc';
import {
  DYNAMIC_PRESENTATION_STYLE,
  PRESENTATION_HINTS_KEY,
  createPresentationPlan,
  defaultPresentationHints,
  parsePresentationHints,
  serializePresentationHints,
  type PresentationHints,
} from '@bendyline/squisq/transform';
import { VIEWPORT_PRESETS, resolveTheme, type Block, type Theme } from '@bendyline/squisq/schemas';
import '@bendyline/squisq-react/styles';
import { measureFrame, type SwatchMetrics } from '../swatches/measure';

/** Frames render at two-thirds of the 1920×1080 viewport, so a slide is 1280×720. */
const CSS = { width: 1280, height: 720 };

export interface DeckReviewSlide {
  index: number;
  id: string;
  template: string;
  sourceBlockId?: string;
  layout?: string;
  headline?: string;
  points?: string[];
  media?: string[];
  metrics?: SwatchMetrics;
}

export interface DeckReviewState {
  ready: boolean;
  error?: string;
  doc?: string;
  theme?: string;
  density?: string;
  diagnostics?: string[];
  slides?: DeckReviewSlide[];
}

type ReviewWindow = Window & { __SQUISQ_DECK_REVIEW__?: DeckReviewState };

function query(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function publish(state: DeckReviewState): void {
  (window as ReviewWindow).__SQUISQ_DECK_REVIEW__ = state;
}

interface Deck {
  theme: Theme;
  blocks: Block[];
  slides: DeckReviewSlide[];
  diagnostics: string[];
  density: string;
}

async function buildDeck(name: string, themeId: string | null, density: string | null): Promise<Deck> {
  const response = await fetch(`/deck-review-docs/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Document "${name}" is not served (${response.status}).`);
  const markdown = await response.text();
  // An optional sidecar of hints (AI wording, layouts) stands in for the
  // designer's saved choices; otherwise the document's own or the defaults.
  const sidecar = await fetch(`/deck-review-docs/${encodeURIComponent(name)}.hints.json`);
  const parsed = markdownToDoc(parseMarkdown(markdown));
  let hints: PresentationHints =
    (sidecar.ok ? parsePresentationHints(await sidecar.json()) : null) ??
    parsePresentationHints(parsed.frontmatter?.[PRESENTATION_HINTS_KEY]) ??
    defaultPresentationHints();
  if (density) hints = { ...hints, density: density as PresentationHints['density'] };
  const theme = resolveTheme(themeId ?? String(parsed.frontmatter?.['squisq-theme'] ?? 'standard'));
  const doc = markdownToDoc(
    parseMarkdown(
      setFrontmatterValues(markdown, {
        'squisq-transform': DYNAMIC_PRESENTATION_STYLE,
        'squisq-theme': theme.id,
        [PRESENTATION_HINTS_KEY]: serializePresentationHints(hints),
      }),
    ),
  );
  // Reviews show slides as a reading estimate times them; a recorded take
  // needs its timing sidecar, which the harness does not have.
  delete doc.documentMedia;
  const plan = createPresentationPlan(doc, hints);
  const deck = buildPreviewDoc(doc);
  const viewport = VIEWPORT_PRESETS.landscape;
  const blocks = expandDocBlocks(deck.blocks, {
    theme,
    viewport,
    audioSegments: deck.audio.segments,
  });
  const slides = blocks.map((block, index): DeckReviewSlide => {
    const beat = plan.beats.find((item) => item.id === block.id);
    return {
      index,
      id: block.id,
      template: String((block as { template?: string }).template ?? ''),
      sourceBlockId: block.sourceBlockId,
      ...(beat
        ? { layout: beat.layout, headline: beat.headline, points: beat.points, media: beat.media }
        : {}),
    };
  });
  return {
    theme,
    blocks,
    slides,
    density: hints.density,
    diagnostics: (deck.diagnostics ?? []).map((item) => `${item.code}: ${item.message}`),
  };
}

const twoFrames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function waitForMermaid(deadlineMs: number): Promise<void> {
  const frames = Array.from(document.querySelectorAll('.block-layer--mermaid'));
  if (frames.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const settled = frames.every((f) => f.querySelector('svg') || f.querySelector('[data-error]'));
      if (settled || performance.now() - started > deadlineMs) resolve();
      else window.setTimeout(tick, 100);
    };
    tick();
  });
}

export function DeckReviewApp() {
  const name = query('doc');
  const themeId = query('theme');
  const density = query('density');
  /** Seconds into each slide to draw: late enough for every entrance to settle. */
  const at = Number(query('at') ?? '30');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      publish({ ready: true });
      return;
    }
    buildDeck(name, themeId, density).then(setDeck, (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      publish({ ready: true, error: message });
    });
  }, [name, themeId, density]);

  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    Promise.race([document.fonts.ready, new Promise((r) => window.setTimeout(r, 5000))])
      .then(() => waitForMermaid(8000))
      .then(twoFrames)
      .then(() => new Promise((resolve) => window.setTimeout(resolve, 150)))
      .then(twoFrames)
      .then(() => {
        if (cancelled) return;
        const viewport = VIEWPORT_PRESETS.landscape;
        const slides = deck.slides.map((slide) => {
          const frame = document.querySelector<HTMLElement>(
            `section.deck-slide[data-index="${slide.index}"]`,
          );
          return frame ? { ...slide, metrics: measureFrame(frame, viewport, []) } : slide;
        });
        publish({
          ready: true,
          doc: name ?? undefined,
          theme: deck.theme.id,
          density: deck.density,
          diagnostics: deck.diagnostics,
          slides,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [deck, name]);

  if (!name) return <p className="deck-label">Add ?doc=&lt;name&gt;&amp;theme=&lt;id&gt; to render.</p>;
  if (error) return <section className="deck-error">{error}</section>;
  if (!deck) return <p className="deck-label">Building {name}…</p>;
  return (
    <main className="deck-page">
      {deck.blocks.map((block, index) => (
        <div key={block.id}>
          <p className="deck-label">
            {index + 1}. {deck.slides[index]?.template}
            {deck.slides[index]?.layout ? ` · ${deck.slides[index]?.layout}` : ''}
          </p>
          <section
            className="deck-slide"
            data-index={index}
            style={{ width: CSS.width, height: CSS.height, background: deck.theme.colors.background }}
          >
            <BlockRenderer
              block={block}
              blockTime={Math.min(at, Math.max(0, block.duration - 0.05))}
              basePath="/"
              viewport={VIEWPORT_PRESETS.landscape}
              isPlaying={false}
              animationsEnabled={false}
              buildPlayback="all"
              theme={deck.theme}
            />
          </section>
        </div>
      ))}
    </main>
  );
}
