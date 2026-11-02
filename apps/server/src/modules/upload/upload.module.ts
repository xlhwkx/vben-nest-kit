import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

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
          limits: { fileSize, files: 1 },
        };
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class UploadModule {}
