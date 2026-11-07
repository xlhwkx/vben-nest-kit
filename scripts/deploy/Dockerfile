FROM node:24-slim AS builder

# --max-old-space-size
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_OPTIONS=--max-old-space-size=8192
ENV TZ=Asia/Shanghai
ENV CI=true
# Install-time Prisma configuration only; the frontend image never connects to DB.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

RUN npm i -g corepack

WORKDIR /app

# copy package.json and pnpm-lock.yaml to workspace
COPY . /app

# 安装依赖
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build:admin
RUN pnpm check:delivery:artifacts

RUN echo "Builder Success 🎉"

FROM nginx:stable-alpine AS production
ENV QINGZHAN_API_ORIGIN=http://server:5320
ENV NGINX_ENVSUBST_FILTER=^QINGZHAN_API_ORIGIN$

# 配置 nginx
RUN echo "types { application/javascript js mjs; }" > /etc/nginx/conf.d/mjs.conf \
    && rm -rf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY --from=builder /app/scripts/deploy/nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]
