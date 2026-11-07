import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha/captcha.service';
import { AuthOriginGuard } from './auth-origin.guard';
import { LoginThrottle } from '../../common/throttler/login-throttle';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  captchaId: z.string().max(128).optional(),
  captchaToken: z.string().max(128).optional(),
});

@ApiTags('Auth')
@Controller({ path: 'auth', version: [VERSION_NEUTRAL, '1'] })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly captcha: CaptchaService,
  ) {}

  /**
   * Issue one-time captcha challenge (for CAPTCHA_REQUIRED=true).
   * With CAPTCHA_E2E_BYPASS=1 returns fixed e2e token.
   */
  @Public()
  @Get('captcha')
  async captchaChallenge() {
    return this.captcha.issueChallenge();
  }

  @Public()
  @Post('login')
  @LoginThrottle()
  @UseGuards(AuthOriginGuard)
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'BadRequestException',
        error: 'Username and password are required',
      });
    }
    await this.captcha.assertLoginCaptcha({
      captchaId: parsed.data.captchaId,
      captchaToken: parsed.data.captchaToken,
    });
    const ip = typeof req.ip === 'string' ? req.ip : undefined;
    return this.auth.login(parsed.data, res, ip);
  }

  /** Must: body = pure accessToken string (no envelope). */
  @Public()
  @SkipEnvelope()
  @Post('refresh')
  @UseGuards(AuthOriginGuard)
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    const parsed = z.object({ expectedUserId: z.uuid().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid refresh identity');
    const cookie = req.cookies?.jwt as string | undefined;
    return this.auth.refresh(cookie, res, parsed.data.expectedUserId);
  }

  @Public()
  @Post('logout')
  @UseGuards(AuthOriginGuard)
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<string> {
    const parsed = z.object({ expectedUserId: z.uuid().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid logout identity');
    const cookie = req.cookies?.jwt as string | undefined;
    return this.auth.logout(cookie, res, parsed.data.expectedUserId);
  }

  @ApiBearerAuth('Bearer')
  @Get('codes')
  async codes(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.auth.getCodes(user.userId);
  }
}
