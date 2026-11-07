import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthSessionChangedError,
  createAuthSessionBoundary,
} from './auth-session';

const token = (sub: string, nonce = 1) =>
  `header.${btoa(JSON.stringify({ sub, nonce }))}.signature`;

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('authentication identity boundary', () => {
  it('allows renewal for the same principal and rejects another account', () => {
    const session = createAuthSessionBoundary('https://api.test/api');
    const snapshot = session.capture(token('A'));
    expect(session.isCurrent(snapshot, token('A', 2))).toBe(true);
    expect(() => session.assertCurrent(snapshot, token('B'))).toThrow(
      AuthSessionChangedError,
    );
  });

  it('rejects work from before another tab logs in, including the same user', () => {
    const first = createAuthSessionBoundary('https://api.test/api');
    const second = createAuthSessionBoundary('https://api.test/api/v1');
    const snapshot = first.capture(token('A'));
    second.change();
    expect(first.isCurrent(snapshot, token('A'))).toBe(false);
    // Passive reset must not invalidate the second tab's new work.
    const secondSnapshot = second.capture(token('A'));
    first.reset();
    expect(second.isCurrent(secondSnapshot, token('A'))).toBe(true);
  });

  it('prevents delayed refresh results from undoing logout or a new login', () => {
    const session = createAuthSessionBoundary('https://api.test/api');
    const oldRequest = session.capture(token('A'));
    session.change();
    expect(session.isLocalCurrent(oldRequest)).toBe(false);
    expect(session.isCurrent(oldRequest, token('A', 2))).toBe(false);
    const logoutRequest = session.capture(token('A'));
    session.reset();
    expect(session.isCurrent(logoutRequest, null)).toBe(false);
  });

  it('keeps local epochs and principal checks when storage is denied', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    const session = createAuthSessionBoundary('https://api.test/api');
    session.change();
    const snapshot = session.capture(token('A'));
    expect(session.isCurrent(snapshot, token('A', 2))).toBe(true);
    expect(session.isCurrent(snapshot, token('B'))).toBe(false);
    session.reset();
    expect(session.isCurrent(snapshot, token('A'))).toBe(false);
  });
});
