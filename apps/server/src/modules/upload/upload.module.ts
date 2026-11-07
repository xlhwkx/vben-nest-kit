import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { LocalStorageProvider } from './storage/local.storage';
import { S3StorageProvider } from './storage/s3.storage';
import { UploadCapacityInterceptor } from './upload-capacity.interceptor';
import { STORAGE_PROVIDER } from './storage/storage.types';
import type { StorageProvider } from './storage/storage.types';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Read after ConfigModule validate/load — not at decorator eval time.
        const n = Number(config.get<number>('UPLOAD_MAX_BYTES') ?? 5_242_880);
        const fileSize = Number.isFinite(n) && n > 0 ? n : 5_242_880;
        return {
          storage: memoryStorage(),
          limits: {
            fileSize,
            files: 1,
            fields: 0,
            parts: 1,
            fieldNameSize: 64,
            fieldSize: 0,
          },
        };
      },
    }),
  ],
  controllers: [UploadController],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageProvider => {
        const driver = config.get<string>('STORAGE_DRIVER') ?? 'local';
        // Only construct the selected driver so S3 env is not required when local.
        if (driver === 's3') {
          return new S3StorageProvider(config);
        }
        return new LocalStorageProvider(config);
      },
    },
    UploadService,
    UploadCapacityInterceptor,
  ],
  exports: [UploadService, STORAGE_PROVIDER],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class UploadModule {}
