import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaptchaService } from './captcha.service';
import { CAPTCHA_E2E_BYPASS_TOKEN } from './captcha.types';
import type { RedisService } from '../../../redis/redis.service';

function mockConfig(map: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => map[key],
  } as unknown as ConfigService;
}

function mockRedis(store: Map<string, string>): RedisService {
  return {
    getDelStrict: (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return Promise.resolve(value);
    },
    setStrict: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
  } as unknown as RedisService;
}

function withEnv(
  flags: { required?: boolean; bypass?: boolean },
  fn: () => void | Promise<void>,
): Promise<void> {
  const prevReq = process.env.CAPTCHA_REQUIRED;
  const prevBypass = process.env.CAPTCHA_E2E_BYPASS;
  process.env.CAPTCHA_REQUIRED = flags.required ? 'true' : 'false';
  process.env.CAPTCHA_E2E_BYPASS = flags.bypass ? 'true' : 'false';
  return Promise.resolve(fn()).finally(() => {
    if (prevReq === undefined) delete process.env.CAPTCHA_REQUIRED;
    else process.env.CAPTCHA_REQUIRED = prevReq;
    if (prevBypass === undefined) delete process.env.CAPTCHA_E2E_BYPASS;
    else process.env.CAPTCHA_E2E_BYPASS = prevBypass;
  });
}

describe('captchaService', () => {
  it('bypass: assertLoginCaptcha always passes', async () => {
    await withEnv({ required: true, bypass: true }, async () => {
      const svc = new CaptchaService(mockConfig({}), mockRedis(new Map()));
      await expect(svc.assertLoginCaptcha({})).resolves.toBeUndefined();
      const ch = await svc.issueChallenge();
      expect(ch.captchaToken).toBe(CAPTCHA_E2E_BYPASS_TOKEN);
    });
  });

  it('required off: assertLoginCaptcha passes without token', async () => {
    await withEnv({ required: false, bypass: false }, async () => {
      const svc = new CaptchaService(mockConfig({}), mockRedis(new Map()));
      await expect(svc.assertLoginCaptcha({})).resolves.toBeUndefined();
    });
  });

  it('required on: rejects missing token', async () => {
    await withEnv({ required: true, bypass: false }, async () => {
      const svc = new CaptchaService(mockConfig({}), mockRedis(new Map()));
      await expect(svc.assertLoginCaptcha({})).rejects.toMatchObject({
        response: {
          message: 'Captcha is required',
          error: 'Captcha is required',
        },
      });
    });
  });

  it('required on: issue + assert succeeds once then fails', async () => {
    await withEnv({ required: true, bypass: false }, async () => {
      const store = new Map<string, string>();
      const svc = new CaptchaService(mockConfig({}), mockRedis(store));
      const ch = await svc.issueChallenge();
      await expect(
        svc.assertLoginCaptcha({
          captchaId: ch.captchaId,
          captchaToken: ch.captchaToken,
        }),
      ).resolves.toBeUndefined();
      await expect(
        svc.assertLoginCaptcha({
          captchaId: ch.captchaId,
          captchaToken: ch.captchaToken,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('required on: rejects e2e-bypass token when bypass env off', async () => {
    await withEnv({ required: true, bypass: false }, async () => {
      const svc = new CaptchaService(mockConfig({}), mockRedis(new Map()));
      await expect(
        svc.assertLoginCaptcha({
          captchaId: 'x',
          captchaToken: CAPTCHA_E2E_BYPASS_TOKEN,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('allows only one concurrent consumer of the same challenge', async () => {
    await withEnv({ required: true, bypass: false }, async () => {
      const svc = new CaptchaService(mockConfig({}), mockRedis(new Map()));
      const challenge = await svc.issueChallenge();
      const results = await Promise.allSettled([
        svc.assertLoginCaptcha(challenge),
        svc.assertLoginCaptcha(challenge),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    });
  });

  it('reports storage failures as unavailable when issuing or consuming a challenge', async () => {
    await withEnv({ required: true, bypass: false }, async () => {
      const svc = new CaptchaService(mockConfig({}), {
        setStrict: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
        getDelStrict: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      } as never);
      await expect(svc.issueChallenge()).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        svc.assertLoginCaptcha({ captchaId: 'ticket', captchaToken: 'token' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
