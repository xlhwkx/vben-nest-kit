import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { assertSafeObjectKey, resolveUnderRoot } from './object-key';
import type {
  PutObjectInput,
  PutObjectResult,
  StorageProvider,
} from './storage.types';

@Injectable()
export class LocalStorageProvider implements StorageProvider, OnModuleInit {
  readonly driver = 'local' as const;
  private readonly logger = new Logger(LocalStorageProvider.name);
  private uploadDir!: string;
  private publicPath!: string;
  private publicBaseUrl!: string;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.uploadDir = path.resolve(
      this.config.get<string>('UPLOAD_DIR') ??
        path.join(process.cwd(), 'uploads'),
    );
    this.publicPath = (
      this.config.get<string>('UPLOAD_PUBLIC_PATH') ?? '/uploads'
    ).replace(/\/$/, '');
    this.publicBaseUrl = (
      this.config.get<string>('APP_PUBLIC_URL') ?? 'http://localhost:5320'
    ).replace(/\/$/, '');
    await fs.mkdir(this.uploadDir, { recursive: true });
    this.logger.log(`Local storage ready: ${this.uploadDir}`);
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  getPublicPath(): string {
    return this.publicPath;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const safeKey = assertSafeObjectKey(input.key);
    const absFile = resolveUnderRoot(this.uploadDir, safeKey);
    await fs.mkdir(path.dirname(absFile), { recursive: true });
    await fs.writeFile(absFile, input.body, { flag: 'wx' });
    const urlPath = `${this.publicPath}/${safeKey}`;
    return { url: `${this.publicBaseUrl}${urlPath}` };
  }
}
