import { BadRequestException } from '@nestjs/common';
import { menuMetaSchema, safeMenuMeta, validateMenuMeta } from './menu-meta';

describe('menu content boundary', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.test/',
    '/relative',
    ' https://example.test',
    'https://user:password@example.test',
  ])('rejects and suppresses unsafe URL %s', (value) => {
    expect(menuMetaSchema.safeParse({ iframeSrc: value }).success).toBe(false);
    expect(safeMenuMeta({ iframeSrc: value, link: value, title: 'Legacy' })).toEqual({
      title: 'Legacy',
    });
  });

  it('accepts explicit HTTP(S) URLs and validates known field types', () => {
    const meta = {
      iframeSrc: 'https://example.test/app?a=1#tab',
      keepAlive: false,
    };
    expect(validateMenuMeta(meta, 'embedded')).toEqual(meta);
    expect(menuMetaSchema.safeParse({ iframeSrc: {} }).success).toBe(false);
    expect(menuMetaSchema.safeParse({ keepAlive: 'false' }).success).toBe(false);
  });

  it('checks the menu type and URL combination', () => {
    expect(() => validateMenuMeta({ iframeSrc: 'https://example.test' }, 'menu')).toThrow(
      BadRequestException,
    );
    expect(() => validateMenuMeta({}, 'embedded')).toThrow(BadRequestException);
    expect(() => validateMenuMeta({}, 'link')).toThrow(BadRequestException);
    expect(validateMenuMeta({ link: 'https://example.test' }, 'link')).toEqual({
      link: 'https://example.test',
    });
  });
});
