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

  it('accepts leap days and explicit offsets with the same instant semantics', () => {
    expect(parseListCreatedAtRange('2024-02-29')?.gte?.toISOString()).toBe(
      '2024-02-28T16:00:00.000Z',
    );
    const range = parseListCreatedAtRange('2024-01-01T08:00:00+08:00', '2024-01-01T01:00:00Z');
    expect(range?.gte?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2024-01-01T01:00:00.000Z');
  });

  it('rejects silently normalized dates, ambiguous timestamps and inverted ranges', () => {
    for (const date of [
      '2023-02-29',
      '2024-02-30',
      '2024-13-01',
      '2024-01-01T00:00:00',
      '0',
      'tomorrow',
    ]) {
      expect(() => parseListCreatedAtRange(date)).toThrow();
    }
    expect(() => parseListCreatedAtRange('2024-02-01', '2024-01-31')).toThrow();
    expect(() =>
      parseListCreatedAtRange('2024-01-01T00:00:00Z', '2024-01-01T00:00:00+08:00'),
    ).toThrow();
  });
});
