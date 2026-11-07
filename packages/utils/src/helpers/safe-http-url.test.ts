import { describe, expect, it } from 'vitest';

import { safeHttpUrl } from './safe-http-url';

describe('iframe URL filtering, including persisted route metadata', () => {
  it.each([
    undefined,
    {},
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,hello',
    '//example.test',
    '/relative',
    'https://user:pass@example.test',
    ' https://example.test',
  ])('does not render unsafe URL %s', (input) => {
    expect(safeHttpUrl(input)).toBeUndefined();
  });
  it('preserves legitimate absolute URLs', () => {
    expect(safeHttpUrl('HTTPS://example.test/app?a=1#tab')).toBe(
      'https://example.test/app?a=1#tab',
    );
    expect(safeHttpUrl('http://localhost:5666/')).toBe(
      'http://localhost:5666/',
    );
  });
});
