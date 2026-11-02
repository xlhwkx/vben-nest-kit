import { z } from 'zod';

const boolish = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    return v === 'true' || v === '1';
  });

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_PORT: z.coerce.number().default(5320),
  APP_PUBLIC_URL: z.string().default('http://localhost:5320'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('30m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().optional(),
  UPLOAD_PUBLIC_PATH: z.string().default('/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().default(5_242_880),
  UPLOAD_ALLOWED_MIME: z.string().optional(),
  /** production 默认关；非 production 默认开；设 true/false 可强制 */
  SWAGGER_ENABLED: boolish,
  /** 全局限流窗口（毫秒） */
  THROTTLE_TTL_MS: z.coerce.number().default(60_000),
  /** 全局限流：窗口内每 IP 最大请求数 */
  THROTTLE_LIMIT: z.coerce.number().default(120),
  /** 登录限流窗口（毫秒） */
  THROTTLE_LOGIN_TTL_MS: z.coerce.number().default(60_000),
  /** 登录限流：窗口内每 IP 最大次数（更严） */
  THROTTLE_LOGIN_LIMIT: z.coerce.number().default(10),
  /** redis（默认，多实例一致）| memory（单机急救） */
  THROTTLE_STORAGE: z.enum(['redis', 'memory']).default('redis'),
  /** 登录失败锁定：连续失败次数阈值（用户名 / IP 各自计数） */
  AUTH_FAIL_MAX: z.coerce.number().default(5),
  /** 登录失败锁定窗口（秒），默认 15 分钟 */
  AUTH_FAIL_WINDOW_SEC: z.coerce.number().default(900),
  /** 可选：覆盖用户名失败阈值（默认 = AUTH_FAIL_MAX） */
  AUTH_FAIL_USER_MAX: z.coerce.number().optional(),
  /** 可选：覆盖 IP 失败阈值（默认 = AUTH_FAIL_MAX） */
  AUTH_FAIL_IP_MAX: z.coerce.number().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  corsOrigins: string[];
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const data = parsed.data;
  return {
    ...data,
    COOKIE_SECURE: Boolean(data.COOKIE_SECURE),
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
