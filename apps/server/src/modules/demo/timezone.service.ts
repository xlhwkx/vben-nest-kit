import { BadRequestException, Injectable } from '@nestjs/common';

export type TimezoneOptionSource = {
  offset: number;
  timezone: string;
};

/** Align with backend-mock TIME_ZONE_OPTIONS / @vben-core DEFAULT_TIME_ZONE_OPTIONS. */
export const TIME_ZONE_OPTIONS: readonly TimezoneOptionSource[] = [
  { offset: -5, timezone: 'America/New_York' },
  { offset: 0, timezone: 'Europe/London' },
  { offset: 8, timezone: 'Asia/Shanghai' },
  { offset: 9, timezone: 'Asia/Tokyo' },
  { offset: 9, timezone: 'Asia/Seoul' },
] as const;

export type TimezoneOptionDto = {
  label: string;
  value: string;
};

function formatOffset(offset: number): string {
  return offset >= 0 ? `+${offset}` : `${offset}`;
}

@Injectable()
export class TimezoneService {
  /** Process-local like mock; null until setTimezone. */
  private current: string | null = null;

  getTimezone(): string | null {
    return this.current;
  }

  getTimezoneOptions(): TimezoneOptionDto[] {
    return TIME_ZONE_OPTIONS.map((o) => ({
      label: `${o.timezone} (GMT${formatOffset(o.offset)})`,
      value: o.timezone,
    }));
  }

  setTimezone(timezone: unknown): Record<string, never> {
    if (typeof timezone !== 'string' || !timezone.trim()) {
      throw new BadRequestException({
        message: 'Invalid timezone',
        error: 'Bad Request',
      });
    }
    const value = timezone.trim();
    const allowed = TIME_ZONE_OPTIONS.some((o) => o.timezone === value);
    if (!allowed) {
      throw new BadRequestException({
        message: 'Invalid timezone',
        error: 'Bad Request',
      });
    }
    this.current = value;
    return {};
  }

  /** Test helper — reset process-local state between unit cases. */
  resetForTests(): void {
    this.current = null;
  }
}
