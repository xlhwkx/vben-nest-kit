import type { PrismaClient } from '../generated/prisma/client';

export type RetentionOptions = {
  target: 'sessions' | 'audit';
  before: Date;
  apply: boolean;
  batchSize: number;
  maxBatches: number;
};

/** Explicit cutoffs only. Never delete a refresh row solely because it was revoked:
 * a still-unexpired ancestor can be used to log out its entire rotated family. */
export async function maintainData(prisma: PrismaClient, options: RetentionOptions) {
  if (
    !['sessions', 'audit'].includes(options.target) ||
    !Number.isFinite(options.before.getTime()) ||
    options.before.getTime() > Date.now() ||
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 5000 ||
    !Number.isInteger(options.maxBatches) ||
    options.maxBatches < 1 ||
    options.maxBatches > 100
  ) {
    throw new Error(
      'Invalid retention options: past cutoff, batch size 1–5000, max batches 1–100 required',
    );
  }
  const eligibleAtStart =
    options.target === 'sessions'
      ? await prisma.refreshToken.count({
          where: { expiresAt: { lt: options.before } },
        })
      : await prisma.auditLog.count({
          where: { createdAt: { lt: options.before } },
        });
  let deleted = 0;
  let batches = 0;
  if (options.apply) {
    for (; batches < options.maxBatches;) {
      const count = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '1s'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
          const rows =
            options.target === 'sessions'
              ? await tx.$queryRaw<{ id: string }[]>`
            WITH candidates AS (
              SELECT id FROM refresh_tokens WHERE expires_at < ${options.before}
              ORDER BY expires_at, id LIMIT ${options.batchSize} FOR UPDATE SKIP LOCKED
            ) DELETE FROM refresh_tokens t USING candidates c WHERE t.id = c.id RETURNING t.id`
              : await tx.$queryRaw<{ id: string }[]>`
            WITH candidates AS (
              SELECT id FROM audit_logs WHERE created_at < ${options.before}
              ORDER BY created_at, id LIMIT ${options.batchSize} FOR UPDATE SKIP LOCKED
            ) DELETE FROM audit_logs t USING candidates c WHERE t.id = c.id RETURNING t.id`;
          return rows.length;
        },
        { maxWait: 3000, timeout: 10_000 },
      );
      batches++;
      deleted += count;
      if (count < options.batchSize) break;
    }
  }
  return {
    target: options.target,
    before: options.before.toISOString(),
    apply: options.apply,
    eligibleAtStart,
    deleted,
    batches,
    maxRowsThisRun: options.batchSize * options.maxBatches,
  };
}

export function parseRetentionArgs(args: string[]): RetentionOptions {
  const values = new Map<string, string>();
  for (const arg of args) {
    if (arg === '--apply') {
      if (values.has('apply')) throw new Error('Duplicate --apply');
      values.set('apply', 'true');
      continue;
    }
    const match = /^--(target|before|batch-size|max-batches)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]))
      throw new Error('Unknown or duplicate maintenance argument');
    values.set(match[1], match[2]);
  }
  const target = values.get('target');
  const before = values.get('before') ?? '';
  if (
    (target !== 'sessions' && target !== 'audit') ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(before)
  ) {
    throw new Error('Require --target=sessions|audit and --before=<UTC ISO timestamp>');
  }
  const date = new Date(before);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== before.slice(0, 19)) {
    throw new Error('Invalid cutoff calendar date');
  }
  for (const key of ['batch-size', 'max-batches']) {
    if (values.has(key) && !/^[1-9]\d*$/.test(values.get(key)!))
      throw new Error('Expected positive integral batch limits');
  }
  return {
    target,
    before: date,
    apply: values.has('apply'),
    batchSize: Number(values.get('batch-size') ?? 500),
    maxBatches: Number(values.get('max-batches') ?? 20),
  };
}
