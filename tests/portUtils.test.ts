import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findAvailablePort, SQUISQ_DEV_PORT, SQUISQ_E2E_PORT } from '../scripts/portUtils';

const openServers: Server[] = [];

function occupyRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    openServers.push(server);
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
});

describe('findAvailablePort', () => {
  it('keeps the interactive site and E2E preview on different defaults', () => {
    expect(SQUISQ_E2E_PORT).not.toBe(SQUISQ_DEV_PORT);
  });

  it('moves to another port when the preferred port is occupied', async () => {
    const occupiedPort = await occupyRandomPort();

    const selectedPort = await findAvailablePort({
      preferredPort: occupiedPort,
      excludedPorts: [SQUISQ_DEV_PORT],
      maxAttempts: 10,
    });

    expect(selectedPort).not.toBe(occupiedPort);
    expect(selectedPort).not.toBe(SQUISQ_DEV_PORT);
  });

  it('never selects an excluded port', async () => {
    const selectedPort = await findAvailablePort({
      preferredPort: SQUISQ_DEV_PORT,
      excludedPorts: [SQUISQ_DEV_PORT],
    });

    expect(selectedPort).not.toBe(SQUISQ_DEV_PORT);
  });
});
