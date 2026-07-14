/**
 * Start package watchers before Vite so the site never crawls a half-written
 * workspace `dist/` graph.
 *
 * `npm run dev` performs an ordered package build first. Every tsup watcher
 * then performs its own initial build, however, and the old script launched
 * those rebuilds at the same time as Vite. Because workspace package exports
 * resolve to `dist/`, Vite could observe an entry file and its shared chunk
 * from different build passes. This orchestrator waits for the initial ESM
 * build from every package watcher before it starts the site.
 */

import concurrently from 'concurrently';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const INITIAL_BUILD_TIMEOUT_MS = 120_000;

export const PACKAGE_WATCHERS = [
  { name: 'core', command: 'npm:dev:packages:core', prefixColor: 'blue' },
  { name: 'formats', command: 'npm:dev:packages:formats', prefixColor: 'cyan' },
  { name: 'react', command: 'npm:dev:packages:react', prefixColor: 'magenta' },
  { name: 'video', command: 'npm:dev:packages:video', prefixColor: 'yellow' },
  { name: 'video-react', command: 'npm:dev:packages:video-react', prefixColor: 'green' },
  { name: 'editor', command: 'npm:dev:packages:editor', prefixColor: 'red' },
];

const ESM_BUILD_SUCCESS = /\bESM\b[^\r\n]*\bBuild success\b/;
const ESM_BUILD_FAILURE = /\bESM\b[^\r\n]*\bBuild failed\b/;

/**
 * Tracks the first successful JavaScript build from every package watcher.
 * DTS and React's one-shot IIFE build deliberately do not count: neither one
 * guarantees that the ESM files Vite imports have finished being rewritten.
 */
export class InitialBuildBarrier {
  #buffers = new Map();
  #pending;
  #resolve;
  #reject;
  #settled = false;

  constructor(names, onReady = () => {}) {
    this.#pending = new Set(names);
    this.onReady = onReady;
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.#resolve = resolveReady;
      this.#reject = rejectReady;
    });

    if (this.#pending.size === 0) {
      this.#settled = true;
      this.#resolve();
    }
  }

  get pendingNames() {
    return [...this.#pending];
  }

  write(name, chunk) {
    if (this.#settled || !this.#pending.has(name)) return;

    const previous = this.#buffers.get(name) ?? '';
    const output = stripVTControlCharacters(previous + chunk.toString());
    // Keep enough trailing output to recognize a marker split across chunks
    // without retaining tsup's complete file listing for large packages.
    this.#buffers.set(name, output.slice(-4_096));

    if (ESM_BUILD_FAILURE.test(output)) {
      this.fail(new Error(`${name} failed its initial ESM build.`));
      return;
    }

    if (!ESM_BUILD_SUCCESS.test(output)) return;

    this.#pending.delete(name);
    this.#buffers.delete(name);
    this.onReady(name);

    if (this.#pending.size === 0) {
      this.#settled = true;
      this.#resolve();
    }
  }

  close(name) {
    if (!this.#settled && this.#pending.has(name)) {
      this.fail(new Error(`${name} exited before its initial ESM build completed.`));
    }
  }

  fail(error) {
    if (this.#settled) return;
    this.#settled = true;
    this.#reject(error);
  }
}

function killCommands(commands) {
  for (const command of commands) {
    if (command.state === 'started' && !command.killed) command.kill();
  }
}

function settledRun(group, run) {
  return run.result.then(
    (events) => ({ group, succeeded: true, events }),
    (events) => ({ group, succeeded: false, events }),
  );
}

function waitForInitialBuilds(barrier) {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(
        new Error(`Timed out waiting for initial ESM builds: ${barrier.pendingNames.join(', ')}`),
      );
    }, INITIAL_BUILD_TIMEOUT_MS);
    timer.unref();

    barrier.ready.then(
      () => {
        clearTimeout(timer);
        resolveReady();
      },
      (error) => {
        clearTimeout(timer);
        rejectReady(error);
      },
    );
  });
}

export async function runDev() {
  const watcherRun = concurrently(PACKAGE_WATCHERS, {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    prefix: 'name',
    killOthersOn: ['failure', 'success'],
  });
  const barrier = new InitialBuildBarrier(
    watcherRun.commands.map((command) => command.name),
    (name) => console.log(`[dev] ${name} initial ESM build ready`),
  );

  for (const command of watcherRun.commands) {
    command.stdout.subscribe((chunk) => barrier.write(command.name, chunk));
    command.stderr.subscribe((chunk) => barrier.write(command.name, chunk));
    command.close.subscribe(() => barrier.close(command.name));
  }

  try {
    await waitForInitialBuilds(barrier);
  } catch (error) {
    killCommands(watcherRun.commands);
    await watcherRun.result.catch(() => undefined);
    throw error;
  }

  console.log('[dev] package watchers ready; starting Vite');
  const siteRun = concurrently([{ name: 'site', command: 'npm:dev:site', prefixColor: 'white' }], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    prefix: 'name',
    killOthersOn: ['failure', 'success'],
  });

  const watcherOutcome = settledRun('watchers', watcherRun);
  const siteOutcome = settledRun('site', siteRun);
  const outcome = await Promise.race([watcherOutcome, siteOutcome]);

  if (outcome.group === 'watchers') killCommands(siteRun.commands);
  else killCommands(watcherRun.commands);

  await Promise.all([watcherOutcome, siteOutcome]);
  if (!outcome.succeeded) process.exitCode = 1;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  runDev().catch((error) => {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
