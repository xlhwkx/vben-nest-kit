import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';
import { int32Schema, parseRequest } from './request-validation';

export function isHttpUrl(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex -- Reject control characters before URL normalization.
  if (typeof value !== 'string' || /[\u0000-\u0020\u007F]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .max(2048)
  .refine(isHttpUrl, 'Only absolute HTTP(S) URLs are allowed');

// Preserve extension fields while validating fields consumed by the Vben layout.
export const menuMetaSchema = z
  .object({
    order: int32Schema.optional(),
    title: z.string().max(256).optional(),
    icon: z.string().max(256).optional(),
    activeIcon: z.string().max(256).optional(),
    activePath: z.string().max(255).optional(),
    affixTabOrder: int32Schema.optional(),
    iframeSrc: httpUrlSchema.optional(),
    link: httpUrlSchema.optional(),
    authority: z.array(z.string().max(128)).max(1000).optional(),
    badge: z.string().max(128).optional(),
    badgeType: z.enum(['dot', 'normal']).optional(),
    badgeVariants: z.enum(['default', 'destructive', 'primary', 'success', 'warning']).optional(),
    keepAlive: z.boolean().optional(),
    affixTab: z.boolean().optional(),
    hideInMenu: z.boolean().optional(),
    hideChildrenInMenu: z.boolean().optional(),
    hideInTab: z.boolean().optional(),
    hideInBreadcrumb: z.boolean().optional(),
    noBasicLayout: z.boolean().optional(),
    openInNewWindow: z.boolean().optional(),
    maxNumOfOpenTab: z.number().int().min(0).max(1000).optional(),
    menuVisibleWithForbidden: z.boolean().optional(),
  })
  .catchall(z.unknown());

export function validateMenuMeta(meta: unknown, type: string): Record<string, unknown> {
  const parsed = parseRequest(menuMetaSchema, meta ?? {});
  if (parsed.iframeSrc && type !== 'embedded') {
    throw new BadRequestException('iframeSrc is only allowed for embedded menus');
  }
  if (parsed.link && type !== 'link') {
    throw new BadRequestException('link is only allowed for link menus');
  }
  if (type === 'embedded' && !parsed.iframeSrc) {
    throw new BadRequestException('Embedded menus require an HTTP(S) iframeSrc');
  }
  if (type === 'link' && !parsed.link) {
    throw new BadRequestException('Link menus require an HTTP(S) link');
  }
  return parsed;
}

/** Also protect clients consuming legacy rows, without changing stored data. */
export function safeMenuMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const result = { ...meta } as Record<string, unknown>;
  for (const key of ['iframeSrc', 'link']) {
    if (key in result && !isHttpUrl(result[key])) delete result[key];
  }
  return result;
}
