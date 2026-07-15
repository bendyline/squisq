import { describe, expect, it, vi } from 'vitest';
import { InitialBuildBarrier } from '../scripts/run-dev.mjs';

describe('InitialBuildBarrier', () => {
  it('waits for every package ESM build and ignores other build formats', async () => {
    const onReady = vi.fn();
    const barrier = new InitialBuildBarrier(['core', 'react'], onReady);

    barrier.write('react', 'IIFE Build success in 20ms\n');
    barrier.write('core', 'DTS Build success in 100ms\n');
    expect(barrier.pendingNames).toEqual(['core', 'react']);

    barrier.write('core', '\u001B[32mES');
    barrier.write('core', 'M\u001B[39m ⚡️ Build success in 80ms\n');
    expect(barrier.pendingNames).toEqual(['react']);

    barrier.write('react', 'ESM ⚡️ Build success in 42ms\n');
    await expect(barrier.ready).resolves.toBeUndefined();
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenNthCalledWith(1, 'core');
    expect(onReady).toHaveBeenNthCalledWith(2, 'react');
  });

  it('rejects when an initial ESM build fails', async () => {
    const barrier = new InitialBuildBarrier(['core']);

    barrier.write('core', 'ESM Build failed\n');

    await expect(barrier.ready).rejects.toThrow('core failed its initial ESM build');
  });

  it('rejects when a watcher exits before becoming ready', async () => {
    const barrier = new InitialBuildBarrier(['formats']);

    barrier.close('formats');

    await expect(barrier.ready).rejects.toThrow(
      'formats exited before its initial ESM build completed',
    );
  });
});
