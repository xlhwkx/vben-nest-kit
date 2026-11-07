import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRefreshCoordinator } from './refresh-coordinator';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('refresh cookie coordination', () => {
  it('serializes same-origin API aliases without Web Locks and recovers after rejection', async () => {
    vi.stubGlobal('navigator', {});
    const firstTab = createRefreshCoordinator('https://api.test/api');
    const secondTab = createRefreshCoordinator('https://api.test/api/v1');
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = firstTab(async () => {
      events.push('first');
      await gate;
      throw new Error('upstream unavailable');
    });
    const firstFailure = first.catch((error: unknown) => error);
    const second = secondTab(async () => {
      events.push('second');
      return 'latest-cookie-token';
    });
    await Promise.resolve();
    expect(events).toEqual(['first']);
    release();
    await expect(firstFailure).resolves.toMatchObject({
      message: 'upstream unavailable',
    });
    await expect(second).resolves.toBe('latest-cookie-token');
    expect(events).toEqual(['first', 'second']);
  });

  it('does not block refreshes to a different API origin', async () => {
    vi.stubGlobal('navigator', {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = createRefreshCoordinator('https://one.test/api')(() => gate);
    await expect(
      createRefreshCoordinator('https://two.test/api')(async () => 'two'),
    ).resolves.toBe('two');
    release();
    await first;
  });

  it('uses one exclusive browser lock for all aliases without sharing tokens in storage', async () => {
    const request = vi.fn(async (_name, _options, run) => run());
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(
      createRefreshCoordinator('https://api.test/api')(async () => 'one'),
    ).resolves.toBe('one');
    await expect(
      createRefreshCoordinator('https://api.test/api/v1')(async () => 'two'),
    ).resolves.toBe('two');
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'vben:refresh:https://api.test',
      'vben:refresh:https://api.test',
    ]);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ mode: 'exclusive' });
  });

  it('bounds lock acquisition and never retries the HTTP operation outside the lock', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      },
    });
    const refresh = vi.fn(async () => 'token');
    const result = createRefreshCoordinator('/api')(refresh);
    const rejected = result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(rejected).resolves.toMatchObject({ name: 'AbortError' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not repeat an operation if a native lock callback fails', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          _options: unknown,
          run: () => Promise<unknown>,
        ) => run(),
      },
    });
    const refresh = vi.fn(async () => {
      throw new Error('failed');
    });
    await expect(createRefreshCoordinator('/api')(refresh)).rejects.toThrow(
      'failed',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
