# 青栈（vben-nest-kit）

> **青栈** = 官方 [Vue Vben Admin](https://github.com/vbenjs/vue-vben-admin) 前端 monorepo + 自研 NestJS 后端（`apps/server`），用真实后端替换 `backend-mock`。

许可证：**MIT**（与 Vben / Nest 生态一致）。

## 目录结构

```
vben-nest-kit/
├── 规则/                      # 真源：技术方案 + API 合同（优先于口头约定）
├── apps/
│   ├── server/                # 青栈 Nest 12 后端（本仓库交付主体）
│   ├── web-antd/              # Vben Ant Design Vue 前端
│   ├── backend-mock/          # 官方 mock（仅对照，非交付）
│   └── web-*                  # 其它 UI 变体
├── packages/                  # Vben 共享包
├── docker-compose.yml         # Postgres 16 + Redis 7
├── .env.example               # 环境变量模板（勿提交 .env）
├── README.md                  # 本文件（青栈说明）
└── README.vben.md / README.zh-CN.md  # 上游 Vben 说明
```

## 真源文档

- `规则/vben-nestjs-backend-tech-plan.md` — 技术选型与里程碑
- `规则/api-contract-vben.md` — 路径 / 方法 / 信封 / Cookie / Bearer

## 后端（apps/server）快速开始

```bash
# 1) 基础设施
cp .env.example .env
docker compose up -d

# 2) 安装依赖（仓库根，pnpm workspace 会纳入 @qingzhan/server）
pnpm install

# 3) 仅跑 Nest
pnpm --filter @qingzhan/server start:dev
# 默认 http://localhost:5320/api/health 与 /api/v1/health
```

当前切片（M1 骨架）：

- Nest 12 + Express
- 全局信封 `{ code, data, error, message }`（`ResponseInterceptor`）
- `HttpExceptionFilter` 错误信封桩
- 双前缀占位：`/api`（Vben 兼容）+ `/api/v1`（URI versioning）
- Feature 壳：`AuthModule` / `UserModule` / `MenuModule`（尚未实现登录）

下一刀：P0 认证链路（login / refresh / logout / codes / user/info / menu/all）。

## 前端联调

开发代理默认把 `/api` 指到 `http://localhost:5320`。关掉或勿启动 `backend-mock`，改用本 Nest。

上游 Vben 文档见 `README.vben.md` / `README.zh-CN.md`。
