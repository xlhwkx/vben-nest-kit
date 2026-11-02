import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "./common/config/env";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MenuModule } from "./modules/menu/menu.module";
import { SystemModule } from "./modules/system/system.module";
import { UserModule } from "./modules/user/user.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
    JwtModule.register({ global: true }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UserModule,
    MenuModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
      inject: [Reflector],
    },
  ],
})
export class AppModule {}
