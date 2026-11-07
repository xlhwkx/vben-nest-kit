# 青栈 Nest server — multi-stage production image (Node 22)
# Build from repo root:
#   docker build -f apps/server/Dockerfile -t qingzhan-server:local .
#
# Diff vs scripts/deploy/Dockerfile: that one builds Vben frontend+nginx;
# this image is Nest API only (non-root node user).

# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    TZ=Asia/Shanghai \
    npm_config_registry=https://registry.npmmirror.com
# Prefer Aliyun Debian mirror when public deb.debian.org is flaky
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
  elif [ -f /etc/apt/sources.list ]; then \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
  fi; \
  corepack enable; \
  apt-get update; \
  apt-get install -y --no-install-recommends openssl ca-certificates; \
  rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
# argon2 usually ships prebuilds (node-gyp-build); only install compilers if needed.
# Keep make/python3 light; g++ pulled only when prebuild missing (optional retry path).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make \
  && rm -rf /var/lib/apt/lists/*

COPY . .

# Prisma loads its datasource config during generation; generation never connects.
# This placeholder is confined to the builder and is not inherited by the runner.
ENV IGNORE_STUB=1 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN --mount=type=cache,id=pnpm-qingzhan,target=/pnpm/store \
    pnpm config set registry https://registry.npmmirror.com \
    && pnpm install --frozen-lockfile --filter @qingzhan/server... \
    || (apt-get update && apt-get install -y --no-install-recommends g++ \
        && pnpm install --frozen-lockfile --filter @qingzhan/server...)

RUN pnpm --filter @qingzhan/server exec prisma generate \
  && pnpm --filter @qingzhan/server run build

RUN pnpm --filter @qingzhan/server deploy --legacy --prod /out \
  && cp -a apps/server/prisma /out/prisma \
  && cp apps/server/prisma.config.ts /out/prisma.config.ts \
  && cp apps/server/docker-entrypoint.sh /out/docker-entrypoint.sh \
  && chmod +x /out/docker-entrypoint.sh \
  && test -f /out/dist/main.js

WORKDIR /out
RUN ./node_modules/.bin/prisma --version

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    APP_PORT=5320

RUN mkdir -p /app/uploads && chown -R node:node /app
COPY --from=builder --chown=node:node /out /app

USER node
EXPOSE 5320

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||5320)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
