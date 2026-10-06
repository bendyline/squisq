/**
 * The capability resolver and the lazy-load boundary.
 *
 * Ownership mirrors proofing: a factory is invoked and its provider becomes
 * the caller's to dispose; an instance passes through untouched and stays the
 * host's. And a shell without the capability must load no capture code — the
 * engine, activity gate, WAV encoder and session module are reachable only
 * through the controller's dynamic import.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  SPEECH_INPUT_SAMPLE_RATE,
  isSpeechInputProviderFactory,
  resolveSpeechInputProvider,
  type SpeechInputProvider,
} from '../types';

function provider(): SpeechInputProvider {
  return {
    id: 'p',
    label: 'Provider',
    status: async () => ({ state: 'ready' }),
    transcribe: async () => ({ text: '' }),
  };
}

describe('resolveSpeechInputProvider', () => {
  it('returns a host instance as-is (host-owned)', () => {
    const instance = provider();
    expect(resolveSpeechInputProvider(instance)).toBe(instance);
    expect(isSpeechInputProviderFactory(instance)).toBe(false);
  });

  it('invokes a factory once per resolution (caller-owned)', () => {
    const instance = provider();
    const factory = vi.fn(() => instance);
    expect(isSpeechInputProviderFactory(factory)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
    expect(resolveSpeechInputProvider(factory)).toBe(instance);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('documents the 16 kHz wire format', () => {
    expect(SPEECH_INPUT_SAMPLE_RATE).toBe(16_000);
  });
});

/** Modules that may only load behind the controller's dynamic import. */
const LAZY = [
  'dictationSession',
  'progressiveSpeechToText',
  'microphoneSpeechActivity',
  'speechAudioWav',
];

describe('dictation lazy-load boundary', () => {
  it('keeps the capture engine behind a dynamic import', () => {
    const srcRoot = resolve(import.meta.dirname, '../..');
    const speechDir = resolve(srcRoot, 'speech');
    const eager: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!/\.tsx?$/.test(path)) continue;
        const file = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        // The lazy modules may import each other; nothing else may.
        const self = LAZY.some((name) => path === join(speechDir, `${name}.ts`));
        if (self) continue;
        for (const node of file.statements) {
          if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
          const specifier = node.moduleSpecifier;
          if (!specifier || !ts.isStringLiteral(specifier)) continue;
          const target = specifier.text.replace(/\.js$/, '');
          if (!LAZY.some((name) => target.endsWith(`/${name}`))) continue;
          const typeOnly = ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly === true
            : node.isTypeOnly;
          if (!typeOnly) eager.push(relative(srcRoot, path));
        }
      }
    };
    visit(srcRoot);
    expect(eager).toEqual([]);
  });
});
