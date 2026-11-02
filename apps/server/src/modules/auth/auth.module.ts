import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../../observability/observability.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha/captcha.service';

@Module({
  imports: [ObservabilityModule],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService],
  exports: [AuthService, CaptchaService],
})
/* oxlint-disable-next-line typescript/no-extraneous-class -- Nest feature module */
export class AuthModule {}
