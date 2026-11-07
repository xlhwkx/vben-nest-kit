import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { parseRequest } from './request-validation';

export const editVersionSchema = z.number().int().min(1).max(2_147_483_647);

/** The conditional UPDATE must claim the row before changing any related grants. */
export function parseEditVersion(version: unknown): number {
  return parseRequest(editVersionSchema, version);
}

export function assertEditClaim(count: number): void {
  if (count !== 1) {
    const message = '记录已被修改，请刷新后重新编辑（Record changed; reload before editing）';
    throw new ConflictException({ message, error: message });
  }
}
