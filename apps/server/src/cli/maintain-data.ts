import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { maintainData, parseRetentionArgs } from '../maintenance/data-retention';

async function main(): Promise<void> {
  const options = parseRetentionArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 3000,
      statement_timeout: 15_000,
    }),
  });
  try {
    console.log(JSON.stringify(await maintainData(prisma, options)));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  // Database errors may include credentials. Report only a static usage/failure message.
  console.error(
    'Maintenance failed. Check database availability and arguments: --target=sessions|audit --before=<past UTC ISO timestamp> [--apply] [--batch-size=500] [--max-batches=20]. Earlier batches may already have committed; rerunning is safe.',
  );
  process.exitCode = 1;
});
