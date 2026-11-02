import { BadRequestException } from '@nestjs/common';
import * as path from 'node:path';

/**
 * Normalize and reject unsafe object keys before joining under a storage root.
 * Blocks `..`, absolute paths, null bytes, and empty / `.` segments.
 */
export function assertSafeObjectKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new BadRequestException('Invalid object key');
  }
  if (key.includes('\0')) {
    throw new BadRequestException('Invalid object key');
  }
  const normalized = key.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new BadRequestException('Invalid object key');
  }
  const segments = normalized.split('/');
  if (
    segments.length === 0 ||
    segments.some((s) => s === '' || s === '.' || s === '..')
  ) {
    throw new BadRequestException('Invalid object key');
  }
  return normalized;
}

/** Join `key` under `root`; throw if the resolved path escapes the root. */
export function resolveUnderRoot(root: string, key: string): string {
  const safeKey = assertSafeObjectKey(key);
  const rootResolved = path.resolve(root);
  const abs = path.resolve(rootResolved, ...safeKey.split('/'));
  const rel = path.relative(rootResolved, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new BadRequestException('Invalid object key');
  }
  return abs;
}
