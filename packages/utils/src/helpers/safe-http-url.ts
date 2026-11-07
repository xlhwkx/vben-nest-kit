/** No relative, script, data, credential-bearing or control-character URLs. */
export function safeHttpUrl(value: unknown): string | undefined {
  // oxlint-disable-next-line eslint/no-control-regex -- Reject control characters in untrusted iframe URLs.
  if (typeof value !== 'string' || /[\u0000-\u0020\u007F]/u.test(value)) return;
  try {
    const url = new URL(value);
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    ) {
      return url.href;
    }
  } catch {
    // Untrusted route metadata is not a URL.
  }
}
