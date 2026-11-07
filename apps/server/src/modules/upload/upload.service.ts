import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { Express } from 'express';
import { fileTypeFromBuffer } from 'file-type';
import { AuditService } from '../audit/audit.service';
import { LocalStorageProvider } from './storage/local.storage';
import { STORAGE_PROVIDER } from './storage/storage.types';
import type { StorageProvider } from './storage/storage.types';

// SVG (image/svg+xml) omitted by default (XSS); allow via UPLOAD_ALLOWED_MIME.
const DEFAULT_ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

function normalizeMime(mime: string): string {
  const m = mime.toLowerCase().trim();
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private maxBytes!: number;
  private allowedMimes!: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  onModuleInit(): void {
    this.maxBytes = Number(this.config.get<number>('UPLOAD_MAX_BYTES') ?? 5_242_880);
    const rawAllow = this.config.get<string>('UPLOAD_ALLOWED_MIME');
    this.allowedMimes = rawAllow
      ? new Set(
          rawAllow
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : DEFAULT_ALLOWED;
    this.logger.log(`Upload storage driver: ${this.storage.driver}`);
  }

  /** Local disk root (static serving); empty string when not local. */
  getUploadDir(): string {
    if (this.storage instanceof LocalStorageProvider) {
      return this.storage.getUploadDir();
    }
    return '';
  }

  getPublicPath(): string {
    if (this.storage instanceof LocalStorageProvider) {
      return this.storage.getPublicPath();
    }
    return (this.config.get<string>('UPLOAD_PUBLIC_PATH') ?? '/uploads').replace(/\/$/, '');
  }

  getMaxBytes(): number {
    return this.maxBytes;
  }

  /**
   * Resolve real MIME via magic bytes (file-type).
   * Forged Content-Type (e.g. MZ + image/png) → 400.
   * text/plain has no reliable magic → allowed only when claimed + allowed.
   */
  private async resolveMime(file: Express.Multer.File): Promise<string> {
    const claimed = normalizeMime(file.mimetype || '');
    let detected;
    try {
      detected = await fileTypeFromBuffer(file.buffer);
    } catch {
      throw new BadRequestException('Invalid or truncated file content');
    }

    if (detected?.mime) {
      const real = normalizeMime(detected.mime);
      if (claimed && claimed !== real) {
        throw new BadRequestException('File content does not match Content-Type');
      }
      if (!this.allowedMimes.has(real)) {
        throw new BadRequestException('Unsupported file type');
      }
      return real;
    }

    // No magic signature: only permit explicit text/plain allow-list entry.
    if (claimed === 'text/plain' && this.allowedMimes.has('text/plain')) {
      // Reject obvious binary pretending to be text
      if (file.buffer.includes(0)) {
        throw new BadRequestException('File content does not match Content-Type');
      }
      return 'text/plain';
    }

    throw new BadRequestException('Unable to detect file type');
  }

  async save(file: Express.Multer.File): Promise<{ url: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }
    if (file.size > this.maxBytes) {
      throw new PayloadTooLargeException(`File too large (max ${this.maxBytes} bytes)`);
    }

    const mime = await this.resolveMime(file);

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const fromName = path
      .extname(file.originalname || '')
      .toLowerCase()
      .slice(0, 16);
    const ext = EXT_BY_MIME[mime] ?? (fromName || '');
    const safeExt = /^\.[a-z0-9.]+$/i.test(ext) ? ext : '';
    const name = `${randomUUID()}${safeExt}`;
    const key = `${yyyy}/${mm}/${name}`;

    const { url } = await this.storage.put({
      key,
      body: file.buffer,
      contentType: mime,
    });

    const sha = createHash('sha256').update(file.buffer).digest('hex').slice(0, 12);
    this.logger.debug(`saved ${key} sha256=${sha} mime=${mime}`);

    this.audit.record({
      action: 'upload.create',
      module: 'upload',
      status: 200,
      detail: { mime, name: key, driver: this.storage.driver },
    });
    return { url };
  }
}
