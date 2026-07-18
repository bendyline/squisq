import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { ensureTeleprompterFakeMic } from './fakeMicFixture';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSelectedPort(): number {
  const value = process.env.SQUISQ_E2E_SELECTED_PORT;
  const port = Number(value);
  if (!value || !Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('SQUISQ_E2E_SELECTED_PORT was not initialized by playwright.config.ts.');
  }
  return port;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await ensureTeleprompterFakeMic();

  const server = await preview({
    root: path.join(repoRoot, 'packages/site'),
    logLevel: 'warn',
    preview: {
      host: '127.0.0.1',
      port: readSelectedPort(),
      strictPort: true,
    },
  });

  return async () => {
    await server.close();
  };
}
