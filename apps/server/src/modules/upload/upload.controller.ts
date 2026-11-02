import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Express } from "express";
import { UploadService } from "./upload.service";

@ApiTags("Upload")
@ApiBearerAuth("Bearer")
@Controller({ path: "upload", version: [VERSION_NEUTRAL, "1"] })
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: {
        // hard ceiling; service also enforces configured max
        fileSize: 20 * 1024 * 1024,
        files: 1,
      },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.uploads.save(file);
  }
}
