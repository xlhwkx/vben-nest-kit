import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Express } from 'express';
import { fromBuffer } from 'file-type';
import { AuditService } from '../audit/audit.service';

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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
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
  private uploadDir!: string;
  private publicPath!: string;
  private publicBaseUrl!: string;
  private maxBytes!: number;
  private allowedMimes!: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

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
    this.maxBytes = Number(
      this.config.get<number>('UPLOAD_MAX_BYTES') ?? 5_242_880,
    );
    const rawAllow = this.config.get<string>('UPLOAD_ALLOWED_MIME');
    this.allowedMimes = rawAllow
      ? new Set(
          rawAllow
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : DEFAULT_ALLOWED;

    await fs.mkdir(this.uploadDir, { recursive: true });
    this.logger.log(`Upload dir ready: ${this.uploadDir}`);
  }

  getUploadDir(): string {
    return this.uploadDir;
  }

  getPublicPath(): string {
    return this.publicPath;
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
    const detected = await fromBuffer(file.buffer);

    if (detected?.mime) {
      const real = normalizeMime(detected.mime);
      if (claimed && claimed !== real) {
        throw new BadRequestException(
          'File content does not match Content-Type',
        );
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
        throw new BadRequestException(
          'File content does not match Content-Type',
        );
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
      throw new PayloadTooLargeException(
        `File too large (max ${this.maxBytes} bytes)`,
      );
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
    const relDir = path.posix.join(yyyy, mm);
    const absDir = path.join(this.uploadDir, yyyy, mm);
    await fs.mkdir(absDir, { recursive: true });

    const absFile = path.join(absDir, name);
    await fs.writeFile(absFile, file.buffer, { flag: 'wx' });

    const sha = createHash('sha256')
      .update(file.buffer)
      .digest('hex')
      .slice(0, 12);
    this.logger.debug(`saved ${relDir}/${name} sha256=${sha} mime=${mime}`);

    const urlPath = `${this.publicPath}/${relDir}/${name}`;
    const url = `${this.publicBaseUrl}${urlPath}`;
    this.audit.record({
      action: 'upload.create',
      module: 'upload',
      status: 200,
      detail: { mime, name: `${relDir}/${name}` },
    });
    return { url };
  }
}
