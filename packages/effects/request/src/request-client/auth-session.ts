export interface AuthSessionSnapshot {
  epoch: number;
  marker: string;
  principal: null | string;
}

export class AuthSessionChangedError extends Error {
  constructor() {
    super('登录状态已变化，请重新登录后确认操作');
    this.name = 'AuthSessionChangedError';
  }
}

/** Decode only for identity comparison; the server remains the token verifier. */
export function accessTokenSubject(token: null | string): null | string {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload: unknown = JSON.parse(
      atob(part.replaceAll('-', '+').replaceAll('_', '/')),
    );
    if (
      payload &&
      typeof payload === 'object' &&
      'sub' in payload &&
      typeof payload.sub === 'string'
    ) {
      return payload.sub;
    }
  } catch {
    // Opaque mock tokens cannot establish a refresh identity.
  }
  return null;
}

/** Share only a random change marker, never credentials. Check at send and replay. */
export function createAuthSessionBoundary(baseURL: string) {
  const origin = new URL(
    baseURL,
    globalThis.location?.href ?? 'http://localhost',
  ).origin;
  const key = `vben:auth-change:${origin}`;
  let fallback = '';
  const read = () => {
    try {
      return globalThis.localStorage?.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  let marker = read();
  let epoch = 0;

  return {
    capture(token: null | string): AuthSessionSnapshot {
      return { epoch, marker, principal: accessTokenSubject(token) };
    },
    isLocalCurrent(snapshot: AuthSessionSnapshot) {
      return snapshot.epoch === epoch;
    },
    isCurrent(snapshot: AuthSessionSnapshot, token: null | string) {
      return (
        snapshot.epoch === epoch &&
        snapshot.marker === marker &&
        marker === read() &&
        snapshot.principal === accessTokenSubject(token)
      );
    },
    assertCurrent(snapshot: AuthSessionSnapshot, token: null | string) {
      if (!this.isCurrent(snapshot, token)) throw new AuthSessionChangedError();
    },
    /** Explicit login/logout invalidates pending work in all same-origin tabs. */
    change() {
      epoch += 1;
      marker =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      fallback = marker;
      try {
        globalThis.localStorage?.setItem(key, marker);
      } catch {
        /* Subject checks and local epoch still apply without storage. */
      }
    },
    /** Passive reauthentication must not revoke or invalidate another tab. */
    reset() {
      epoch += 1;
      marker = read();
    },
  };
}
