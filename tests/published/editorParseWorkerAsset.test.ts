import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { loadPublicPackages } from './_packages';

describe('@bendyline/squisq-editor-react background parser asset', () => {
  const pkg = loadPublicPackages().find((candidate) => candidate.name.endsWith('editor-react'))!;
  const workerPath = 'document-parse-worker/index.js';
  const worker = resolve(pkg.dist, workerPath);

  it('ships a self-contained browser worker without bare or Node imports', () => {
    const source = readFileSync(worker, 'utf8');
    const ast = ts.createSourceFile(worker, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
        (ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
      )
        imports.push(node.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(imports).toEqual([]);
    expect(source).toContain('globalThis.onmessage');
  });

  it('resolves the worker asset relative to every compiled client module', () => {
    const holders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (
          entry.name.endsWith('.js') &&
          /new URL\(["']\.\/document-parse-worker\/index\.js["'], import\.meta\.url\)/.test(
            readFileSync(file, 'utf8'),
          )
        )
          holders.push(file);
      }
    };
    walk(pkg.dist);
    expect(holders.length).toBeGreaterThan(0);
    for (const file of holders) expect(resolve(dirname(file), workerPath)).toBe(worker);
  });

  it('starts and parses named entities without window or document globals', () => {
    const messages: unknown[] = [];
    const scope: {
      onmessage?: (event: { data: unknown }) => void;
      postMessage: (value: unknown) => void;
    } = { postMessage: (value) => messages.push(value) };
    runInNewContext(readFileSync(worker, 'utf8'), scope);
    expect(scope.onmessage).toBeTypeOf('function');
    scope.onmessage?.({ data: { id: 1, source: '# Worker\n\n&amp; &ne; **bold**' } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 1,
      error: null,
      markdown: { type: 'document' },
    });
    expect(JSON.stringify(messages[0])).toContain('& ≠');
  });
});
