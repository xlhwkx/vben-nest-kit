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
  /** 文件存储：local（默认）| s3（S3 兼容 / MinIO） */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** S3 / MinIO（仅 STORAGE_DRIVER=s3 时必填 bucket + credentials） */
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish,
  /** 返回给前端的对象公网前缀；省略则 endpoint/bucket 或 AWS 默认拼接 */
  S3_PUBLIC_URL: z.string().optional(),
  /** BullMQ 可选骨架：默认关，不连 Queue/Worker */
  QUEUE_ENABLED: boolish,
  /** 是否在本进程启动 stub Worker（默认关；生产建议独立 worker） */
  QUEUE_WORKER_ENABLED: boolish,
  /** 队列 Redis DB index（省略则复用 REDIS_URL 原 path） */
  QUEUE_REDIS_DB: z.coerce.number().optional(),
  QUEUE_PREFIX: z.string().default('qingzhan'),
  /**
   * Captcha: default off on API (contract login = username+password).
   * Set CAPTCHA_REQUIRED=true to enforce one-time challenge on login.
   * CAPTCHA_E2E_BYPASS=1 skips checks (tests / headless only — never production).
   */
  CAPTCHA_REQUIRED: boolish,
  CAPTCHA_E2E_BYPASS: boolish,
  /** Mail sink: console (default, no network) | smtp (dry-run skeleton). */
  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: boolish,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  corsOrigins: string[];
};

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const data = parsed.data;
  return {
    ...data,
    COOKIE_SECURE: Boolean(data.COOKIE_SECURE),
    S3_FORCE_PATH_STYLE:
      data.S3_FORCE_PATH_STYLE === undefined ? true : Boolean(data.S3_FORCE_PATH_STYLE),
    QUEUE_ENABLED: Boolean(data.QUEUE_ENABLED),
    QUEUE_WORKER_ENABLED: Boolean(data.QUEUE_WORKER_ENABLED),
    CAPTCHA_REQUIRED: Boolean(data.CAPTCHA_REQUIRED),
    CAPTCHA_E2E_BYPASS: Boolean(data.CAPTCHA_E2E_BYPASS),
    SMTP_SECURE: Boolean(data.SMTP_SECURE),
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
