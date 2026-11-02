import { parseListCreatedAtRange } from './parse-list-time-range';

describe('parseListCreatedAtRange', () => {
  it('treats YYYY-MM-DD endTime as inclusive end of UTC day', () => {
    const range = parseListCreatedAtRange('2024-01-01', '2024-01-31');
    expect(range?.gte?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(range?.lte?.toISOString()).toBe('2024-01-31T23:59:59.999Z');
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
