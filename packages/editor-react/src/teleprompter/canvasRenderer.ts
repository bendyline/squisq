/**
 * Canvas renderer for the video-PiP tier.
 *
 * Safari has no Document Picture-in-Picture, so the float there is a
 * `<canvas>.captureStream()` piped into a `<video>` in PiP. No script
 * runs in that window — the main window draws this read-only rendition
 * of the prompter on analysis ticks (never rAF, which throttles when
 * the browser is occluded).
 */

import type { NarrationScript } from '@bendyline/squisq/narration';

export interface CanvasPrompterFrame {
  script: NarrationScript;
  /** Fractional word position (floor = active token). */
  wordPos: number;
  fontSizePx: number;
  mirrored: boolean;
  colors: { bg: string; text: string; accent: string; muted: string };
  countdownRemaining: number | null;
  recording: boolean;
}

interface LayoutCache {
  key: string;
  /** Line index of each token. */
  tokenLine: number[];
  /** Tokens per line, in order. */
  lines: number[][];
}

let layoutCache: LayoutCache | null = null;

/** Nearest spoken token at or before `idx` (falling forward for leading punctuation). */
function nearestSpoken(tokens: NarrationScript['tokens'], idx: number): number {
  for (let i = idx; i >= 0; i--) {
    if (tokens[i].spoken) return i;
  }
  for (let i = idx + 1; i < tokens.length; i++) {
    if (tokens[i].spoken) return i;
  }
  return idx;
}

/** Wrap script tokens into lines for a given canvas width/font (cached). */
function layoutTokens(
  ctx: CanvasRenderingContext2D,
  script: NarrationScript,
  fontPx: number,
  maxWidth: number,
): LayoutCache {
  const key = `${script.tokens.length}:${script.sourceText.length}:${fontPx}:${maxWidth}`;
  if (layoutCache && layoutCache.key === key) return layoutCache;
  const spaceW = ctx.measureText(' ').width;
  const tokenLine = new Array<number>(script.tokens.length);
  const lines: number[][] = [];
  let current: number[] = [];
  let x = 0;
  for (let i = 0; i < script.tokens.length; i++) {
    const token = script.tokens[i];
    const w = ctx.measureText(token.text).width;
    const startsBlock = i === 0 || script.tokens[i - 1].blockIndex !== token.blockIndex;
    const startsPara = i > 0 && script.tokens[i - 1].pauseAfter >= 2;
    if (current.length > 0 && (x + w > maxWidth || startsBlock || startsPara)) {
      lines.push(current);
      current = [];
      x = 0;
    }
    tokenLine[i] = lines.length;
    current.push(i);
    x += w + spaceW;
  }
  if (current.length > 0) lines.push(current);
  layoutCache = { key, tokenLine, lines };
  return layoutCache;
}

/** Draw one prompter frame. Cheap enough to run at analysis-tick rate. */
export function drawPrompterFrame(canvas: HTMLCanvasElement, frame: CanvasPrompterFrame): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  const fontPx = Math.round(frame.fontSizePx * 0.72);
  const lineH = Math.round(fontPx * 1.4);
  const marginX = Math.round(width * 0.06);

  ctx.save();
  ctx.fillStyle = frame.colors.bg;
  ctx.fillRect(0, 0, width, height);
  if (frame.mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.font = `500 ${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  const layout = layoutTokens(ctx, frame.script, fontPx, width - marginX * 2);
  const count = frame.script.tokens.length;
  if (count > 0) {
    const rawActive = Math.min(Math.max(Math.floor(frame.wordPos), 0), count - 1);
    const frac = Math.min(Math.max(frame.wordPos - rawActive, 0), 1);
    // Keep the highlight off standalone punctuation (em-dashes, bullets).
    const active = nearestSpoken(frame.script.tokens, rawActive);
    const activeLine = layout.tokenLine[active] ?? 0;
    const eyeY = height * 0.38;
    const spaceW = ctx.measureText(' ').width;
    const scrollY = (activeLine + frac) * lineH - eyeY;

    const firstLine = Math.max(0, Math.floor(scrollY / lineH) - 1);
    const lastLine = Math.min(layout.lines.length - 1, Math.ceil((scrollY + height) / lineH) + 1);
    for (let line = firstLine; line <= lastLine; line++) {
      const y = line * lineH - scrollY;
      let x = marginX;
      for (const tokenIdx of layout.lines[line]) {
        const token = frame.script.tokens[tokenIdx];
        if (tokenIdx === active) {
          ctx.fillStyle = frame.colors.accent;
          ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
        } else {
          ctx.fillStyle = frame.colors.text;
          ctx.font = `500 ${fontPx}px system-ui, sans-serif`;
          ctx.globalAlpha = tokenIdx < active ? 0.9 : 0.45;
        }
        ctx.fillText(token.text, x, y);
        ctx.globalAlpha = 1;
        x += ctx.measureText(token.text).width + spaceW;
      }
    }

    // Eye-line chevron.
    ctx.fillStyle = frame.colors.accent;
    ctx.beginPath();
    ctx.moveTo(4, eyeY + lineH * 0.2);
    ctx.lineTo(14, eyeY + lineH * 0.5);
    ctx.lineTo(4, eyeY + lineH * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Overlays draw unmirrored so they stay readable.
  if (frame.countdownRemaining !== null) {
    ctx.save();
    ctx.fillStyle = `${frame.colors.bg}cc`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = frame.colors.accent;
    ctx.font = `800 ${Math.round(height * 0.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(frame.countdownRemaining), width / 2, height / 2);
    ctx.restore();
  }
  if (frame.recording) {
    ctx.save();
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.arc(width - 20, 20, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
