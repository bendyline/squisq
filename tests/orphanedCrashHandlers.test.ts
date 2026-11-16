import { describe, expect, it } from 'vitest';
import {
  createOrphanedCrashHandlerSweeper,
  findOrphanedCrashHandlers,
  listChromiumProcesses,
  type ChromiumProcessInfo,
} from '../scripts/orphanedCrashHandlers';

const RUN_START = Date.parse('2026-11-15T22:27:41Z');
const PROFILE = String.raw`C:\Users\me\AppData\Local\Temp\playwright_chromiumdev_profile-1k8eoz`;

function browser(pid: number, createdMs = RUN_START + 1_000): ChromiumProcessInfo {
  return {
    pid,
    parentPid: 12472,
    createdMs,
    commandLine: `chrome.exe --remote-debugging-pipe --user-data-dir=${PROFILE}`,
  };
}

function crashHandler(
  pid: number,
  parentPid: number,
  createdMs = RUN_START + 2_000,
  profile = PROFILE,
): ChromiumProcessInfo {
  return {
    pid,
    parentPid,
    createdMs,
    commandLine: `chrome.exe --type=crashpad-handler --user-data-dir=${profile} /prefetch:4`,
  };
}

describe('findOrphanedCrashHandlers', () => {
  it('finds a test browser crash handler whose browser has exited', () => {
    expect(findOrphanedCrashHandlers([crashHandler(40112, 43772)], RUN_START)).toEqual([40112]);
  });

  it('leaves a crash handler alone while its browser runs', () => {
    const processes = [browser(43772), crashHandler(40112, 43772)];
    expect(findOrphanedCrashHandlers(processes, RUN_START)).toEqual([]);
  });

  it('treats a parent pid the OS gave to a newer process as exited', () => {
    const reused = browser(43772, RUN_START + 60_000);
    expect(findOrphanedCrashHandlers([reused, crashHandler(40112, 43772)], RUN_START)).toEqual([
      40112,
    ]);
  });

  it('leaves alone handlers from before the run, other profiles, and other process types', () => {
    const processes: ChromiumProcessInfo[] = [
      crashHandler(1, 999, RUN_START - 1),
      crashHandler(
        2,
        999,
        RUN_START + 1,
        String.raw`C:\Users\me\AppData\Local\Google\Chrome\User Data`,
      ),
      {
        ...crashHandler(3, 999),
        commandLine: `chrome.exe --type=renderer --user-data-dir=${PROFILE}`,
      },
    ];
    expect(findOrphanedCrashHandlers(processes, RUN_START)).toEqual([]);
  });
});

describe('createOrphanedCrashHandlerSweeper', () => {
  function harness(processes: ChromiumProcessInfo[]) {
    let clock = RUN_START + 10_000;
    const stopped: number[] = [];
    const messages: string[] = [];
    const sweeper = createOrphanedCrashHandlerSweeper({
      sinceMs: RUN_START,
      graceMs: 15_000,
      now: () => clock,
      listProcesses: async () => processes,
      stopProcess: async (pid) => {
        stopped.push(pid);
      },
      log: (message) => messages.push(message),
    });
    return {
      sweeper,
      stopped,
      messages,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('stops an orphaned handler only after it stays orphaned for the grace period', async () => {
    const { sweeper, stopped, messages, advance } = harness([crashHandler(40112, 43772)]);
    await sweeper.sweep();
    expect(stopped).toEqual([]);
    advance(10_000);
    await sweeper.sweep();
    expect(stopped).toEqual([]);
    advance(5_000);
    await sweeper.sweep();
    expect(stopped).toEqual([40112]);
    expect(messages[0]).toContain('Stopped Chromium crash handler 40112');
  });

  it('forgets a handler that exits by itself, so its pid is not stopped later', async () => {
    const processes = [crashHandler(40112, 43772)];
    const { sweeper, stopped, advance } = harness(processes);
    await sweeper.sweep();
    processes.length = 0;
    advance(20_000);
    await sweeper.sweep();
    // The pid comes back as a fresh orphan: its grace period starts over.
    processes.push(crashHandler(40112, 43772));
    await sweeper.sweep();
    expect(stopped).toEqual([]);
  });

  it('survives a failed scan or a failed stop', async () => {
    const messages: string[] = [];
    let clock = RUN_START + 10_000;
    let calls = 0;
    const sweeper = createOrphanedCrashHandlerSweeper({
      sinceMs: RUN_START,
      graceMs: 0,
      now: () => clock++,
      listProcesses: async () => {
        calls++;
        if (calls === 1) throw new Error('powershell unavailable');
        return [crashHandler(40112, 43772)];
      },
      stopProcess: async () => {
        throw new Error('access denied');
      },
      log: (message) => messages.push(message),
    });
    await expect(sweeper.sweep()).resolves.toBeUndefined();
    await sweeper.sweep();
    await sweeper.sweep();
    expect(messages).toEqual([
      '[e2e] Could not stop orphaned Chromium crash handler 40112: access denied',
    ]);
  });
});

describe('listChromiumProcesses', () => {
  it.runIf(process.platform === 'win32')(
    'reads the machine’s Chromium processes',
    async () => {
      const processes = await listChromiumProcesses();
      expect(Array.isArray(processes)).toBe(true);
      for (const info of processes) {
        expect(Number.isInteger(info.pid)).toBe(true);
        expect(Number.isFinite(info.createdMs)).toBe(true);
      }
    },
    30_000,
  );
});
