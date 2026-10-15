import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { docToMarkdown } from '../doc/docToMarkdown.js';
import { buildPreviewDoc } from '../doc/buildPreviewDoc.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { materializeBlockLayers } from '../doc/materializeBlockLayers.js';
import {
  blockBuildSteps,
  buildCursorAtTime,
  buildSourceText,
  buildTargetState,
  planContentBuilds,
  resolveBuildTimeline,
  resolveDocBuildTiming,
} from '../doc/builds.js';
import { coerceAnnotationValues } from '../markdown/annotationCoercion.js';
import { buildNarrationScript } from '../narration/script.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';
import { recordBuildAdvance } from '../schemas/Build.js';
import { parseNarrationTimingJson } from '../narration/sidecar.js';
import { buildAdvanceTimingJson } from '../narration/advanceTiming.js';
import { applyNarrationTiming } from '../doc/applyNarrationTiming.js';
import { MemoryContentContainer } from '../storage/ContentContainer.js';
import {
  defaultPresentationHints,
  parsePresentationHints,
} from '../transform/presentationHints.js';
import { compilePresentationPlan } from '../transform/presentationCompiler.js';

const body =
  '- Discover\n  - **Interview** customers\n  - Review data\n- Deliver\n  - Prototype\n  - Test';
const source = (mode = 'items', template = 'list') =>
  `## Approach {[${template} build=${mode} buildEffect=fadeInUp]}\n\n${body}\n`;
function fixture(mode = 'items', template = 'list') {
  const doc = markdownToDoc(parseMarkdown(source(mode, template)));
  const preview = buildPreviewDoc(doc, { interleaveImages: false });
  const blocks = expandDocBlocks(preview.blocks as DocBlock[]);
  return { doc, preview, blocks, block: blocks[0]! };
}

