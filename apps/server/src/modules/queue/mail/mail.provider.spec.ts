import { ConfigService } from '@nestjs/config';
import { ConsoleMailProvider } from './console.mail';
import { SmtpMailProvider } from './smtp.mail';
import { redactEmail } from './mail.types';

describe('mail providers', () => {
  it('redactEmail masks local part', () => {
    expect(redactEmail('alice@example.com')).toBe('a***@example.com');
    expect(redactEmail('')).toBe('***');
  });

  it('consoleMailProvider.send resolves without throwing', async () => {
    const p = new ConsoleMailProvider();
    await expect(
      p.send({ to: 'alice@example.com', subject: 'hi', text: 'body' }),
    ).resolves.toBeUndefined();
    expect(p.driver).toBe('console');
  });

  it('smtpMailProvider no-ops when host/from missing (no secrets in throw)', async () => {
    const config = {
      get: (key: string) => {
        if (key === 'SMTP_HOST') return '';
        if (key === 'SMTP_FROM') return '';
        if (key === 'SMTP_PASS') return 'super-secret-password';
        return undefined;
      },
    } as unknown as ConfigService;
    const p = new SmtpMailProvider(config);
    await expect(p.send({ to: 'bob@example.com', subject: 'x' })).resolves.toBeUndefined();
    expect(p.driver).toBe('smtp');
  });

  it('smtpMailProvider dry-runs when configured (no socket)', async () => {
    const config = {
      get: (key: string) => {
        const map: Record<string, unknown> = {
          SMTP_HOST: 'smtp.example.com',
          SMTP_PORT: 587,
          SMTP_FROM: 'noreply@example.com',
          SMTP_USER: 'user',
          SMTP_PASS: 'secret',
        };
        return map[key];
      },
    } as unknown as ConfigService;
    const p = new SmtpMailProvider(config);
    await expect(p.send({ to: ['a@b.c', 'd@e.f'], subject: 'hello' })).resolves.toBeUndefined();
  });
});
