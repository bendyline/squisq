/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import {
  buildNarrationScript,
  parseNarrationTimingJson,
  type NarrationAlignment,
} from '@bendyline/squisq/narration';
import {
  insertNarrationPreamble,
  narrationAnnotationLine,
} from '../teleprompter/recording/insertPreamble';
import { buildNarrationSavePlan } from '../teleprompter/recording/narrationSave';

describe('insertNarrationPreamble', () => {
  it('inserts at the top of a plain document', () => {
    const next = insertNarrationPreamble('# Title\n\nBody.\n', 'audio/narration-1.webm', null);
    expect(next.startsWith('{[audio src=audio/narration-1.webm anchor=document]}\n\n# Title')).toBe(
      true,
    );
  });

  it('inserts after the frontmatter fence', () => {
    const source = '---\ntitle: Doc\n---\n\n# Title\n\nBody.\n';
    const next = insertNarrationPreamble(source, 'audio/narration-1.webm', null);
    const lines = next.split('\n');
    expect(lines[2]).toBe('---');
    expect(next).toContain(
      '---\n\n{[audio src=audio/narration-1.webm anchor=document]}\n\n# Title',
    );
  });

  it('replaces a previous take (and its camera line) on retake', () => {
    const withTake = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'audio/narration-old.webm',
      'video/narration-cam-old.webm',
    );
    expect(withTake).toContain('narration-old');
    expect(withTake).toContain('<video src="video/narration-cam-old.webm"');

    const retaken = insertNarrationPreamble(withTake, 'audio/narration-new.webm', null);
    expect(retaken).not.toContain('narration-old');
    expect(retaken).not.toContain('narration-cam-old');
    expect(retaken).toContain('{[audio src=audio/narration-new.webm anchor=document]}');
    // No duplicate annotations.
    expect(retaken.match(/\{\[audio /g)?.length).toBe(1);
  });

  it('adds the camera companion as an inline video line', () => {
    const next = insertNarrationPreamble(
      '# Title\n\nBody.\n',
      'audio/narration-1.webm',
      'video/narration-cam-1.webm',
    );
    expect(next).toContain('{[audio src=audio/narration-1.webm anchor=document]}');
    expect(next).toContain('<video src="video/narration-cam-1.webm" controls width="240"></video>');
  });

  it('quotes srcs with spaces', () => {
    expect(narrationAnnotationLine('audio/my take.webm')).toBe(
      '{[audio src="audio/my take.webm" anchor=document]}',
    );
  });

  it('round-trips through markdownToDoc as documentMedia', () => {
    const next = insertNarrationPreamble(
      '---\ntitle: Doc\n---\n\n# Title\n\nBody.\n',
      'audio/narration-1.webm',
      null,
    );
    const doc = markdownToDoc(parseMarkdown(next));
    expect(doc.documentMedia?.length).toBe(1);
    expect(doc.documentMedia![0].src).toBe('audio/narration-1.webm');
    expect(doc.documentMedia![0].anchor).toBe('document');
  });
});

describe('buildNarrationSavePlan', () => {
  const script = buildNarrationScript(
    markdownToDoc(parseMarkdown('# One\n\nAlpha beta.\n\n# Two\n\nGamma delta.\n')),
  );
  const alignment: NarrationAlignment = {
    words: script.tokens.map((_, i) => ({ tokenIndex: i, tSec: i * 0.4, interpolated: false })),
    blocks: script.blocks.map((range, i) => ({
      blockId: range.blockId,
      blockIndex: i,
      charStart: range.charStart,
      charEnd: range.charEnd,
      startSec: i * 5,
      endSec: (i + 1) * 5,
    })),
    detectedSyllables: script.totalSyllables,
    cost: 0,
  };

  it('produces recorder-convention paths and a v3 sidecar the parser accepts', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: '.webm',
      baseWpm: 150,
      cameraOffsetSec: 0.02,
    });
    expect(plan.audioRelativeName).toMatch(/^audio\/narration-.*\.webm$/);
    expect(plan.cameraRelativeName).toMatch(/^video\/narration-cam.*\.webm$/);
    expect(plan.sidecarPathFor('audio/renamed.webm')).toBe('audio/renamed.webm.timing.json');

    const parsed = parseNarrationTimingJson(JSON.stringify(plan.sidecarPayload));
    expect(parsed).not.toBeNull();
    expect(parsed!.blocks.length).toBe(script.blocks.length);
    expect(parsed!.bookmarks.length).toBe(script.tokens.length);
    expect(parsed!.cameraOffsetSec).toBeCloseTo(0.02, 6);
  });

  it('degrades to an empty-timing sidecar when alignment failed', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment: null,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: null,
      baseWpm: 150,
    });
    expect(plan.cameraRelativeName).toBeNull();
    expect(plan.sidecarPayload.blocks).toEqual([]);
    expect(plan.sidecarPayload.bookmarks).toEqual([]);
    expect(plan.sidecarPayload.sourceText).toBe(script.sourceText);
  });

  it('nextMarkdown composes the preamble from one snapshot', () => {
    const plan = buildNarrationSavePlan({
      script,
      alignment,
      durationSec: 10,
      audioExt: '.webm',
      cameraExt: null,
      baseWpm: 150,
    });
    const next = plan.nextMarkdown('# One\n\nAlpha beta.\n', 'audio/narration-x.webm', null);
    expect(next).toContain('{[audio src=audio/narration-x.webm anchor=document]}');
  });
});
