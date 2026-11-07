import { maintainData, parseRetentionArgs } from './data-retention';

describe('explicit bounded retention options', () => {
  it('defaults to preview with finite batch limits and an explicit target/cutoff', () => {
    expect(
      parseRetentionArgs(['--target=sessions', '--before=2001-01-01T00:00:00Z']),
    ).toMatchObject({
      target: 'sessions',
      apply: false,
      batchSize: 500,
      maxBatches: 20,
    });
  });
  it.each(
    [
      [],
      ['--target=audit'],
      ['--target=users', '--before=2001-01-01T00:00:00Z'],
      ['--target=audit', '--before=2001-02-30T00:00:00Z'],
      ['--target=audit', '--before=2001-01-01'],
      ['--target=audit', '--before=2001-01-01T00:00:00Z', '--unknown=x'],
      ['--target=audit', '--target=audit', '--before=2001-01-01T00:00:00Z'],
      ['--target=audit', '--before=2001-01-01T00:00:00Z', '--batch-size=1.5'],
    ].map((args) => ({ args })),
  )('rejects ambiguous arguments %j', ({ args }) => {
    expect(() => parseRetentionArgs(args)).toThrow();
  });
  it.each([
    { before: new Date('2999-01-01') },
    { batchSize: 0 },
    { batchSize: 5001 },
    { maxBatches: 101 },
  ])('rejects unsafe limits before accessing the database %j', async (override) => {
    const options = {
      ...parseRetentionArgs(['--target=audit', '--before=2001-01-01T00:00:00Z']),
      ...override,
    };
    await expect(maintainData({} as never, options)).rejects.toThrow('Invalid retention options');
  });
});
