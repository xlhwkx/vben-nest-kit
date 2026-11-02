/**
 * Parse list startTime/endTime from playground date-range-codec (YYYY-MM-DD)
 * or full ISO/datetime strings. Date-only endTime is inclusive through end of
 * that UTC calendar day so RangePicker day filters are not cut at 00:00:00.
 */
export function parseListCreatedAtRange(
  startTime?: string,
  endTime?: string,
): { gte?: Date; lte?: Date } | undefined {
  const out: { gte?: Date; lte?: Date } = {};
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

  if (startTime?.trim()) {
    const raw = startTime.trim();
    const t = dateOnly.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
    if (!Number.isNaN(t.getTime())) out.gte = t;
  }

  if (endTime?.trim()) {
    const raw = endTime.trim();
    const t = dateOnly.test(raw) ? new Date(`${raw}T23:59:59.999Z`) : new Date(raw);
    if (!Number.isNaN(t.getTime())) out.lte = t;
  }

  return out.gte || out.lte ? out : undefined;
}
