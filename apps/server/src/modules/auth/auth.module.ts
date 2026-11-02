import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha/captcha.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, CaptchaService],
  exports: [AuthService, CaptchaService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class AuthModule {}
