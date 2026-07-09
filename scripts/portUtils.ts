import { createServer } from 'node:net';

export const SQUISQ_DEV_PORT = 5199;
export const SQUISQ_E2E_PORT = 5299;

const MIN_USER_PORT = 1024;
const MAX_PORT = 65_535;

export interface FindAvailablePortOptions {
  preferredPort: number;
  excludedPorts?: readonly number[];
  host?: string;
  maxAttempts?: number;
}

function assertPort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < MIN_USER_PORT || port > MAX_PORT) {
    throw new Error(`${label} must be an integer between ${MIN_USER_PORT} and ${MAX_PORT}.`);
  }
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => resolve(error === undefined));
    });
  });
}

/**
 * Find a free local port, starting at the preferred port and scanning
 * forward. The scan wraps within the non-privileged port range.
 */
export async function findAvailablePort(options: FindAvailablePortOptions): Promise<number> {
  const { preferredPort, excludedPorts = [], host = '127.0.0.1', maxAttempts = 100 } = options;

  assertPort(preferredPort, 'preferredPort');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer.');
  }

  const excluded = new Set(excludedPorts);
  for (const port of excluded) assertPort(port, 'excluded port');

  const portRange = MAX_PORT - MIN_USER_PORT + 1;
  for (let offset = 0; offset < Math.min(maxAttempts, portRange); offset += 1) {
    const candidate = MIN_USER_PORT + ((preferredPort - MIN_USER_PORT + offset) % portRange);
    if (excluded.has(candidate)) continue;
    if (await canListen(host, candidate)) return candidate;
  }

  throw new Error(`Could not find a free port after ${maxAttempts} attempts.`);
}
