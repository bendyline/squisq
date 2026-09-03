import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { ImageLayer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { transcriptBlock } from '../transcriptBlock.js';

const context = () => createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);

const base = {
  template: 'transcript' as const,
  id: 'beat-1',
  duration: 6,
  audioSegment: 0,
};

describe('transcriptBlock', () => {
  it('renders speaker name, bubble, and message; initials medallion without an avatar', () => {
    const layers = transcriptBlock(
      { ...base, speaker: 'Ada Lovelace', text: 'The payment module carries the risk.' },
      context(),
    );
    const ids = layers.map((layer) => layer.id);
    expect(ids).toContain('speaker-name');
    expect(ids).toContain('bubble');
    expect(ids).toContain('message');
    // No speakerImage → initials medallion, never a broken image.
    expect(ids).toContain('speaker-avatar-bg');
    const initials = layers.find(
      (layer): layer is TextLayer => layer.id === 'speaker-avatar-initials',
    );
    expect(initials?.content.text).toBe('AL');
    expect(layers.some((layer) => layer.type === 'image')).toBe(false);
  });

  it('uses the avatar image when provided', () => {
    const layers = transcriptBlock(
      { ...base, speaker: 'Ada', speakerImage: 'media/poppetje/ada.headshot.svg', text: 'Hello.' },
      context(),
    );
    const avatar = layers.find((layer): layer is ImageLayer => layer.id === 'speaker-avatar');
    expect(avatar?.content.src).toBe('media/poppetje/ada.headshot.svg');
  });

  it('thought variant renders muted italics; tool variant renders the mono chip + result', () => {
    const thought = transcriptBlock(
      { ...base, speaker: 'Ada', variant: 'thought', text: 'Considering the options…' },
      context(),
    );
    const thoughtMsg = thought.find((layer): layer is TextLayer => layer.id === 'message');
    expect(thoughtMsg?.content.style.fontStyle).toBe('italic');

    const tool = transcriptBlock(
      {
        ...base,
        speaker: 'Rex',
        variant: 'tool',
        toolName: 'read_file ×4',
        text: 'src/payment.js',
        resultText: '212 lines',
      },
      context(),
    );
    const chip = tool.find((layer): layer is TextLayer => layer.id === 'tool-name');
    expect(chip?.content.text).toBe('read_file ×4');
    const result = tool.find((layer): layer is TextLayer => layer.id === 'tool-result');
    expect(result?.content.text).toBe('212 lines');
  });

  it('counterpartName switches to the two-avatar handoff form with an arrow', () => {
    const layers = transcriptBlock(
      {
        ...base,
        speaker: 'Ada',
        counterpartName: 'Rex',
        text: 'Please review src/ carefully.',
        meta: 't+45s',
      },
      context(),
    );
    const ids = layers.map((layer) => layer.id);
    expect(ids).toContain('speaker-avatar-bg');
    expect(ids).toContain('counterpart-avatar-bg');
    expect(ids).toContain('handoff-arrow');
    expect(ids).toContain('message');
    const meta = layers.find((layer): layer is TextLayer => layer.id === 'meta');
    expect(meta?.content.text).toBe('t+45s');
  });

  it('sizes the bubble taller for longer text', () => {
    const short = transcriptBlock({ ...base, speaker: 'A', text: 'ok' }, context());
    const long = transcriptBlock(
      { ...base, speaker: 'A', text: 'word '.repeat(120).trim() },
      context(),
    );
    const heightOf = (layers: ReturnType<typeof transcriptBlock>) =>
      parseFloat(String(layers.find((layer) => layer.id === 'bubble')?.position.height));
    expect(heightOf(long)).toBeGreaterThan(heightOf(short));
  });
});
