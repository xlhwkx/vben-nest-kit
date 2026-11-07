import { Controller, Get, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DrainingExpressAdapter } from './draining-express.adapter';

describe('hTTP shutdown before dependency destruction', () => {
  it('completes an in-flight request before destroying its dependency', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    @Injectable()
    class Dependency implements OnModuleDestroy {
      destroyed = false;
      onModuleDestroy() {
        this.destroyed = true;
      }
    }
    @Controller()
    class SlowController {
      constructor(private readonly dependency: Dependency) {}
      @Get()
      async slow() {
        entered();
        await gate;
        if (this.dependency.destroyed) throw new Error('dependency closed before HTTP');
        return 'completed';
      }
    }
    @Module({ controllers: [SlowController], providers: [Dependency] })
    class TestModule {}
    const adapter = new DrainingExpressAdapter();
    const app = await NestFactory.create<NestExpressApplication>(TestModule, adapter, {
      logger: false,
      return503OnClosing: true,
    });
    await app.listen(0, '127.0.0.1');
    let destroyedDuringAuditDrain = true;
    adapter.afterHttpDrain = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      destroyedDuringAuditDrain = app.get(Dependency).destroyed;
    };
    try {
      const responsePromise = fetch(await app.getUrl()).then(async (res) => ({
        status: res.status,
        body: await res.text(),
      }));
      await started;
      const closing = app.close();
      // Let close enter beforeClose while the controller remains blocked.
      await new Promise((resolve) => setImmediate(resolve));
      expect(app.get(Dependency).destroyed).toBe(false);
      release();
      expect(await responsePromise).toEqual({ status: 200, body: 'completed' });
      await closing;
      expect(destroyedDuringAuditDrain).toBe(false);
      expect(app.get(Dependency).destroyed).toBe(true);
    } finally {
      release();
      await app.close();
    }
  });

  it('bounds shutdown when an HTTP connection never responds', async () => {
    const adapter = new DrainingExpressAdapter();
    adapter.drainTimeoutMs = 100;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    @Controller()
    class HangingController {
      @Get()
      async hang() {
        entered();
        await new Promise(() => {});
      }
    }
    @Module({ controllers: [HangingController] })
    class TestModule {}
    const app = await NestFactory.create<NestExpressApplication>(TestModule, adapter, {
      logger: false,
    });
    await app.listen(0, '127.0.0.1');
    const pending = fetch(await app.getUrl()).catch(() => undefined);
    await started;
    await app.close();
    await pending;
  });
});