describe('progressive builds', () => {
  it.each(['list', 'content'])('preserves hierarchy, rich text and source on %s', (template) => {
    const { doc, block } = fixture('items', template);
    const steps = blockBuildSteps(block);
    expect(steps.map((step) => step.text)).toEqual([
      'Discover',
      'Interview customers',
      'Review data',
      'Deliver',
      'Prototype',
      'Test',
    ]);
    expect(steps[1]?.ancestors).toEqual([0]);
    const text = block.layers?.find((layer) => layer.type === 'text' && layer.content.buildSteps);
    expect(text?.type === 'text' && text.content.html).toContain('<strong>Interview</strong>');
    expect(stringifyMarkdown(docToMarkdown(doc))).toBe(source('items', template));
  });

  it('reveals every descendant with its branch, without wrapping child targets in parent targets', () => {
    const { block } = fixture('branches');
    const steps = blockBuildSteps(block);
    expect(steps).toHaveLength(2);
    expect(buildSourceText(steps)).not.toBe(
      buildSourceText(blockBuildSteps(fixture('items').block)),
    );
    expect(steps[0]?.text).toContain('Review data');
    const html = block.layers
      ?.flatMap((layer) => (layer.type === 'text' ? [layer.content.html ?? ''] : []))
      .join('');
    expect(html?.match(/data-squisq-build-step="0"/g)).toHaveLength(3);
  });

  it('supports ordered starts, task markers, multiple paragraphs and independent lists', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '## Tasks {[content build=items]}\n\n4. First\n5. Second\n\nParagraph\n\n- [x] Finished\n- [ ] Pending\n',
      ),
    );
    const block = doc.blocks[0]!;
    const layers = materializeBlockLayers(block).layers;
    const html = layers
      .flatMap((layer) => (layer.type === 'text' ? [layer.content.html ?? ''] : []))
      .join('');
    expect(html).toContain('>4.</span>');
    expect(html).toContain('>[x]</span>');
    expect(html).toContain('<p>Paragraph</p>');
    expect(blockBuildSteps({ build: block.build, layers })).toHaveLength(4);
  });

  it('chunks top-level paragraphs and lists once', () => {
    const doc = markdownToDoc(
      parseMarkdown('## Chunks {[content build=chunks]}\n\nIntro\n\n- A\n  - B\n\nOutro\n'),
    );
    const plan = planContentBuilds(doc.blocks[0]!.contents!, { mode: 'chunks' });
    expect(plan.steps.map((step) => step.text)).toEqual(['Intro', 'A\nB', 'Outro']);
    expect(plan.targets.size).toBe(3);
  });

  it('keeps continuation prose after its nested list while revealing it with its parent', () => {
    const doc = markdownToDoc(
      parseMarkdown('## H {[content build=items]}\n\n- Parent\n\n  - Child\n\n  Continuation\n'),
    );
    const layers = materializeBlockLayers(doc.blocks[0]!).layers;
    const html = layers
      .flatMap((layer) => (layer.type === 'text' ? [layer.content.html ?? ''] : []))
      .join('');
    expect(html.indexOf('Parent')).toBeLessThan(html.indexOf('Child'));
    expect(html.indexOf('Child')).toBeLessThan(html.indexOf('Continuation'));
    expect(html.match(/data-squisq-build-step="0"/g)).toHaveLength(2);
  });

  it('reconciles programmatic build edits and removal through both Markdown and AST', () => {
    const { doc } = fixture();
    doc.blocks[0]!.build = { mode: 'branches', duration: 0.25 };
    const md = docToMarkdown(doc);
    expect(markdownToDoc(md).blocks[0]!.build).toEqual(doc.blocks[0]!.build);
    const written = stringifyMarkdown(md);
    expect(written).toContain('build=branches');
    expect(written).not.toContain('buildEffect');
    delete doc.blocks[0]!.build;
    expect(stringifyMarkdown(docToMarkdown(doc))).not.toContain('build=');
  });

  it.each([
    '## H {build=branches buildDuration=400ms}\n\n- A\n- B\n',
    '## H\n\n- A\n- B\n\n{[list build=branches]}\n',
    '{[list build=items]}\n\n- A\n- B\n',
  ])('preserves alternate authoring forms', (markdown) => {
    const doc = markdownToDoc(parseMarkdown(markdown));
    expect(flattenRenderableBlocks(doc.blocks).some((block) => block.build)).toBe(true);
    expect(stringifyMarkdown(docToMarkdown(doc))).toBe(markdown);
  });

  it('keeps legacy output unchanged when no build is authored', () => {
    const doc = markdownToDoc(parseMarkdown(`## H {[list]}\n\n${body}\n`));
    const layers = materializeBlockLayers(doc.blocks[0]!).layers;
    expect(layers.some((layer) => layer.id === 'item-0')).toBe(true);
    expect(blockBuildSteps({ layers })).toEqual([]);
  });

  it('retains an authored accent image when a list builds', () => {
    const block: DocBlock = {
      template: 'list',
      id: 'accent',
      duration: 10,
      audioSegment: 0,
      title: 'Approach',
      items: ['Discover', 'Deliver'],
      build: { mode: 'items' },
      accentImage: { src: 'accent.jpg', alt: 'Accent', position: 'left-strip' },
    };
    const layers = materializeBlockLayers(block).layers;
    expect(
      layers.some((layer) => layer.type === 'image' && layer.content.src === 'accent.jpg'),
    ).toBe(true);
    expect(blockBuildSteps({ build: block.build, layers })).toHaveLength(2);
  });

  it('never splits or merges away build slides during audio pacing', () => {
    const { preview } = fixture();
    const blocks = expandDocBlocks(preview.blocks as DocBlock[], {
      audioSegments: [{ startTime: 0, duration: 60 }],
    });
    expect(blocks).toHaveLength(1);
    expect(blockBuildSteps(blocks[0]!)).toHaveLength(6);
  });

  it('evaluates arbitrary times deterministically and completes even a very short slide', () => {
    const { block } = fixture();
    const steps = blockBuildSteps(block);
    const timeline = resolveBuildTimeline(steps, block.build!, 0.15);
    expect(timeline.compressed).toBe(true);
    expect(buildCursorAtTime(timeline, 0)).toEqual({ revealed: 0, progress: 0 });
    const end = buildCursorAtTime(timeline, 0.149);
    expect(end).toEqual({ revealed: 6, progress: 1 });
    expect(
      buildTargetState(0, steps, { revealed: 2, progress: 0.5 }, { mode: 'items', previous: 'dim' })
        .opacity,
    ).toBe(1);
    expect(
      buildTargetState(1, steps, { revealed: 2, progress: 0 }, { mode: 'items' }, false).opacity,
    ).toBe(1);
  });

  it('aligns exact narration passages and discards stale timing', () => {
    const { doc } = fixture();
    const script = buildNarrationScript(doc);
    const narrated = {
      ...doc,
      presentationNarration: {
        sourceText: script.sourceText,
        src: 'take.wav',
        startTime: 0,
        duration: 30,
        bookmarks: script.tokens.map((token, i) => ({
          id: `w-${i}`,
          time: i * 1.5,
          charOffset: token.charOffset,
          textFragment: token.text,
        })),
      },
    };
    const preview = buildPreviewDoc(narrated, { interleaveImages: false });
    const expanded = expandDocBlocks(preview.blocks as DocBlock[]);
    const aligned = resolveDocBuildTiming(preview, expanded)[0]!;
    expect(aligned.buildTiming?.sourceText).toBe(buildSourceText(blockBuildSteps(aligned)));
    expect(aligned.buildTiming?.starts[0]).toBe(1.5);
    expect(
      resolveDocBuildTiming({ ...preview, buildSourceText: 'changed' }, expanded)[0]?.buildTiming,
    ).toBeUndefined();
  });

  it('validates malformed settings without losing their raw source', () => {
    const result = coerceAnnotationValues({
      build: 'items',
      buildEffect: 'explode',
      buildDuration: '-1',
    });
    expect(result.blockMeta.build).toEqual({ mode: 'items' });
    expect(result.warnings).toHaveLength(2);
    expect(coerceAnnotationValues({ build: 'nonsense' }).blockMeta.build).toBeUndefined();
  });

  it('carries build hints onto generated slides without saving generated timing', () => {
    const { doc } = fixture();
    const script = buildNarrationScript(doc);
    const hints = {
      ...defaultPresentationHints(),
      blocks: [{ blockId: doc.blocks[0]!.id, build: { mode: 'branches' as const } }],
    };
    expect(parsePresentationHints(hints)).toEqual(hints);
    expect(
      parsePresentationHints({ ...hints, blocks: [{ blockId: 'x', build: { mode: 'wrong' } }] }),
    ).toBeNull();
    const generated = compilePresentationPlan(
      { ...doc, frontmatter: { 'squisq-presentation-hints': hints } },
      {
        version: 1,
        origin: 'automatic',
        sourceText: script.sourceText,
        beats: [
          {
            id: 'generated',
            sourceStart: 0,
            sourceEnd: script.sourceText.length,
            layout: 'list',
            headline: 'Approach',
            points: ['Discover', 'Deliver'],
          },
        ],
      },
    );
    const slide = expandDocBlocks(generated.blocks as DocBlock[])[0]!;
    expect(slide.build?.mode).toBe('branches');
    expect(blockBuildSteps(slide)).toHaveLength(2);
    expect(doc.blocks[0]?.build?.mode).toBe('items');
  });

  it('round-trips recorded builds through the sidecar and maps trimmed take time', async () => {
    const { doc, block } = fixture('branches');
    const text = buildSourceText(blockBuildSteps(block));
    const event = { blockId: doc.blocks[0]!.id, sourceText: text, step: 0, time: 3 };
    const once = recordBuildAdvance([], event);
    expect(recordBuildAdvance(once, { ...event, time: 9 })).toBe(once);
    const builds = recordBuildAdvance(once, { ...event, step: 1, time: 8 });
    const timing = {
      ...buildAdvanceTimingJson(doc, [{ blockId: event.blockId, atMs: 0 }], 12),
      builds,
    };
    const parsed = parseNarrationTimingJson(JSON.stringify(timing));
    expect(parsed?.builds).toEqual(builds);
    const container = new MemoryContentContainer();
    await container.writeFile(
      'take.wav.timing.json',
      new TextEncoder().encode(JSON.stringify(timing)).buffer,
      'application/json',
    );
    const resolved = await applyNarrationTiming(
      {
        ...doc,
        documentMedia: [
          {
            id: 'take',
            kind: 'audio',
            anchor: 'document',
            src: 'take.wav',
            startAt: 0,
            clipStart: 2,
            clipEnd: 12,
          },
        ],
      },
      container,
    );
    const preview = buildPreviewDoc(resolved.doc, { interleaveImages: false });
    const expanded = expandDocBlocks(preview.blocks as DocBlock[]);
    const aligned = resolveDocBuildTiming(preview, expanded)[0]!;
    expect(aligned.buildTiming?.starts).toEqual([1, 6]);
    const changed = {
      ...preview,
      presentationNarration: {
        ...preview.presentationNarration!,
        builds: builds.map((build) => ({ ...build, sourceText: 'old content' })),
      },
    };
    expect(resolveDocBuildTiming(changed, expanded)[0]!.buildTiming).toBeUndefined();
  });
});
