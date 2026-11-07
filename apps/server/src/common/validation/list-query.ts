import { z } from 'zod';

export const MAX_LIST_OFFSET = 1_000_000;

function positiveInteger(fallback: number, max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value === 'string' && /^\d{1,10}$/.test(value)) return Number(value);
    return value;
  }, z.number().int().min(1).max(max));
}

export const listQuerySchema = z.object({
  page: positiveInteger(1, MAX_LIST_OFFSET + 1),
  pageSize: positiveInteger(20, 100),
});

/** Apply after extending the object with the endpoint's own filter fields. */
export function withListOffsetLimit<T extends { page: number; pageSize: number }>(
  query: T,
): boolean {
  return (query.page - 1) * query.pageSize <= MAX_LIST_OFFSET;
}

export const listOffsetError = {
  message: `Pagination offset must not exceed ${MAX_LIST_OFFSET}`,
};
