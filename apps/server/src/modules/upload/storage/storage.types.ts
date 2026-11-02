export type StorageDriver = 'local' | 's3';

export interface PutObjectInput {
  /** Relative object key, e.g. 2026/11/uuid.png */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  /** Public URL returned to clients (contract: data.url). */
  url: string;
}

/**
 * Strategy for where upload bytes land (tech plan §10).
 * Default implementation is local disk; S3-compatible is optional.
 */
export interface StorageProvider {
  readonly driver: StorageDriver;
  put(input: PutObjectInput): Promise<PutObjectResult>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
