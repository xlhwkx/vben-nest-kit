import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MenuModule } from './modules/menu/menu.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [HealthModule, AuthModule, UserModule, MenuModule],
})
export class AppModule {}
