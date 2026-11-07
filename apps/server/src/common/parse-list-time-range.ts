import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const dateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

/**
 * Parse list startTime/endTime from playground date-range-codec (YYYY-MM-DD)
 * or full ISO/datetime strings. Date-only bounds use **Asia/Shanghai** calendar
 * days (UTC+8, no DST) so RangePicker Shanghai day filters match Nest filtering.
 * endTime date-only is inclusive through 23:59:59.999 in Shanghai.
 */
export function parseListCreatedAtRange(
  startTime?: string,
  endTime?: string,
): { gte?: Date; lte?: Date } | undefined {
  const out: { gte?: Date; lte?: Date } = {};
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  // Asia/Shanghai has no DST; fixed +08:00 is the calendar-day contract.
  const SHANGHAI_OFFSET = '+08:00';

  function bound(value: string | undefined, end: boolean): Date | undefined {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new BadRequestException('Invalid date filter');
    const raw = value.trim();
    if (!raw) return undefined;
    if (!dateSchema.safeParse(raw).success) {
      throw new BadRequestException('Use YYYY-MM-DD or an ISO timestamp with a timezone');
    }
    const t = dateOnly.test(raw)
      ? new Date(`${raw}T${end ? '23:59:59.999' : '00:00:00.000'}${SHANGHAI_OFFSET}`)
      : new Date(raw);
    if (!Number.isFinite(t.getTime())) throw new BadRequestException('Invalid date filter');
    return t;
  }

  const start = bound(startTime, false);
  const end = bound(endTime, true);
  if (start) out.gte = start;
  if (end) out.lte = end;
  if (start && end && start > end) {
    throw new BadRequestException('startTime must not be after endTime');
  }

  return out.gte || out.lte ? out : undefined;
}
