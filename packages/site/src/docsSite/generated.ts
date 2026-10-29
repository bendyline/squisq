/**
 * Reference content generated from core's own catalogs, so the documentation
 * cannot drift from the code: template parameter tables, the block-settings
 * table, the template list, and the theme list.
 *
 * Each generator returns Markdown; the site build parses it and splices it
 * into the page wherever a ` ```squisq-docs <name> ` fence asks for it.
 */

import {
  TEMPLATE_AUTHORING_METADATA,
  TEMPLATE_INPUT_DESCRIPTORS,
  TEMPLATE_METADATA,
} from '@bendyline/squisq/doc';
import { BLOCK_META_KEY_DESCRIPTORS } from '@bendyline/squisq/markdown';
import { getThemeSummaries } from '@bendyline/squisq/schemas';

export type TemplateRole =
  (typeof TEMPLATE_AUTHORING_METADATA)[keyof typeof TEMPLATE_AUTHORING_METADATA]['role'];

export interface BlockGroup {
  title: string;
  roles: readonly TemplateRole[];
}

/** How the block gallery groups templates, in gallery order. */
export const BLOCK_GROUPS: readonly BlockGroup[] = [
  { title: 'Openers & dividers', roles: ['opener', 'divider'] },
  { title: 'Text & content', roles: ['content'] },
  { title: 'Highlights & quotes', roles: ['highlight', 'quote'] },
  { title: 'Comparisons & events', roles: ['comparison', 'event'] },
  { title: 'Images & video', roles: ['media'] },
  { title: 'Data & charts', roles: ['data'] },
  { title: 'Diagrams, maps & canvases', roles: ['spatial'] },
];

const BODY_POLICY_TEXT: Record<string, string> = {
  complete: 'Shows the whole section body.',
  derived: 'Reads specific pieces of the body — an image, a quote, a number — and shows those.',
  ignored: 'Shows the heading and tag parameters; body prose is not displayed.',
  structured: 'Reads the body as structured content (a table, a list, a fence, or columns).',
};

/** Every built-in template id, in gallery order. */
export function templateIds(): string[] {
  return Object.keys(TEMPLATE_METADATA);
}

export function templateLabel(id: string): string {
  return TEMPLATE_METADATA[id]?.label ?? id;
}

export function templateDescription(id: string): string {
  return TEMPLATE_METADATA[id]?.description ?? '';
}

export function templateRole(id: string): TemplateRole | undefined {
  return (TEMPLATE_AUTHORING_METADATA as Record<string, { role: TemplateRole }>)[id]?.role;
}

/** Template ids grouped for the gallery and sidebar; empty groups are dropped. */
export function groupedTemplateIds(): Array<{ title: string; ids: string[] }> {
  const ids = templateIds();
  return BLOCK_GROUPS.map((group) => ({
    title: group.title,
    ids: ids.filter((id) => {
      const role = templateRole(id);
      return role !== undefined && group.roles.includes(role);
    }),
  })).filter((group) => group.ids.length > 0);
}

/** Escape text for a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function codeCell(text: string): string {
  return `\`${text.replace(/\|/g, '\\|')}\``;
}

function valuesCell(values: readonly string[] | undefined, hint: string | undefined): string {
  if (values && values.length > 0) return values.map(codeCell).join(', ');
  return hint ? cell(hint) : '';
}

/** One-line summary of how a template treats the section body. */
export function bodyPolicySummary(id: string): string {
  const policy = (TEMPLATE_AUTHORING_METADATA as Record<string, { bodyPolicy: string }>)[id]
    ?.bodyPolicy;
  return policy ? (BODY_POLICY_TEXT[policy] ?? '') : '';
}

/** The `{[id key=…]}` parameter table for one template. */
export function templateParamsMarkdown(id: string): string {
  const descriptors = TEMPLATE_INPUT_DESCRIPTORS[id];
  if (!descriptors) {
    // Not catalogued: the template may still read parameters, so never claim it has none.
    return `\`{[${id}]}\` has no entry in the parameter catalog yet, so its parameters are described on this page rather than listed here. Every block also accepts the shared [block settings](../guide/tags.md#block-settings).\n`;
  }
  if (descriptors.length === 0) {
    return `\`{[${id}]}\` takes no template-specific parameters. The shared [block settings](../guide/tags.md#block-settings) — timing, transitions, and progressive builds — still apply.\n`;
  }
  const rows = descriptors.map((descriptor) => {
    const required = descriptor.required ? 'Required' : '';
    return `| ${codeCell(descriptor.key)} | ${cell(descriptor.description)} | ${valuesCell(
      descriptor.values,
      descriptor.valueHint,
    )} | ${required} |`;
  });
  return [
    `| Parameter | What it does | Values | |`,
    `| --- | --- | --- | --- |`,
    ...rows,
    '',
    `Every block also accepts the shared [block settings](../guide/tags.md#block-settings) — timing, transitions, and progressive builds.`,
    '',
  ].join('\n');
}

/** The table of settings every block accepts, whatever its template. */
export function blockSettingsMarkdown(): string {
  const rows = BLOCK_META_KEY_DESCRIPTORS.map(
    (descriptor) =>
      `| ${codeCell(descriptor.key)} | ${cell(descriptor.description)} | ${valuesCell(
        descriptor.values,
        descriptor.valueHint,
      )} |`,
  );
  return ['| Setting | What it does | Values |', '| --- | --- | --- |', ...rows, ''].join('\n');
}

/** Every built-in template with its tag and one-line description. */
export function templateListMarkdown(blocksDir: string): string {
  const rows = templateIds().map(
    (id) =>
      `| [${cell(templateLabel(id))}](${blocksDir}${id}.md) | ${codeCell(`{[${id}]}`)} | ${cell(
        templateDescription(id),
      )} |`,
  );
  return ['| Block | Tag | Use it for |', '| --- | --- | --- |', ...rows, ''].join('\n');
}

/** Every built-in theme with its id and description. */
export function themeListMarkdown(): string {
  const rows = getThemeSummaries().map(
    (theme) => `| ${cell(theme.name)} | ${codeCell(theme.id)} | ${cell(theme.description ?? '')} |`,
  );
  return ['| Theme | Id | Character |', '| --- | --- | --- |', ...rows, ''].join('\n');
}

export function themeChoices(): Array<{ id: string; name: string }> {
  return getThemeSummaries().map((theme) => ({ id: theme.id, name: theme.name }));
}
