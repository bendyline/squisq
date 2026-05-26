import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAvailableTemplates } from '../packages/core/src/doc/templates/index';

const DOC_PATHS = {
  agents: 'AGENTS.md',
  readme: 'README.md',
  api: 'docs/API.md',
  squigglySquare: 'docs/SquigglySquare.md',
} as const;

type DocKey = keyof typeof DOC_PATHS;

function readWorkspaceFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function readDoc(key: DocKey): string {
  return readWorkspaceFile(DOC_PATHS[key]);
}

function readPackageJson(path: string): { exports?: unknown } {
  const parsed: unknown = JSON.parse(readWorkspaceFile(path));
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

function hasPackageExport(exportsField: unknown, exportName: string): boolean {
  return (
    typeof exportsField === 'object' &&
    exportsField !== null &&
    Object.prototype.hasOwnProperty.call(exportsField, exportName)
  );
}

function registryTemplateIds(): string[] {
  return [...getAvailableTemplates()].sort((a, b) => a.localeCompare(b));
}

describe('documentation consistency', () => {
  it('keeps canonical template docs aligned with registry IDs', () => {
    const templateIds = registryTemplateIds();
    const docsToCheck: DocKey[] = ['agents', 'api', 'squigglySquare'];

    expect(templateIds).toHaveLength(23);

    for (const key of docsToCheck) {
      const text = readDoc(key);
      const missing = templateIds.filter((templateId) => !text.includes(`\`${templateId}\``));

      expect(missing, `${DOC_PATHS[key]} is missing template IDs: ${missing.join(', ')}`).toEqual(
        [],
      );
    }
  });

  it('keeps documented template counts aligned with the registry', () => {
    const count = registryTemplateIds().length;
    const agents = readDoc('agents');
    const api = readDoc('api');

    expect(agents).toContain(`${count} block templates`);
    expect(agents).toContain(`all ${count} templates`);
    expect(api).toContain(`All ${count} built-in templates`);
  });

  it('keeps package and export docs aligned with package manifests', () => {
    const readme = readDoc('readme');
    const agents = readDoc('agents');
    const videoReactPackage = readPackageJson('packages/video-react/package.json');

    expect(readme).toContain('`@bendyline/squisq-video`');
    expect(readme).not.toContain('CLAUDE.md');
    expect(hasPackageExport(videoReactPackage.exports, './worker')).toBe(false);
    expect(agents).not.toContain('@bendyline/squisq-video-react/worker');
  });

  it('describes PPTX export as implemented and import as stubbed', () => {
    const api = readDoc('api');

    expect(api).toContain('PPTX export is implemented');
    expect(api).toContain('PPTX import functions are still stubs');
    expect(api).not.toContain('PPTX export is not yet implemented');
  });
});
