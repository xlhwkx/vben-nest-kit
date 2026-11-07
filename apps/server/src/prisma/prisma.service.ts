import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({
      connectionString: url,
      max: config.get<number>('DATABASE_POOL_MAX') ?? 10,
      connectionTimeoutMillis: config.get<number>('DATABASE_CONNECT_TIMEOUT_MS') ?? 3000,
      statement_timeout: config.get<number>('DATABASE_STATEMENT_TIMEOUT_MS') ?? 15_000,
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
