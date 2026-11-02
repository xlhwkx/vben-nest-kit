import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
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

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

@ApiTags('Auth')
@Controller({ path: 'auth', version: [VERSION_NEUTRAL, '1'] })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
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
    const ip = typeof req.ip === 'string' ? req.ip : undefined;
    return this.auth.login(parsed.data, res, ip);
  }

  /** Must: body = pure accessToken string (no envelope). */
  @Public()
  @SkipEnvelope()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const cookie = req.cookies?.jwt as string | undefined;
    return this.auth.refresh(cookie, res);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const cookie = req.cookies?.jwt as string | undefined;
    return this.auth.logout(cookie, res);
  }

  @ApiBearerAuth('Bearer')
  @Get('codes')
  async codes(@CurrentUser() user: AuthUser): Promise<string[]> {
    return this.auth.getCodes(user.userId);
  }
}
