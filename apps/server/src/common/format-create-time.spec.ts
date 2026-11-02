import { formatCreateTimeIso } from './format-create-time';

describe('formatCreateTimeIso', () => {
  it('returns ISO-8601 UTC with Z suffix', () => {
    const d = new Date('2024-06-15T08:30:00.123Z');
    expect(formatCreateTimeIso(d)).toBe('2024-06-15T08:30:00.123Z');
  });

  it('matches Date#toISOString', () => {
    const d = new Date();
    expect(formatCreateTimeIso(d)).toBe(d.toISOString());
  });
});
