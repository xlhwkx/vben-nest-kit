/** URL configuration is never inferred from client-controlled Host/proxy headers. */
export function httpUrl(value: string): URL | undefined {
  try {
    if (!/^https?:\/\//i.test(value)) return;
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname.includes('*')
    )
      return;
    return url;
  } catch {
    return;
  }
}

export function httpOrigin(value: string): string | undefined {
  const url = httpUrl(value);
  if (!url || url.pathname !== '/' || url.search || url.hash) return;
  return url.origin;
}
