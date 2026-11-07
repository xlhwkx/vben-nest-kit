const pending = new Map<string, Promise<void>>();

/**
 * Serialize refreshes for the same API cookie across tabs on this frontend origin.
 * Each holder sends the latest HttpOnly cookie; tokens never pass through storage.
 * Browsers without Web Locks retain only same-realm coordination.
 */
export function createRefreshCoordinator(baseURL: string) {
  const origin = new URL(
    baseURL,
    globalThis.location?.href ?? 'http://localhost',
  ).origin;
  const name = `vben:refresh:${origin}`;

  return async <T>(refresh: () => Promise<T>): Promise<T> => {
    const locks = globalThis.navigator?.locks;
    if (locks) {
      const controller = new AbortController();
      // Bound acquisition only. The HTTP client controls the request timeout.
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await locks.request(
          name,
          { mode: 'exclusive', signal: controller.signal },
          () => refresh(),
        );
      } finally {
        clearTimeout(timer);
      }
    }

    const previous = pending.get(name) ?? Promise.resolve();
    const result = previous.then(refresh);
    const tail = result.then(
      () => {},
      () => {},
    );
    pending.set(name, tail);
    try {
      return await result;
    } finally {
      if (pending.get(name) === tail) pending.delete(name);
    }
  };
}
