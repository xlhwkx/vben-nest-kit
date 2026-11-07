import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { S3StorageProvider } from './s3.storage';

/** Real AWS SDK over HTTP, with a local object-store protocol fixture (not a cloud S3 test). */
describe('s3 HTTP transport and timeout', () => {
  let server: http.Server;
  let provider: S3StorageProvider;
  let endpoint: string;
  let stall = false;
  let signed = false;
  const objects = new Map<string, Buffer>();
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const key = (req.url ?? '').split('?')[0];
      if (req.method === 'PUT') {
        signed = req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ?? false;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          if (stall) return;
          objects.set(key, Buffer.concat(chunks));
          res.writeHead(200, { ETag: '"fixture-etag"' }).end();
        });
        return;
      }
      const body = objects.get(key);
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/plain' }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    stall = false;
    signed = false;
    provider = new S3StorageProvider(
      new ConfigService({
        S3_ENDPOINT: endpoint,
        S3_BUCKET: 'fixture-bucket',
        S3_ACCESS_KEY_ID: 'fixture-id',
        S3_SECRET_ACCESS_KEY: 'fixture-secret',
        S3_FORCE_PATH_STYLE: true,
        S3_UPLOAD_TIMEOUT_MS: 150,
      }),
    );
    provider.onModuleInit();
  });
  afterEach(() => {
    provider.onModuleDestroy();
    objects.clear();
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('uploads signed requests and returns a URL that reads the stored bytes', async () => {
    const body = Buffer.from('protocol fixture payload');
    const result = await provider.put({
      key: '2026/11/test.txt',
      body,
      contentType: 'text/plain',
    });
    expect(result.url).toBe(`${endpoint}/fixture-bucket/2026/11/test.txt`);
    expect(signed).toBe(true);
    const response = await fetch(result.url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });
  it('aborts a stalled upstream instead of occupying an upload slot indefinitely', async () => {
    stall = true;
    await expect(
      provider.put({
        key: 'stall.txt',
        body: Buffer.from('test'),
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(objects.size).toBe(0);
  });
});
