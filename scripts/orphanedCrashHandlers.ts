import { execFile } from 'node:child_process';

/**
 * Keeps an E2E run from freezing on Windows when a test browser's crash
 * handler outlives the browser.
 *
 * `browser.close()` resolves only once the browser's stdout and stderr reach
 * end-of-file, and Playwright's built-in `browser` fixture gives that close no
 * timeout. Chromium starts its crashpad handler holding those same two
 * handles. The handler normally exits with the browser, but it stays as long
 * as any renderer it watches is alive — and on some Windows machines a
 * renderer gets stuck partway through terminating: the OS has begun killing it
 * and never finishes, so it cannot be killed again. The handler then holds the
 * pipes open, `browser.close()` never returns, and the run hangs with the
 * failing test that triggered the close not even reported.
 *
 * A crash handler whose browser has exited has nothing left to do (Playwright's
 * browsers upload no crash reports), so stopping it is safe: the pipes close
 * and the run carries on. The stuck renderer itself stays until a reboot.
 */

export interface ChromiumProcessInfo {
  pid: number;
  parentPid: number;
  /** Process creation time, in ms since the epoch. */
  createdMs: number;
  commandLine: string;
}

const CRASH_HANDLER_SWITCH = '--type=crashpad-handler';
/** Playwright launches every browser on a fresh temporary profile with this prefix. */
const TEST_PROFILE_PREFIX = 'playwright_chromiumdev_profile-';

/**
 * Crash handlers of Playwright test browsers created at or after `sinceMs`
 * whose parent process has exited. A parent pid that now belongs to a process
 * started after the handler was reused by the OS, so it counts as exited too.
 */
export function findOrphanedCrashHandlers(
  processes: readonly ChromiumProcessInfo[],
  sinceMs: number,
): number[] {
  const byPid = new Map(processes.map((info) => [info.pid, info]));
  return processes
    .filter((info) => {
      if (!info.commandLine.includes(CRASH_HANDLER_SWITCH)) return false;
      if (!info.commandLine.includes(TEST_PROFILE_PREFIX)) return false;
      if (info.createdMs < sinceMs) return false;
      const parent = byPid.get(info.parentPid);
      return parent === undefined || parent.createdMs > info.createdMs;
    })
    .map((info) => info.pid);
}

export interface OrphanedCrashHandlerSweepOptions {
  /** Only handlers created at or after this time are considered (default: now). */
  sinceMs?: number;
  /** How long a handler must stay orphaned before it is stopped (default 15s). */
  graceMs?: number;
  listProcesses?: () => Promise<ChromiumProcessInfo[]>;
  stopProcess?: (pid: number) => Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
}

export interface OrphanedCrashHandlerSweeper {
  /** Scan once, stopping handlers that have been orphaned past the grace period. */
  sweep(): Promise<void>;
}

/**
 * A crash handler is stopped only once it has been seen orphaned for the grace
 * period, which leaves one that is just finishing up after its browser time to
 * exit by itself. A scan that fails is simply retried on the next sweep.
 */
export function createOrphanedCrashHandlerSweeper(
  options: OrphanedCrashHandlerSweepOptions = {},
): OrphanedCrashHandlerSweeper {
  const now = options.now ?? Date.now;
  const sinceMs = options.sinceMs ?? now();
  const graceMs = options.graceMs ?? 15_000;
  const listProcesses = options.listProcesses ?? listChromiumProcesses;
  const stopProcess = options.stopProcess ?? stopWindowsProcess;
  const log = options.log ?? ((message: string) => console.warn(message));
  const firstSeen = new Map<number, number>();
  let sweeping = false;

  return {
    async sweep() {
      if (sweeping) return;
      sweeping = true;
      try {
        const orphans = findOrphanedCrashHandlers(await listProcesses(), sinceMs);
        const current = new Set(orphans);
        for (const pid of firstSeen.keys()) {
          if (!current.has(pid)) firstSeen.delete(pid);
        }
        for (const pid of orphans) {
          const seenAt = firstSeen.get(pid);
          if (seenAt === undefined) {
            firstSeen.set(pid, now());
            continue;
          }
          if (now() - seenAt < graceMs) continue;
          firstSeen.delete(pid);
          try {
            await stopProcess(pid);
            log(
              `[e2e] Stopped Chromium crash handler ${pid}: its test browser had exited, but it ` +
                `was still holding the browser's output pipes, which keeps Playwright's ` +
                `browser.close() waiting forever. A renderer it watches is likely stuck ` +
                `terminating (see scripts/orphanedCrashHandlers.ts).`,
            );
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err);
            log(`[e2e] Could not stop orphaned Chromium crash handler ${pid}: ${reason}`);
          }
        }
      } catch {
        // Listing processes failed; the next sweep tries again.
      } finally {
        sweeping = false;
      }
    },
  };
}

/**
 * Sweeps for orphaned crash handlers every `intervalMs` until the returned
 * function is called. Windows only: elsewhere it does nothing.
 */
export function watchOrphanedCrashHandlers(
  options: OrphanedCrashHandlerSweepOptions & { intervalMs?: number } = {},
): () => void {
  if (process.platform !== 'win32' && options.listProcesses === undefined) return () => {};
  const sweeper = createOrphanedCrashHandlerSweeper(options);
  const timer = setInterval(() => void sweeper.sweep(), options.intervalMs ?? 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

const LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$items = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='chrome-headless-shell.exe'\"",
  'ConvertTo-Json -Compress -InputObject @($items | ForEach-Object { @{ ' +
    'pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; ' +
    "created = $_.CreationDate.ToUniversalTime().ToString('o'); " +
    'commandLine = [string]$_.CommandLine } })',
].join('; ');

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** Every Chromium process on this machine (Windows only). */
export async function listChromiumProcesses(): Promise<ChromiumProcessInfo[]> {
  const stdout = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    LIST_SCRIPT,
  ]);
  const rows: unknown = JSON.parse(stdout.trim() || '[]');
  if (!Array.isArray(rows)) return [];
  const processes: ChromiumProcessInfo[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const createdMs = Date.parse(String(row.created));
    if (typeof row.pid !== 'number' || typeof row.parentPid !== 'number') continue;
    if (!Number.isFinite(createdMs)) continue;
    processes.push({
      pid: row.pid,
      parentPid: row.parentPid,
      createdMs,
      commandLine: typeof row.commandLine === 'string' ? row.commandLine : '',
    });
  }
  return processes;
}

async function stopWindowsProcess(pid: number): Promise<void> {
  await run('taskkill.exe', ['/PID', String(pid), '/F']);
}
