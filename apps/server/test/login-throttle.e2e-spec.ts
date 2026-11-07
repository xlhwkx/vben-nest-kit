import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { appFixture } from './app-fixture';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('login handler throttle across route aliases (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    Object.assign(process.env, {
      THROTTLE_STORAGE: 'memory',
      THROTTLE_LIMIT: '10000',
      THROTTLE_LOGIN_LIMIT: '1',
      AUTH_FAIL_USER_MAX: '1000',
      AUTH_FAIL_IP_MAX: '10000',
      CAPTCHA_REQUIRED: 'false',
    });
    const fixture = await appFixture();
    app = fixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterAll(async () => app?.close());

  it('shares the login budget across casing, query strings, trailing slashes and versioned aliases', async () => {
    const payload = { username: 'route_policy_missing', password: 'incorrect' };
    const first = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(payload)
      .expect(403);
    expect(first.headers['set-cookie']).toBeUndefined();
    for (const url of [
      '/api/Auth/Login',
      '/API/AUTH/LOGIN/',
      '/api/auth/login?attempt=2',
      '/api/v1/auth/login',
      '/api/v1/Auth/Login/',
    ]) {
      await request(app.getHttpServer()).post(url).send(payload).expect(429);
    }
    await request(app.getHttpServer()).post('/api/auth/logout').expect(200);
  });
});
