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
import type { Express } from 'express';
import { UploadService } from './upload.service';

@ApiTags('Upload')
@ApiBearerAuth('Bearer')
@Controller({ path: 'upload', version: [VERSION_NEUTRAL, '1'] })
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  /** Limits come from MulterModule.registerAsync (ConfigService UPLOAD_MAX_BYTES). */
  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.uploads.save(file);
  }
}
