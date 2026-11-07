jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { AuditService } from './audit.service';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../observability/metrics.service';
import { requestContextAls } from '../../common/request-context';

describe('audit durability and redaction', () => {
  it('bounds active + queued writes, counts overload and drains queued work', async () => {
    const releases: (() => void)[] = [];
    const create = jest.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const metrics = new MetricsService();
    const service = new AuditService(
      { auditLog: { create } } as never,
      new ConfigService({
        AUDIT_BACKGROUND_MAX_PENDING: 5,
        AUDIT_BACKGROUND_CONCURRENCY: 2,
      }),
      metrics,
    );
    for (let n = 0; n < 20; n++) service.record({ action: 'test' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(metrics.toPrometheus()).toContain('qingzhan_audit_background_pending 5');
    const transactionalCreate = jest.fn().mockResolvedValue({});
    await service.recordInTransaction({ auditLog: { create: transactionalCreate } } as never, {
      action: 'must-commit',
    });
    expect(transactionalCreate).toHaveBeenCalledTimes(1);
    expect(metrics.toPrometheus()).toContain(
      'qingzhan_audit_background_dropped_total{reason="capacity"} 15',
    );
    const flushed = service.flush(1000);
    service.record({ action: 'late' });
    for (let n = 0; n < 5; n++) {
      releases.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await flushed;
    expect(create).toHaveBeenCalledTimes(5);
    expect(metrics.toPrometheus()).toContain('qingzhan_audit_background_pending 0');
    expect(metrics.toPrometheus()).toContain(
      'qingzhan_audit_background_dropped_total{reason="shutdown"} 1',
    );
  });
  it('snapshots identity and sanitized detail before queued work changes async context', async () => {
    let release!: () => void;
    const create = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            release = done;
          }),
      )
      .mockResolvedValue({});
    const service = new AuditService(
      { auditLog: { create } } as never,
      new ConfigService({ AUDIT_BACKGROUND_CONCURRENCY: 1 }),
    );
    service.record({ action: 'blocking' });
    const detail = { name: 'original', nested: { password: 'never-store' } };
    requestContextAls.run({ requestId: 'alice-request', username: 'alice' }, () => {
      service.record({ action: 'queued', detail });
    });
    detail.name = 'modified';
    requestContextAls.run({ requestId: 'bob-request', username: 'bob' }, () => release());
    await service.flush(1000);
    const secondCall = create.mock.calls[1] as unknown[];
    expect(secondCall[0]).toMatchObject({
      data: {
        username: 'alice',
        requestId: 'alice-request',
        detail: { name: 'original', nested: {} },
      },
    });
  });
  it('continues after background failures and never rejects a caller', async () => {
    const metrics = new MetricsService();
    const create = jest.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue({});
    const service = new AuditService(
      { auditLog: { create } } as never,
      new ConfigService({ AUDIT_BACKGROUND_CONCURRENCY: 1 }),
      metrics,
    );
    service.record({ action: 'failed' });
    service.record({ action: 'next' });
    await service.flush(1000);
    expect(create).toHaveBeenCalledTimes(2);
    expect(metrics.toPrometheus()).toContain('qingzhan_audit_background_failed_total 1');
  });
  it('propagates transactional audit failure without a fallback write outside the transaction', async () => {
    const rootWrite = jest.fn();
    const service = new AuditService({
      auditLog: { create: rootWrite },
    } as never);
    const tx = {
      auditLog: {
        create: jest.fn().mockRejectedValue(new Error('storage failed')),
      },
    };
    await expect(
      service.recordInTransaction(tx as never, {
        action: 'system.role.update',
      }),
    ).rejects.toThrow('storage failed');
    expect(rootWrite).not.toHaveBeenCalled();
  });
  it('removes nested secrets in objects and arrays before persisting', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditService({ auditLog: { create } } as never);
    await service.recordInTransaction({ auditLog: { create } } as never, {
      action: 'test',
      detail: {
        name: 'kept',
        nested: {
          password: 'sensitive',
          values: [{ accessToken: 'sensitive', ok: true }],
        },
        apiKey: 'sensitive',
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: null,
        username: null,
        action: 'test',
        module: null,
        method: null,
        path: null,
        ip: null,
        userAgent: null,
        requestId: null,
        status: null,
        detail: { name: 'kept', nested: { values: [{ ok: true }] } },
      },
    });
  });
  it('waits for an outstanding background audit when drained', async () => {
    let release!: () => void;
    const create = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const service = new AuditService({ auditLog: { create } } as never);
    service.record({ action: 'auth.login_failed' });
    let flushed = false;
    const flushing = service.flush(1000).then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(flushed).toBe(true);
  });
  it('bounds draining if an audit write does not settle', async () => {
    const service = new AuditService({
      auditLog: { create: () => new Promise(() => {}) },
    } as never);
    service.record({ action: 'test' });
    await service.flush(5);
  });
});
