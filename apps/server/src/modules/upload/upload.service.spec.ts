jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { BadRequestException } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { UploadService } from './upload.service';

describe('upload content validation', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=',
    'base64',
  );
  function fixture() {
    const storage = {
      driver: 'test',
      put: jest.fn().mockResolvedValue({ url: '/file' }),
    };
    const service = new UploadService(
      { get: () => undefined } as never,
      { record: jest.fn() } as never,
      storage as never,
    );
    service.onModuleInit();
    return { service, storage };
  }
  function file(buffer: Buffer, mimetype: string) {
    return {
      buffer,
      size: buffer.length,
      mimetype,
      originalname: 'upload.bin',
    } as Express.Multer.File;
  }
  function zipEntry(content: Buffer, declaredSize = content.length) {
    const name = Buffer.from('[Content_Types].xml');
    const compressed = deflateRawSync(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04_03_4b_50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(declaredSize, 22);
    header.writeUInt16LE(name.length, 26);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06_05_4b_50);
    return Buffer.concat([header, name, compressed, end]);
  }
  it.each([undefined, 64])(
    'bounds ZIP content-type decoding even with declared size %s',
    async (declaredSize) => {
      const { service, storage } = fixture();
      const buffer = zipEntry(Buffer.alloc(8 * 1024 * 1024, 32), declaredSize);
      expect(buffer.length).toBeLessThan(10_000);
      const decode = jest.spyOn(TextDecoder.prototype, 'decode');
      try {
        await expect(service.save(file(buffer, 'application/zip'))).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(storage.put).not.toHaveBeenCalled();
        const largestDecoded = Math.max(
          0,
          ...decode.mock.calls.map(([input]) => input?.byteLength ?? 0),
        );
        expect(largestDecoded).toBeLessThanOrEqual(1024 * 1024);
      } finally {
        decode.mockRestore();
      }
    },
  );
  it('still detects a small Office content-type entry', async () => {
    const { service, storage } = fixture();
    const content = Buffer.from(
      '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    await expect(
      service.save(
        file(
          zipEntry(content),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ),
    ).resolves.toEqual({ url: '/file' });
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
  it('stores valid PNG bytes and rejects a forged MIME before storage', async () => {
    const { service, storage } = fixture();
    await expect(service.save(file(png, 'image/png'))).resolves.toEqual({
      url: '/file',
    });
    await expect(service.save(file(png, 'application/pdf'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated PNG content before storage', async () => {
    const { service, storage } = fixture();
    await expect(service.save(file(png.subarray(0, 12), 'image/png'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('terminates parsing a malformed ASF object with zero length (bounded child process)', () => {
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const { fileTypeFromBuffer } = require('file-type');
      const b = Buffer.alloc(54);
      Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex').copy(b);
      b.writeBigUInt64LE(54n, 16); b.writeUInt32LE(1, 24); b[28] = 1; b[29] = 2;
      const original = Buffer.alloc(64);
      Buffer.from('3026b2758e66cf11a6d9', 'hex').copy(original);
      Promise.all([b, original].map(buffer => fileTypeFromBuffer(buffer).catch(() => undefined)))
        .then(() => process.exit(0), () => process.exit(1));
    `,
      ],
      { cwd: process.cwd(), timeout: 5000, encoding: 'utf8' },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });
});
