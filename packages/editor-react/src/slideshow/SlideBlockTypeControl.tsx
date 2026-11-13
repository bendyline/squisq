/**
 * SlideBlockTypeControl
 *
 * The Slideshow toolbar's block-type picker: names the template of the slide
 * on screen and, for a section written under a heading, retypes it by
 * rewriting that heading's `{[template]}` annotation.
 */

import { useCallback, useMemo } from 'react';
import type { Block, Doc, Theme, ViewportConfig } from '@bendyline/squisq/schemas';
import { flattenBlocks, previewBlockTemplate } from '@bendyline/squisq/doc';
import { profileBlockContents, recommendTemplatesForBlock } from '@bendyline/squisq/recommend';
import { findBlockSliceAtLineInDoc } from '../blockSlice';
import { useEditorContext } from '../EditorContext';
import { setSourceHeadingTemplate } from '../headingTemplateLine';
import { TemplatePicker, TEMPLATE_NAMES, templateLabel } from '../TemplatePicker';
import { sourceBlockIdOf, useActiveSlide, type ActiveSlide } from './ActiveSlide';

/** What the block-type picker shows for the slide on screen. */
type SlideBlockType =
  | {
      /** The slide is a section of the document, written under a heading. */
      editable: true;
      block: Block;
      /** 1-based source line of the section's heading. */
      headingLine: number;
      /** The template the section's slide is built from. */
      template: string;
    }
  | {
      editable: false;
      /** Template to show greyed out, when the slide has one worth naming. */
      template: string;
      /** Replaces the template's label (the cover is not a block type). */
      label?: string;
      /** Why the type cannot be changed here — the trigger's tooltip. */
      reason: string;
    };

/**
 * Resolve the slide on screen back to the document section it shows. Only a
 * section written under a heading has a type to set from here: the type lives
 * in that heading's `{[…]}` annotation.
 */
function resolveSlideBlockType(doc: Doc | null, slide: ActiveSlide | null): SlideBlockType {
  if (!doc || !slide) {
    return { editable: false, template: '', label: '—', reason: 'No slide is showing yet.' };
  }
  const shown = slide.template ?? '';
  if (slide.isCover) {
    return {
      editable: false,
      template: '',
      label: 'Cover',
      reason: 'This is the cover slide. Change how it looks from the Cover slide menu.',
    };
  }
  if (slide.generated) {
    return {
      editable: false,
      template: shown,
      reason:
        'Summarize builds these slides from your document, so their layout is chosen for you. Set Summarize to None to choose block types yourself.',
    };
  }
  const blockId = slide.blockId;
  const flat = blockId ? flattenBlocks(doc.blocks) : [];
  const block =
    flat.find((candidate) => candidate.id === blockId) ??
    flat.find((candidate) => blockId != null && candidate.id === sourceBlockIdOf(blockId));
  if (!block) {
    return {
      editable: false,
      template: shown,
      reason: 'This slide was added for a picture in your document. It has no block type.',
    };
  }
  const template = previewBlockTemplate(block, doc);
  const headingLine = block.sourceHeading?.position?.start.line;
  if (headingLine == null) {
    return {
      editable: false,
      template,
      reason:
        'This slide’s content has no heading of its own, so its block type can only be changed in Write.',
    };
  }
  if (block.promotedBodyAnnotation) {
    return {
      editable: false,
      template,
      reason:
        'This slide’s block type is written inside its text, so it can only be changed in Write.',
    };
  }
  return { editable: true, block, headingLine, template };
}

/**
 * "Block: <type> ▾" — changes the block type of the section the Slideshow is
 * showing, so retyping a slide no longer means a trip to Write and back. It
 * opens the same gallery as Write's block picker and writes the same
 * `{[template]}` heading annotation, as one edit to the document source.
 *
 * `activeTheme` / `activeViewport` are the preview settings' own, passed in
 * so this module does not import `PreviewControls` (which renders it).
 */
export function SlideBlockTypeControl({
  compact,
  activeTheme,
  activeViewport,
}: {
  compact: boolean;
  activeTheme: Theme;
  activeViewport: ViewportConfig;
}) {
  const slide = useActiveSlide();
  const { colorScheme, doc, markdownDoc, markdownSource, setMarkdownSource, mediaProvider } =
    useEditorContext();
  const state = useMemo(() => resolveSlideBlockType(doc, slide), [doc, slide]);
  const block = state.editable ? state.block : null;
  const headingLine = state.editable ? state.headingLine : null;

  const recommended = useMemo(() => {
    if (headingLine === null || !markdownDoc) return undefined;
    const slice = findBlockSliceAtLineInDoc(markdownDoc, headingLine);
    if (slice === null) return undefined;
    return recommendTemplatesForBlock(profileBlockContents(slice), TEMPLATE_NAMES).recommended;
  }, [headingLine, markdownDoc]);

  const previewSource = useMemo(
    () =>
      block
        ? {
            block,
            theme: activeTheme,
            viewport: activeViewport,
            basePath: '/',
            mediaProvider,
            customTemplates: doc?.customTemplates,
          }
        : undefined,
    [activeTheme, activeViewport, block, doc?.customTemplates, mediaProvider],
  );

  const handleChange = useCallback(
    (template: string) => {
      if (headingLine === null) return;
      // Null means the line is no longer that heading (the source moved on
      // since the last parse); leave the document alone rather than guess.
      const next = setSourceHeadingTemplate(markdownSource, headingLine, template);
      if (next !== null && next !== markdownSource) setMarkdownSource(next);
    },
    [headingLine, markdownSource, setMarkdownSource],
  );

  // The trigger's label is a fixed width (see `.squisq-slide-block-type`), so
  // a long type name is cut short there; the tooltip carries it whole.
  const label = state.editable
    ? templateLabel(state.template, doc?.customTemplates)
    : (state.label ?? (state.template ? templateLabel(state.template) : '—'));

  return (
    <div
      className={`squisq-preview-control squisq-slide-block-type${compact ? ' squisq-preview-control--compact' : ''}`}
    >
      <TemplatePicker
        value={state.template}
        valueLabel={label}
        onChange={handleChange}
        colorScheme={colorScheme}
        recommended={recommended}
        previewSource={previewSource}
        disabled={!state.editable}
        title={state.editable ? `Block type: ${label}. Change it for this slide.` : state.reason}
      />
    </div>
  );
}
