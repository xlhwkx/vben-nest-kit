import type { ResolvedConfig } from 'vite';

import { describe, expect, it, vi } from 'vitest';

import {
  FORM_FIELD_SLOT_MIGRATION_WARNING,
  viteFormFieldSlotMigrationWarningPlugin,
} from './form-field-slot-migration-warning';

describe('form field slot migration warning plugin', () => {
  it('warns in serve mode and injects the same browser message', () => {
    const plugin = viteFormFieldSlotMigrationWarningPlugin();
    const warning = vi.fn();

    expect(plugin.apply).toBe('serve');
    expect(plugin.configResolved).toBeTypeOf('function');
    if (typeof plugin.configResolved !== 'function') return;

    plugin.configResolved.call(
      undefined as never,
      { logger: { warn: warning } } as unknown as ResolvedConfig,
    );

    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(FORM_FIELD_SLOT_MIGRATION_WARNING);
    expect(plugin.transformIndexHtml).toBeTypeOf('function');
    if (typeof plugin.transformIndexHtml !== 'function') return;

    const result = plugin.transformIndexHtml.call(
      undefined as never,
      '',
      {} as never,
    );

    expect(result).toEqual([
      {
        attrs: {
          'data-vben-form-field-slot-migration-warning': '',
        },
        children: `console.warn(${JSON.stringify(FORM_FIELD_SLOT_MIGRATION_WARNING)});`,
        injectTo: 'body',
        tag: 'script',
      },
    ]);
    expect(FORM_FIELD_SLOT_MIGRATION_WARNING).toContain('`v-bind="slotProps"`');
    expect(FORM_FIELD_SLOT_MIGRATION_WARNING).toContain(
      '`v-bind="slotProps.componentProps"`',
    );
  });
});
