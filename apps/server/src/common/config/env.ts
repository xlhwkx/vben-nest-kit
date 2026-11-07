import { z } from 'zod';
import { httpOrigin, httpUrl } from './http-origin';

const boolish = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ['', 'true', 'false', '1', '0'].includes(v), {
    message: 'Expected true, false, 1 or 0 (or unset)',
  })
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    return v === 'true' || v === '1';
  });

const positiveInteger = () => z.coerce.number().int().min(1).max(2_147_483_647);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().int().min(1).max(65_535).default(5320),
  /** Empty disables proxy trust; use explicit IPs/CIDRs of the ingress only. */
  TRUST_PROXY: z.string().default(''),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(25_000),
  APP_PUBLIC_URL: z
    .string()
    .trim()
    .refine((v) => !!httpUrl(v), {
      message: 'Expected an absolute HTTP(S) URL without credentials',
    })
    .default('http://localhost:5320'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^[1-9]\d{0,5}[smhd]$/i)
    .default('30m'),
  JWT_REFRESH_TTL: z
    .string()
    .regex(/^[1-9]\d{0,5}[smhd]$/i)
    .default('7d'),
  COOKIE_SECURE: boolish,
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CORS_ORIGINS: z
    .string()
    .refine(
      (v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => !!httpOrigin(s)),
      {
        message: 'Expected comma-separated HTTP(S) origins without paths, credentials or wildcards',
      },
    )
    .default('http://localhost:5173'),
  UPLOAD_DIR: z.string().optional(),
  UPLOAD_PUBLIC_PATH: z.string().default('/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(104_857_600).default(5_242_880),
  UPLOAD_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(4),
  UPLOAD_ALLOWED_MIME: z.string().optional(),
  /** production 默认关；非 production 默认开；设 true/false 可强制 */
  SWAGGER_ENABLED: boolish,
  /** 全局限流窗口（毫秒） */
  THROTTLE_TTL_MS: positiveInteger().default(60_000),
  /** 全局限流：窗口内每 IP 最大请求数 */
  THROTTLE_LIMIT: positiveInteger().default(120),
  /** 登录限流窗口（毫秒） */
  THROTTLE_LOGIN_TTL_MS: positiveInteger().default(60_000),
  /** 登录限流：窗口内每 IP 最大次数（更严） */
  THROTTLE_LOGIN_LIMIT: positiveInteger().default(10),
  /** redis（默认，多实例一致）| memory（单机急救） */
  THROTTLE_STORAGE: z.enum(['redis', 'memory']).default('redis'),
  /** 登录失败锁定：连续失败次数阈值（用户名 / IP 各自计数） */
  AUTH_FAIL_MAX: positiveInteger().default(5),
  /** 登录失败锁定窗口（秒），默认 15 分钟 */
  AUTH_FAIL_WINDOW_SEC: positiveInteger().default(900),
  /** 可选：覆盖用户名失败阈值（默认 = AUTH_FAIL_MAX） */
  AUTH_FAIL_USER_MAX: positiveInteger().optional(),
  /** 可选：覆盖 IP 失败阈值（默认 = AUTH_FAIL_MAX） */
  AUTH_FAIL_IP_MAX: positiveInteger().optional(),
  /** 文件存储：local（默认）| s3（S3 兼容 / MinIO） */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** S3 / MinIO（仅 STORAGE_DRIVER=s3 时必填 bucket + credentials） */
  S3_ENDPOINT: z
    .string()
    .trim()
    .refine((v) => !v || !!httpUrl(v), {
      message: 'Expected an HTTP(S) endpoint without credentials',
    })
    .optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_UPLOAD_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish,
  /** 返回给前端的对象公网前缀；省略则 endpoint/bucket 或 AWS 默认拼接 */
  S3_PUBLIC_URL: z
    .string()
    .trim()
    .refine((v) => !v || !!httpUrl(v), {
      message: 'Expected an HTTP(S) public URL without credentials',
    })
    .optional(),
  /** Bounded best-effort audit, including active writes. Transactional audit is separate. */
  AUDIT_BACKGROUND_MAX_PENDING: z.coerce.number().int().min(1).max(10_000).default(256),
  AUDIT_BACKGROUND_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  /** BullMQ 可选骨架：默认关，不连 Queue/Worker */
  QUEUE_ENABLED: boolish,
  /** 是否在本进程启动 stub Worker（默认关；生产建议独立 worker） */
  QUEUE_WORKER_ENABLED: boolish,
  /** 队列 Redis DB index（省略则复用 REDIS_URL 原 path） */
  QUEUE_REDIS_DB: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
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
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: boolish,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** Observability: OpenTelemetry skeleton (default off — no network). */
  OTEL_ENABLED: boolish,
  /** none | console | otlp (otlp needs external SDK wiring; see docs) */
  OTEL_TRACES_EXPORTER: z.enum(['none', 'console', 'otlp']).default('none'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('qingzhan-server'),
  /** Expose Prometheus text at GET /api/health/metrics (default on). */
  METRICS_ENABLED: boolish,
  /** Optional bearer token for /metrics; if set, Authorization: Bearer required. */
  METRICS_TOKEN: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  corsOrigins: string[];
};

/** Placeholder JWT strings from .env.example — banned in production. */
const PLACEHOLDER_JWT_MARKERS = ['change-me-access-secret', 'change-me-refresh-secret'] as const;

/**
 * Production-only hard gates (clear errors, exit before listen).
 * Dev/test stay lenient so local `.env.example` keeps working.
 */
export function assertProductionEnv(data: {
  NODE_ENV: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  CAPTCHA_E2E_BYPASS?: boolean;
  METRICS_ENABLED?: boolean;
  METRICS_TOKEN?: string;
  COOKIE_SECURE?: boolean;
}): void {
  if (data.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  if (data.CAPTCHA_E2E_BYPASS) {
    problems.push('CAPTCHA_E2E_BYPASS must be false/unset in production (E2E harness only)');
  }
  for (const marker of PLACEHOLDER_JWT_MARKERS) {
    if (data.JWT_ACCESS_SECRET.includes(marker) || data.JWT_REFRESH_SECRET.includes(marker)) {
      problems.push(
        'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET still use .env.example placeholders — generate real secrets (≥32 chars)',
      );
      break;
    }
  }
  const metricsOn = data.METRICS_ENABLED !== false;
  if (metricsOn && !data.METRICS_TOKEN?.trim()) {
    problems.push(
      'METRICS_ENABLED is on but METRICS_TOKEN is empty — set a scrape token or METRICS_ENABLED=false',
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid production environment:\n  - ${problems.join('\n  - ')}`);
  }

  if (!data.COOKIE_SECURE) {
    // Soft: reverse proxies sometimes terminate TLS; still surface the risk.
    console.warn(
      '[env] COOKIE_SECURE is false in production — set true unless TLS is terminated in a trusted mesh and cookies stay internal',
    );
  }
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)';
      return `  - ${path}: ${i.message}`;
    });
    throw new Error(
      `Invalid environment (missing or bad required config):\n${lines.join('\n')}\n` +
        'Required: DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET (≥32), JWT_REFRESH_SECRET (≥32). See apps/server/.env.example',
    );
  }
  const data = parsed.data;
  if (data.AUDIT_BACKGROUND_CONCURRENCY > data.AUDIT_BACKGROUND_MAX_PENDING) {
    throw new Error('AUDIT_BACKGROUND_CONCURRENCY must not exceed AUDIT_BACKGROUND_MAX_PENDING');
  }
  if (
    data.STORAGE_DRIVER === 's3' &&
    [data.S3_BUCKET, data.S3_ACCESS_KEY_ID, data.S3_SECRET_ACCESS_KEY].some((v) => !v?.trim())
  ) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (data.COOKIE_SAME_SITE === 'none' && !data.COOKIE_SECURE) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true');
  }
  if (/^(true|\d+)$/i.test(data.TRUST_PROXY.trim())) {
    throw new Error('TRUST_PROXY must contain trusted proxy IPs/CIDRs, not a hop count or true');
  }

  const metricsEnabled = data.METRICS_ENABLED === undefined ? true : Boolean(data.METRICS_ENABLED);

  assertProductionEnv({
    NODE_ENV: data.NODE_ENV,
    JWT_ACCESS_SECRET: data.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: data.JWT_REFRESH_SECRET,
    CAPTCHA_E2E_BYPASS: Boolean(data.CAPTCHA_E2E_BYPASS),
    METRICS_ENABLED: metricsEnabled,
    METRICS_TOKEN: data.METRICS_TOKEN,
    COOKIE_SECURE: Boolean(data.COOKIE_SECURE),
  });

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
    OTEL_ENABLED: Boolean(data.OTEL_ENABLED),
    // default metrics on when unset (light default)
    METRICS_ENABLED: metricsEnabled,
    corsOrigins: data.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => httpOrigin(s)!),
  };
}
