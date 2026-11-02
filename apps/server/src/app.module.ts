import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { loadEnv } from "./common/config/env";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { RedisThrottlerStorage } from "./common/throttler/redis-throttler.storage";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MenuModule } from "./modules/menu/menu.module";
import { SystemModule } from "./modules/system/system.module";
import { UserModule } from "./modules/user/user.module";
import { UploadModule } from "./modules/upload/upload.module";
import { AuditModule } from "./modules/audit/audit.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { RedisService } from "./redis/redis.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
    JwtModule.register({ global: true }),
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => {
        const ttl = config.get<number>("THROTTLE_TTL_MS") ?? 60_000;
        const limit = config.get<number>("THROTTLE_LIMIT") ?? 120;
        const loginTtl = config.get<number>("THROTTLE_LOGIN_TTL_MS") ?? 60_000;
        const loginLimit = config.get<number>("THROTTLE_LOGIN_LIMIT") ?? 10;
        const storageMode = config.get<string>("THROTTLE_STORAGE") ?? "redis";

        return {
          errorMessage: "Too Many Requests",
          storage:
            storageMode === "memory"
              ? undefined
              : new RedisThrottlerStorage(redis),
          throttlers: [
            { name: "default", ttl, limit },
            {
              name: "login",
              ttl: loginTtl,
              limit: loginLimit,
              skipIf: (ctx) => {
                const req = ctx.switchToHttp().getRequest<{
                  method?: string;
                  originalUrl?: string;
                  url?: string;
                  path?: string;
                }>();
                if (req.method !== "POST") return true;
                const raw = String(
                  req.originalUrl ?? req.url ?? req.path ?? "",
                ).split("?")[0];
                return !/\/auth\/login\/?$/.test(raw);
              },
            },
          ],
        };
      },
    }),
    HealthModule,
    AuthModule,
    UserModule,
    MenuModule,
    SystemModule,
    UploadModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
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
