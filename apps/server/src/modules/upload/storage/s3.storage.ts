import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertSafeObjectKey } from './object-key';
import type {
  PutObjectInput,
  PutObjectResult,
  StorageProvider,
} from './storage.types';

@Injectable()
export class S3StorageProvider implements StorageProvider, OnModuleInit {
  readonly driver = 's3' as const;
  private readonly logger = new Logger(S3StorageProvider.name);
  private client!: S3Client;
  private bucket!: string;
  private publicBaseUrl!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const region = this.config.get<string>('S3_REGION') ?? 'us-east-1';
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const forcePathStyle =
      this.config.get<boolean>('S3_FORCE_PATH_STYLE') ?? true;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const explicit = this.config.get<string>('S3_PUBLIC_URL')?.replace(/\/$/, '');
    if (explicit) {
      this.publicBaseUrl = explicit;
    } else if (endpoint) {
      this.publicBaseUrl = `${endpoint.replace(/\/$/, '')}/${bucket}`;
    } else {
      this.publicBaseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
    }

    this.logger.log(
      `S3 storage ready: bucket=${bucket} endpoint=${endpoint || 'aws-default'}`,
    );
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const safeKey = assertSafeObjectKey(input.key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: safeKey,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    } catch (err) {
      this.logger.error(`S3 put failed: ${String(err)}`);
      throw new ServiceUnavailableException('Object storage unavailable');
    }
    return { url: `${this.publicBaseUrl}/${safeKey}` };
  }
}
