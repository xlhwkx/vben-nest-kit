import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/common/config/env';

/** ConfigModule validation runs at import time; capture each fixture's actual settings. */
export function appFixture() {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(loadEnv(process.env)))
    .compile();
}
