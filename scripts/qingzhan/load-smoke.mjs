#!/usr/bin/env node
/**
 * 青栈压测烟测（轻量，非压测平台）
 *
 * 目标：确认 health + login 在少量并发下仍 2xx，给企业稳态③留「跑过一次」的证据。
 * CI 默认不跑；本地 / 演练：
 *
 *   pnpm test:load:smoke
 *   BASE_URL=http://127.0.0.1:5320 node scripts/qingzhan/load-smoke.mjs
 *
 * Env:
 *   BASE_URL              默认 http://127.0.0.1:5320
 *   SMOKE_USERNAME        默认 vben
 *   SMOKE_PASSWORD        默认 123456
 *   SMOKE_HEALTH_CONCURRENCY  默认 8
 *   SMOKE_HEALTH_REQUESTS     默认 40（live+ready 合计目标量级）
 *   SMOKE_LOGIN_CONCURRENCY   默认 2（避开登录限流误杀）
 *   SMOKE_LOGIN_REQUESTS      默认 8
 *   SMOKE_WITH_UPLOAD=1       额外用 login 拿到的 token 打一次 /api/upload（可选）
 *
 * 退出码：0 通过；1 失败（任一类错误率超阈值或非 2xx 过多）。
 * 短时间连跑可能撞登录限流（429）；等 THROTTLE_LOGIN_TTL 或降低 SMOKE_LOGIN_*。
 */
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5320').replace(
  /\/$/,
  '',
);
const USER = process.env.SMOKE_USERNAME || 'vben';
const PASS = process.env.SMOKE_PASSWORD || '123456';
const HEALTH_C = Number(process.env.SMOKE_HEALTH_CONCURRENCY || 8);
const HEALTH_N = Number(process.env.SMOKE_HEALTH_REQUESTS || 40);
const LOGIN_C = Number(process.env.SMOKE_LOGIN_CONCURRENCY || 2);
const LOGIN_N = Number(process.env.SMOKE_LOGIN_REQUESTS || 8);
const WITH_UPLOAD = process.env.SMOKE_WITH_UPLOAD === '1';

/** @typedef {{ ok: number, fail: number, status: Record<string, number>, latencies: number[] }} Stats */

function newStats() {
  return { ok: 0, fail: 0, status: {}, latencies: [] };
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function timedFetch(url, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    const ms = performance.now() - t0;
    const body = await res.text();
    return { res, body, ms, error: null };
  } catch (error) {
    const ms = performance.now() - t0;
    return { res: null, body: '', ms, error };
  }
}

/**
 * @param {Stats} stats
 * @param {{ res: Response | null, ms: number, error: unknown }} r
 * @param {(status: number, body: string) => boolean} [okPred]
 */
function record(stats, r, okPred) {
  stats.latencies.push(r.ms);
  if (r.error || !r.res) {
    stats.fail += 1;
    stats.status.error = (stats.status.error || 0) + 1;
    return;
  }
  const code = String(r.res.status);
  stats.status[code] = (stats.status[code] || 0) + 1;
  const ok = okPred
    ? okPred(r.res.status, r.body)
    : r.res.status >= 200 && r.res.status < 300;
  if (ok) stats.ok += 1;
  else stats.fail += 1;
}

/**
 * @param {number} total
 * @param {number} concurrency
 * @param {(i: number) => Promise<void>} worker
 */
async function pool(total, concurrency, worker) {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, total) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= total) return;
        await worker(i);
      }
    },
  );
  await Promise.all(runners);
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

/** @param {string} name @param {Stats} stats */
function summarize(name, stats) {
  const sorted = [...stats.latencies].toSorted((a, b) => a - b);
  const total = stats.ok + stats.fail;
  const p50 = pct(sorted, 50).toFixed(1);
  const p95 = pct(sorted, 95).toFixed(1);
  const errRate = total ? ((stats.fail / total) * 100).toFixed(1) : '0.0';
  console.log(
    `[smoke] ${name}: ok=${stats.ok} fail=${stats.fail} err%=${errRate} p50=${p50}ms p95=${p95}ms statuses=${JSON.stringify(stats.status)}`,
  );
  return { total, errRate: Number(errRate) };
}

async function smokeHealth() {
  const stats = newStats();
  const paths = ['/api/health/live', '/api/health/ready'];
  await pool(HEALTH_N, HEALTH_C, async (i) => {
    const path = paths[i % paths.length];
    const r = await timedFetch(`${BASE}${path}`);
    record(stats, r, (status) => status === 200);
  });
  return summarize('health', stats);
}

async function smokeLogin() {
  const stats = newStats();
  /** @type {string | null} */
  let lastAccess = null;
  await pool(LOGIN_N, LOGIN_C, async () => {
    const r = await timedFetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    record(stats, r, (status, body) => {
      if (status !== 200) return false;
      try {
        const json = JSON.parse(body);
        const token = json?.data?.accessToken;
        if (typeof token === 'string' && token.length > 10) {
          lastAccess = token;
          return true;
        }
      } catch {
        /* fallthrough */
      }
      return false;
    });
  });
  const summary = summarize('login', stats);
  return { ...summary, accessToken: lastAccess };
}

async function smokeUpload(accessToken) {
  const stats = newStats();
  if (!accessToken) {
    console.log('[smoke] upload: skipped (no accessToken)');
    return { total: 0, errRate: 0 };
  }
  // Minimal 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
  const r = await timedFetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  record(stats, r, (status) => status === 200);
  return summarize('upload', stats);
}

function failThreshold(name, summary, maxErrPct) {
  if (summary.total === 0) {
    console.error(`[smoke] FAIL ${name}: no requests`);
    return true;
  }
  if (summary.errRate > maxErrPct) {
    console.error(
      `[smoke] FAIL ${name}: err% ${summary.errRate} > ${maxErrPct}`,
    );
    return true;
  }
  return false;
}

async function main() {
  console.log(
    `[smoke] BASE_URL=${BASE} user=${USER} healthN=${HEALTH_N}/${HEALTH_C} loginN=${LOGIN_N}/${LOGIN_C} upload=${WITH_UPLOAD ? 1 : 0}`,
  );

  // Preflight
  const live = await timedFetch(`${BASE}/api/health/live`);
  if (live.error || !live.res || live.res.status !== 200) {
    console.error(
      `[smoke] preflight live failed: ${live.error || live.res?.status} — is server up?`,
    );
    process.exit(1);
  }

  const health = await smokeHealth();
  const login = await smokeLogin();
  let upload = { total: 0, errRate: 0 };
  if (WITH_UPLOAD) {
    upload = await smokeUpload(login.accessToken);
  }

  let bad = false;
  bad = failThreshold('health', health, 5) || bad;
  bad = failThreshold('login', login, 10) || bad;
  if (WITH_UPLOAD) bad = failThreshold('upload', upload, 0) || bad;

  if (bad) {
    console.error('[smoke] FAILED');
    process.exit(1);
  }
  console.log('[smoke] PASSED');
}

main().catch((error) => {
  console.error('[smoke] crashed', error);
  process.exit(1);
});
