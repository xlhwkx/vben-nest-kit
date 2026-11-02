import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { UploadService } from './upload.service';

/** Align multer hard ceiling with UPLOAD_MAX_BYTES (default 5 MiB). */
function uploadMaxBytes(): number {
  const n = Number(process.env.UPLOAD_MAX_BYTES ?? 5_242_880);
  return Number.isFinite(n) && n > 0 ? n : 5_242_880;
}

@ApiTags('Upload')
@ApiBearerAuth('Bearer')
@Controller({ path: 'upload', version: [VERSION_NEUTRAL, '1'] })
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: uploadMaxBytes(),
        files: 1,
      },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.uploads.save(file);
  }
}
