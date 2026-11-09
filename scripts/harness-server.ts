/**
 * The Vite dev server behind the visual-review harnesses
 * (`generate-swatches.ts`, `generate-deck-review.ts`). It renders workspace
 * *source* through package aliases, so a template, theme or planner edit shows
 * on the next capture without rebuilding any package, and serves the site's
 * public folder so pages load the self-hosted theme fonts.
 */
import { createServer, type Plugin, type PluginOption, type ViteDevServer } from 'vite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_PUBLIC_DIR = path.join(REPO_ROOT, 'packages', 'site', 'public');

function workspaceSourceAliases(): Array<{ find: RegExp; replacement: string }> {
  const core = (rel: string) => path.join(REPO_ROOT, 'packages', 'core', 'src', rel);
  const reactPkg = (rel: string) => path.join(REPO_ROOT, 'packages', 'react', 'src', rel);
  const coreSubpaths = [
    'schemas',
    'spatial',
    'doc',
    'storage',
    'markdown',
    'timing',
    'random',
    'generate',
    'transform',
    'versions',
    'jsonForm',
    'imageEdit',
    'icons',
    'recommend',
    'narration',
    'fence',
    'proof',
    'table',
  ];
  const reactSubpaths = ['player', 'page', 'layers', 'hooks', 'markdown', 'json-view'];
  return [
    { find: /^@bendyline\/squisq\/icon-marker$/, replacement: core('icons/inlineIconMarker.ts') },
    ...coreSubpaths.map((s) => ({
      find: new RegExp(`^@bendyline/squisq/${s}$`),
      replacement: core(`${s}/index.ts`),
    })),
    { find: /^@bendyline\/squisq$/, replacement: core('index.ts') },
    { find: /^@bendyline\/squisq-react\/styles$/, replacement: reactPkg('styles/index.css') },
    ...reactSubpaths.map((s) => ({
      find: new RegExp(`^@bendyline/squisq-react/${s}$`),
      replacement: reactPkg(`${s}/index.ts`),
    })),
    { find: /^@bendyline\/squisq-react$/, replacement: reactPkg('index.ts') },
  ];
}

/**
 * `@vitejs/plugin-react` is a devDependency of the site workspace, not the
 * root, so resolve it from there instead of assuming npm hoisted it.
 */
async function loadReactPlugin(): Promise<PluginOption> {
  const siteRequire = createRequire(path.join(REPO_ROOT, 'packages', 'site', 'package.json'));
  const entry = siteRequire.resolve('@vitejs/plugin-react');
  const mod = (await import(pathToFileURL(entry).href)) as {
    default?: () => PluginOption;
  };
  if (typeof mod.default !== 'function') {
    throw new Error('Unable to load @vitejs/plugin-react from packages/site.');
  }
  return mod.default();
}

/** Start the harness server with `plugins` (each harness serves its own assets). */
export async function createHarnessServer(
  plugins: Plugin[] = [],
): Promise<{ server: ViteDevServer; baseUrl: string }> {
  const server = await createServer({
    root: REPO_ROOT,
    configFile: false,
    appType: 'mpa',
    logLevel: 'warn',
    publicDir: SITE_PUBLIC_DIR,
    plugins: [await loadReactPlugin(), ...plugins],
    resolve: {
      alias: workspaceSourceAliases(),
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
      exclude: [
        '@bendyline/squisq',
        '@bendyline/squisq-react',
        '@bendyline/squisq-editor-react',
        '@bendyline/squisq-formats',
        '@bendyline/squisq-video',
        '@bendyline/squisq-video-react',
      ],
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      open: false,
      fs: { allow: [REPO_ROOT] },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    await server.close();
    throw new Error('Unable to resolve the Vite server address.');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}
