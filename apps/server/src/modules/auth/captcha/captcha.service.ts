import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RedisService } from '../../../redis/redis.service';
import { CAPTCHA_E2E_BYPASS_TOKEN } from './captcha.types';
import type { CaptchaChallenge } from './captcha.types';

const CAPTCHA_TTL_SEC = 120;
const KEY_PREFIX = 'captcha:';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function readFlag(config: ConfigService, key: string): boolean {
  // Prefer live process.env so each Jest TestingModule boot can flip flags
  // even when ConfigModule validate() is sticky in-process.
  const env = process.env[key];
  if (env === 'true' || env === '1') return true;
  if (env === 'false' || env === '0') return false;
  const v = config.get<unknown>(key);
  return v === true || v === 1 || v === 'true' || v === '1';
}

/**
 * SliderCaptcha harness (tech plan / open-source checklist).
 * - Default: CAPTCHA_REQUIRED=false → login stays username+password (api-contract).
 * - CAPTCHA_REQUIRED=true → login must present a one-time challenge from issueChallenge().
 * - CAPTCHA_E2E_BYPASS=1 → skips verification (tests / headless only; never production).
 * Frontend SliderCaptcha remains the production UX; VITE_CAPTCHA_E2E_BYPASS mirrors this.
 *
 * Flags prefer live process.env so e2e can toggle without re-booting Nest
 * (ConfigModule validate() may be sticky within one Jest process).
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private warnedBypass = false;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  isBypassEnabled(): boolean {
    const on = readFlag(this.config, 'CAPTCHA_E2E_BYPASS');
    if (on && !this.warnedBypass) {
      this.warnedBypass = true;
      this.logger.warn(
        'CAPTCHA_E2E_BYPASS enabled — captcha checks skipped (never use in production)',
      );
    }
    return on;
  }

  isRequired(): boolean {
    return readFlag(this.config, 'CAPTCHA_REQUIRED');
  }

  /** Issue a one-time challenge (Redis). Used when CAPTCHA_REQUIRED=true. */
  async issueChallenge(): Promise<CaptchaChallenge> {
    if (this.isBypassEnabled()) {
      return {
        captchaId: 'e2e',
        captchaToken: CAPTCHA_E2E_BYPASS_TOKEN,
        expiresIn: CAPTCHA_TTL_SEC,
      };
    }

    const captchaId = randomUUID().replaceAll('-', '');
    const captchaToken = randomBytes(24).toString('base64url');
    const ok = await this.storeChallenge(captchaId, captchaToken);
    if (!ok) {
      throw new BadRequestException({
        message: 'Captcha unavailable',
        error: 'Captcha store unavailable',
      });
    }
    return { captchaId, captchaToken, expiresIn: CAPTCHA_TTL_SEC };
  }

  /**
   * Enforce captcha on login when required.
   * Bypass short-circuits; otherwise consume one-time Redis challenge.
   */
  async assertLoginCaptcha(input: { captchaId?: string; captchaToken?: string }): Promise<void> {
    if (this.isBypassEnabled()) {
      return;
    }
    if (!this.isRequired()) {
      return;
    }

    const id = input.captchaId?.trim() ?? '';
    const token = input.captchaToken?.trim() ?? '';
    if (!id || !token) {
      throw new BadRequestException({
        message: 'BadRequestException',
        error: 'Captcha is required',
      });
    }

    // Explicit bypass token is rejected when bypass env is off.
    if (token === CAPTCHA_E2E_BYPASS_TOKEN) {
      throw new BadRequestException({
        message: 'BadRequestException',
        error: 'Invalid captcha',
      });
    }

    const key = KEY_PREFIX + id;
    const stored = await this.redis.get(key);
    if (!stored) {
      throw new BadRequestException({
        message: 'BadRequestException',
        error: 'Invalid or expired captcha',
      });
    }
    await this.redis.del(key);
    if (stored !== sha256(token)) {
      throw new BadRequestException({
        message: 'BadRequestException',
        error: 'Invalid captcha',
      });
    }
  }

  private async storeChallenge(captchaId: string, captchaToken: string): Promise<boolean> {
    try {
      await this.redis.set(KEY_PREFIX + captchaId, sha256(captchaToken), CAPTCHA_TTL_SEC);
      // Confirm write (set() swallows Redis errors)
      const got = await this.redis.get(KEY_PREFIX + captchaId);
      return got === sha256(captchaToken);
    } catch (error) {
      this.logger.warn(`captcha store failed: ${String(error)}`);
      return false;
    }
  }
}
