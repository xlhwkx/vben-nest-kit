import { parseListCreatedAtRange } from './parse-list-time-range';

describe('parseListCreatedAtRange', () => {
  it('treats YYYY-MM-DD as Asia/Shanghai calendar day bounds (not UTC)', () => {
    const range = parseListCreatedAtRange('2024-01-01', '2024-01-31');
    // 2024-01-01 00:00:00+08 → 2023-12-31T16:00:00.000Z
    expect(range?.gte?.toISOString()).toBe('2023-12-31T16:00:00.000Z');
    // 2024-01-31 23:59:59.999+08 → 2024-01-31T15:59:59.999Z
    expect(range?.lte?.toISOString()).toBe('2024-01-31T15:59:59.999Z');
  });

  it('maps a single Shanghai day that straddles UTC midnight', () => {
    const range = parseListCreatedAtRange('2024-06-15', '2024-06-15');
    expect(range?.gte?.toISOString()).toBe('2024-06-14T16:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2024-06-15T15:59:59.999Z');
  });

  it('passes through full ISO timestamps', () => {
    const range = parseListCreatedAtRange('2024-01-01T08:00:00.000Z', '2024-01-01T09:00:00.000Z');
    expect(range?.gte?.toISOString()).toBe('2024-01-01T08:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2024-01-01T09:00:00.000Z');
  });

  it('returns undefined when both empty', () => {
    expect(parseListCreatedAtRange()).toBeUndefined();
    expect(parseListCreatedAtRange('', '')).toBeUndefined();
  });
});
