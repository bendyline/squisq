import { describe, expect, it } from 'vitest';
import { parseMarkdown, setFrontmatterValues } from '../markdown/index.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { resolveAudioMapping } from '../doc/audioMapping.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { buildNarrationScript } from '../narration/script.js';
import { MemoryContentContainer } from '../storage/ContentContainer.js';
import { applyTransform } from '../transform/applyTransform.js';
import { createPresentationPlan } from '../transform/presentationPlanner.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';
import {
  parsePresentationPlan,
  serializePresentationPlan,
  PRESENTATION_KEY,
} from '../transform/presentationPlan.js';

const source =
  '# Start with an idea\n\nWrite a few bullet points. Build a document with a clear story.\n\n## Make it visual\n\nFirst organize your points. Then add diagrams. Finally share your presentation.\n\n## Keep your voice\n\nNarration runs locally. Turn the same document into a narrated video.';
const parse = (text = source) => markdownToDoc(parseMarkdown(text));
async function narrated(text = source, times = [0, 20, 40, 60]) {
  const md = `{[audio src=audio/take.webm anchor=document]}\n\n${text}`;
  const doc = parse(md);
  const script = buildNarrationScript(doc);
  const container = new MemoryContentContainer();
  await container.writeFile('audio/take.webm', new Uint8Array([1]), 'audio/webm');
  await container.writeFile(
    'audio/take.webm.timing.json',
    new TextEncoder().encode(
      JSON.stringify({
        version: 3,
        sourceText: script.sourceText,
        duration: times[times.length - 1],
        blocks: script.blocks.map((block, index) => ({
          ...block,
          blockIndex: index,
          startSec: times[index],
          endSec: times[index + 1],
        })),
        bookmarks: script.tokens.map((token, index) => ({
          id: `word-${index}`,
          charOffset: token.charOffset,
          time:
            times[token.blockIndex]! + (index - script.blocks[token.blockIndex]!.tokenStart) * 0.2,
        })),
      }),
    ),
    'application/json',
  );
  return { doc: await resolveAudioMapping(doc, container), md, container };
}
describe('source-preserving presentations', () => {
  it('uses deterministic visual plans and retains parent prose and all source ranges', () => {
    const doc = parse();
    const plan = createPresentationPlan(doc);
    expect(plan).toEqual(createPresentationPlan(doc));
    expect(parsePresentationPlan(plan)).toEqual(plan);
    expect(plan.beats).toHaveLength(3);
    expect(plan.beats[1].layout).toBe('steps');
    expect(plan.sourceText.slice(plan.beats[0].sourceStart, plan.beats[0].sourceEnd)).toContain(
      'bullet points',
    );
    const before = JSON.stringify(doc);
    compilePresentationPlan(doc, plan);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('round-trips through Markdown and does not regenerate or change the script', () => {
    const plan = createPresentationPlan(parse());
    const reopened = parse(
      setFrontmatterValues(source, { [PRESENTATION_KEY]: serializePresentationPlan(plan) }),
    );
    expect(parsePresentationPlan(reopened.frontmatter?.[PRESENTATION_KEY])).toEqual(plan);
    expect(buildNarrationScript(reopened).sourceText).toBe(plan.sourceText);
    expect(buildPreviewDoc(reopened).blocks).toHaveLength(plan.beats.length);
  });
  it('fits every visual to exact word cues and never merges short beats or splits long ones', async () => {
    const { doc } = await narrated(source, [0, 1.5, 40, 60]);
    const plan = createPresentationPlan(doc);
    const projected = buildPreviewDoc({
      ...doc,
      frontmatter: { [PRESENTATION_KEY]: serializePresentationPlan(plan) },
    });
    expect(projected.duration).toBe(60);
    expect(projected.frontmatter?.['squisq-cover-slide']).toBe(false);
    expect(projected.blocks.map((block) => block.startTime)).toEqual([0, 1.5, 40]);
    expect(projected.documentMedia).toEqual(doc.documentMedia);
    const expanded = expandDocBlocks(projected.blocks, { audioSegments: projected.audio.segments });
    expect(expanded.map((block) => [block.startTime, block.duration])).toEqual([
      [0, 1.5],
      [1.5, 38.5],
      [40, 20],
    ]);
    const diagramBackground = expanded[1]!.layers?.[0];
    expect(diagramBackground?.id).toBe('diagram-bg');
    expect(diagramBackground?.position).toMatchObject({ width: '100%', height: '100%' });
    for (const style of ['minimal', 'documentary', 'narrative', 'magazine']) {
      const throughStyle = buildPreviewDoc(
        applyTransform({ ...doc, frontmatter: projected.frontmatter }, style).doc,
      );
      expect(
        throughStyle.blocks.map((block) => [block.id, block.startTime, block.duration]),
      ).toEqual(projected.blocks.map((block) => [block.id, block.startTime, block.duration]));
    }
  });
  it('refuses stale source, stale takes, missing timings, pins, and invented assets', async () => {
    const { doc } = await narrated();
    const plan = createPresentationPlan(doc);
    expect(() => compilePresentationPlan(parse(source + '\n\nChanged.'), plan)).toThrow(
      'text has changed',
    );
    expect(() =>
      compilePresentationPlan(
        {
          ...doc,
          presentationNarration: { ...doc.presentationNarration!, sourceText: 'old take' },
        },
        plan,
      ),
    ).toThrow('narration no longer matches');
    expect(() =>
      compilePresentationPlan({ ...doc, presentationNarration: undefined }, plan),
    ).toThrow('timings are unavailable');
    const pinned = await narrated(
      source.replace('## Make it visual', '## Make it visual {[duration=3]}'),
    );
    expect(() => compilePresentationPlan(pinned.doc, plan)).toThrow('manually pinned');
    const invented = {
      ...plan,
      beats: plan.beats.map((beat, i) =>
        i ? beat : { ...beat, layout: 'image', imageSrc: 'file:///secrets.png' },
      ),
    };
    expect(parsePresentationPlan(invented)).not.toBeNull();
    expect(() => compilePresentationPlan(doc, parsePresentationPlan(invented)!)).toThrow(
      'image is no longer',
    );
    const invalid = buildPreviewDoc({ ...doc, frontmatter: { [PRESENTATION_KEY]: '{}' } });
    expect(invalid.diagnostics?.some((item) => item.code === 'presentation-invalid')).toBe(true);
  });
  it('rejects unknown fields, gaps, overlaps, malformed shapes and oversized input', () => {
    const plan = createPresentationPlan(parse());
    for (const value of [
      { ...plan, seconds: 10 },
      { ...plan, version: 2 },
      { ...plan, sourceText: 'x'.repeat(40001) },
      { ...plan, beats: [] },
      { ...plan, beats: [{ ...plan.beats[0], sourceStart: 2 }, ...plan.beats.slice(1)] },
      { ...plan, beats: [{ ...plan.beats[0], layout: 'script' }, ...plan.beats.slice(1)] },
      { ...plan, beats: [{ ...plan.beats[0], points: [null] }, ...plan.beats.slice(1)] },
    ])
      expect(parsePresentationPlan(value)).toBeNull();
  });
  it('re-resolves saved plans after a retake instead of keeping old second values', async () => {
    const first = await narrated();
    const plan = createPresentationPlan(first.doc);
    const next = await narrated(source, [0, 10, 25, 35]);
    const resolved = compilePresentationPlan(next.doc, plan);
    expect(resolved.duration).toBe(35);
    expect(resolved.blocks.map((block) => block.startTime)).toEqual([0, 10, 25]);
  });
});
