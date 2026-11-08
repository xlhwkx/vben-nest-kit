import type { MenuFormValues } from '../../src/views/system/menu/modules/menu-form';

import { describe, expect, it } from 'vitest';

import {
  decodeMenuFormValues,
  encodeMenuFormValues,
} from '../../src/views/system/menu/modules/menu-form';

const base: MenuFormValues = {
  name: 'Example',
  path: '/example',
  type: 'menu',
  status: 0,
  component: '/system/user/list',
  meta: { activePath: '/system/dict', order: 9997 },
};

describe('menu editor API contract', () => {
  it('round-trips nested active path, disabled status and sort without mutating the row', () => {
    expect(encodeMenuFormValues(decodeMenuFormValues(base))).toEqual(base);
    expect(base.meta).toEqual({ activePath: '/system/dict', order: 9997 });
  });

  it('assigns the iframe layout and removes stale external-link metadata', () => {
    const result = encodeMenuFormValues({
      ...base,
      type: 'embedded',
      linkSrc: 'https://example.test/frame',
      meta: { ...base.meta, link: 'https://old.test' },
    });
    expect(result).toMatchObject({
      component: 'IFrameView',
      meta: {
        iframeSrc: 'https://example.test/frame',
        activePath: '/system/dict',
      },
    });
    expect(result.meta).not.toHaveProperty('link');
    expect(result).not.toHaveProperty('linkSrc');
    expect(decodeMenuFormValues(result).linkSrc).toBe(
      'https://example.test/frame',
    );
  });

  it('preserves a link route path and clears a previously selected page component', () => {
    const result = encodeMenuFormValues({
      ...base,
      type: 'link',
      linkSrc: 'https://example.test',
      meta: { iframeSrc: 'https://old.test' },
    });
    expect(result).toMatchObject({ path: '/example', component: null });
    expect(result.meta).toEqual({ link: 'https://example.test' });
  });

  it('emits the required empty path for buttons and clears stale page components', () => {
    const result = encodeMenuFormValues({ ...base, type: 'button' });
    expect(result).toMatchObject({ path: '', component: null, status: 0 });
  });
});
