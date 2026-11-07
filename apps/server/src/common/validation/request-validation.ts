import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Keep validation errors bounded and never include submitted values. */
export function parseRequest<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'BadRequestException',
      error: parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; '),
    });
  }
  return parsed.data;
}

/** Express's simple query parser leaves bracket syntax in the key itself. */
export function parseQuery<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  if (value && typeof value === 'object' && Object.keys(value).some((key) => /[[\]]/.test(key))) {
    throw new BadRequestException('Nested query parameters are not supported');
  }
  return parseRequest(schema, value);
}

export const uuidSchema = z
  .string()
  .trim()
  .uuid()
  .transform((id) => id.toLowerCase());
export const idArraySchema = z
  .array(uuidSchema)
  .max(1000)
  .transform((ids) => [...new Set(ids)]);
export const int32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Vben tree editors send several representations of the root node. */
export const parentIdSchema = z.union([
  uuidSchema,
  z.literal(0).transform(() => null),
  z.null(),
  z
    .string()
    .trim()
    .pipe(z.enum(['', '0', 'null', 'undefined']))
    .transform(() => null),
]);

/** Blank scalar filters mean absent; repeated/nested query values are rejected. */
export const optionalQueryText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const optionalQueryId = optionalQueryText(36).pipe(uuidSchema.optional());

export function optionalQueryEnum(values: number[]) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === '') return undefined;
      if (typeof value === 'string' && /^\d$/.test(value)) return Number(value);
      return value;
    },
    z
      .number()
      .int()
      .refine((value) => values.includes(value), 'Invalid filter value')
      .optional(),
  );
}
