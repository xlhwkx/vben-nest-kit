<p align="center">
  <img src="docs-site/public/logo.svg" width="96" height="96" alt="青栈 Qingzhan" />
</p>

# 青栈（vben-nest-kit）

青栈基于 [Vue Vben Admin](https://github.com/vbenjs/vue-vben-admin) monorepo，提供适配 Vben 的 NestJS 后端与管理页面。后端是模块化单体，使用 PostgreSQL、Prisma、Redis；通过真实 API 提供认证、角色权限、动态菜单、用户、部门、字典、审计和上传。

[![Server e2e](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-server-e2e.yml/badge.svg)](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-server-e2e.yml) [![Delivery](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-delivery.yml/badge.svg)](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-delivery.yml) [![license](https://img.shields.io/github/license/xlhwkx/vben-nest-kit.svg)](LICENSE)

MIT 许可证；根 LICENSE 保留上游版权。上游说明见 [README.vben.md](README.vben.md) / [README.zh-CN.md](README.zh-CN.md)。项目问题请提交至[本仓库 Issues](https://github.com/xlhwkx/vben-nest-kit/issues)。安全问题请勿公开凭据或可利用细节；可使用仓库启用后的 GitHub 私密漏洞报告入口。

## 支持的交付入口

| 路径 | 定位 | 开发地址 |
| --- | --- | --- |
| `apps/server` | Nest 后端 | `http://localhost:5320/api` |
| `playground` | 青栈完整管理前端，包含用户/角色/菜单/部门/字典页面 | `http://localhost:5555` |
| `apps/web-antd` | 另一套 UI 的认证与动态路由接入示例，管理页面尚未移植 | `http://localhost:5666` |
| `apps/backend-mock`、其他 `web-*` | 上游演示与对照，未纳入青栈交付保证 | — |

两套接入前端均关闭 Nitro mock、使用后端路由和自动续期。切换旧版本时需清除浏览器中旧的偏好设置，确认 `accessMode=backend`、`enableRefreshToken=true`。playground 使用独立的 `qingzhan-admin-v1` 缓存命名空间。

## 本地快速开始

推荐 Node **24.12+（24.x）**，pnpm **11.16.0**（以根 `packageManager` 为准）。根 engines 同时允许 Node 22.18+；新增交付 CI 使用 Node 24。现代浏览器需支持 ES2022；多标签页续期协调依赖 Web Locks。

以下为 Bash 命令；PowerShell 可用 `Copy-Item` 复制文件、`$env:ALLOW_DEMO_SEED='true'` 设置开关。不要覆盖已有环境文件。

```bash
# 仓库根目录；首次配置
cp .env.example .env
cp apps/server/.env.example apps/server/.env
# 两份配置中的 DB/Redis/密钥须一致；模板仅用于本地开发
pnpm install --frozen-lockfile
docker compose up -d --wait

pnpm --filter @qingzhan/server exec prisma migrate deploy
ALLOW_DEMO_SEED=true pnpm --filter @qingzhan/server exec prisma db seed

# 终端 1
pnpm --filter @qingzhan/server start:dev
# 终端 2
pnpm dev:admin
```

开发种子账号：`vben` / `admin` / `jack`，密码均为 `123456`。仅前两者获管理入口和管理权限。种子必须显式开启 `ALLOW_DEMO_SEED=true`；禁止用于生产库，不能用于生产升级。

默认宿主端口为 PG **55433**、Redis **56379**，可在环境文件修改。API 探针：`/api/health/live`、`/api/health/ready`；开发 Swagger 为 `/api/docs`。

仅开发后端时仍从仓库根锁文件安装，保留 workspace 的依赖构建白名单：

```bash
IGNORE_STUB=1 pnpm install --frozen-lockfile --filter @qingzhan/server...
```

前端需要根目录完整安装及 postinstall 生成的内部配置包。若 `@vben/vite-config` 缺少 dist，完成根安装后执行 `pnpm -r run --if-present stub`。另一套 UI 使用 `pnpm dev:antd`，完整管理操作请使用 `pnpm dev:admin`。

## 生产交付

两套前端生产 API 默认均为同源 **`/api`**，由站点反向代理到 Nest；mock 和验证码旁路会被配置检查拒绝。构建时可以使用真实 HTTP(S) API 地址覆盖 `VITE_GLOB_API_URL`。Vite 与运行时配置使用相同 mode 和环境变量优先级，CI 会核对实际生成的配置文件。

```bash
pnpm build:admin
# 发布目录：playground/dist
# 若需同时核对两套前端产物：
pnpm --filter @vben/web-antd build
pnpm check:delivery:artifacts
```

生产后端必须先迁移。空库通过安全 bootstrap 创建强密码管理员，同时创建管理页面路由；已有库通过指定管理员的独立命令补齐入口，权限与现有菜单冲突会拒绝并回滚。命令和 Nginx 示例见[生产验收指南](docs/qingzhan/production-acceptance.md)与[部署文档](docs/qingzhan/deploy.md)。生产不要运行 demo seed。

## 认证与一致性

- Access JWT 使用 Bearer；refresh 通过 HttpOnly Cookie `jwt` 传递，数据库保存哈希并原子旋转。登录/刷新/退出校验受信来源。
- 权限从有效用户、角色和菜单真源数据库读取；按钮不作为页面路由返回。授权页面必须包含祖先。
- 用户/角色/菜单 PUT 使用编辑 `version`，冲突返回 409；关键成功写入与审计在同一事务内提交。
- 多标签页串行续期；账号切换时拒绝旧请求和排队重放。显式退出撤销失败时保留本地状态，提示重试。
- readiness 对 PG/Redis 探测使用单飞和短缓存，并单独限流 30 次/IP/分钟；liveness 不探测依赖。

接口以[API 合同](规则/api-contract-vben.md)为准。当前 OpenAPI 请求/响应 schema 尚不完整，不应直接视为可靠的 SDK 生成源。

## 质量检查与验收状态

```bash
pnpm check:delivery:types
pnpm check:delivery:lint
pnpm test:delivery
# 后端单元/E2E：使用隔离环境，见 apps/server/README.md
```

本仓库 CI 包括后端单元/真实 PG/Redis E2E/生产镜像烟测，以及新增的前端类型、回归、生产构建、配置产物检查和双 UI 浏览器联调。浏览器脚本使用 Vite 源模块，生产构建另行检查；浏览器联调不等于生产压缩包已完成浏览器验收。

新增 CI 与新安全回归尚需实际执行。当前适合作为**待验收的企业二开底座**；是否投产应依据对应提交的 CI、目标环境联调、容量与备份恢复结果，不能仅凭“能构建”或历史测试数量判断。执行入口与通过标准见[生产验收指南](docs/qingzhan/production-acceptance.md)。

## 能力边界

当前没有全链路多租户/行级数据隔离、私有文件 ACL/签名下载/总配额、完整 SSO/MFA。验证码是一次性公开票据，不能替代服务端人机验证。SMTP、审计归档 worker 与 OTel 导出仍含明确标注的骨架实现。部门/字典及 DELETE 尚未全面使用编辑前置条件。高频写入、多实例容量、真实云存储及生产 RPO/RTO 需按业务验收。

## 文档

- [文档索引](docs/qingzhan/README.md)、[架构](docs/qingzhan/architecture.md)、[贡献](docs/qingzhan/contributing.md)
- [后端开发与回归](apps/server/README.md)、[部署](docs/qingzhan/deploy.md)、[备份迁移](docs/qingzhan/backup-migrate.md)、[可观测性](docs/qingzhan/observability.md)
- [技术方案](规则/vben-nestjs-backend-tech-plan.md)、[API 合同](规则/api-contract-vben.md)、[变更记录](CHANGELOG.qingzhan.md)
- [本轮交付记录](docs/qingzhan/production-delivery-phase13-2026-11-07.md)、[第十二轮安全修复](docs/qingzhan/production-hardening-phase12-2026-11-07.md)
- [产品文档站](docs-site/)：`pnpm docs:dev` / `pnpm docs:build`
