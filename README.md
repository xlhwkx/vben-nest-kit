<p align="center"><img src="docs-site/public/logo.svg" width="80" height="80" alt="青栈 Qingzhan" /></p>

# 青栈（vben-nest-kit）

基于 [Vue Vben Admin](https://github.com/vbenjs/vue-vben-admin) 的企业后台二开底座：**一套 Vue 管理前端 + 一个 NestJS 后端**。使用 PostgreSQL、Prisma 和 Redis，提供登录会话、角色权限、动态菜单、用户、部门、字典、审计与上传。

[![Server e2e](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-server-e2e.yml/badge.svg)](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-server-e2e.yml) [![Delivery](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-delivery.yml/badge.svg)](https://github.com/xlhwkx/vben-nest-kit/actions/workflows/qingzhan-delivery.yml)

MIT 许可证；[LICENSE](LICENSE) 保留上游版权。问题请提交至[本仓库 Issues](https://github.com/xlhwkx/vben-nest-kit/issues)，安全问题请使用仓库启用后的私密漏洞报告入口。

## 项目结构

```text
apps/admin/      唯一管理前端（Vue 3 + antdv-next），端口 5555
apps/server/     NestJS 后端，端口 5320
packages/        Vben 共享组件、布局、会话请求与状态管理
internal/        构建、类型和代码规范配置
scripts/         开发工具、交付检查和隔离回归
docs/qingzhan/   开发、部署、验收文档
docs-site/       可选的青栈产品文档站
```

其他 UI 和 mock 应用已移出默认仓库。组件演示可查阅 [Vben 官方文档](https://doc.vben.pro)；迁移前源码可从 Git 历史查阅。`packages` 和 `internal` 是前端依赖，不能只拷贝 `apps/admin` 运行。

## 克隆与开发

使用 Node **24.12+（24.x）**、pnpm **11.16.0**。以下为 Bash 命令；PowerShell 使用 `Copy-Item` 和 `$env:ALLOW_DEMO_SEED='true'`。不要覆盖已有环境文件。

```bash
git clone https://github.com/xlhwkx/vben-nest-kit.git
cd vben-nest-kit
cp .env.example .env
cp apps/server/.env.example apps/server/.env
# 配置两份文件中的 DB/Redis/密钥，内容须一致；模板仅用于本地开发
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm --filter @qingzhan/server exec prisma migrate deploy
ALLOW_DEMO_SEED=true pnpm --filter @qingzhan/server exec prisma db seed

# 终端 1：后端
pnpm dev:server
# 终端 2：前端；pnpm dev 同样只启动管理前端
pnpm dev
```

打开 `http://localhost:5555`，手动输入开发账号 `vben` / `admin` / `jack`，密码均为 `123456`；前两者拥有管理权限，jack 只有工作台。登录页不预填弱密码。开发 seed 必须显式开启，禁止用于生产或生产升级。

默认宿主端口：PostgreSQL **55433**、Redis **56379**。API `/api`；探针 `/api/health/live`、`/api/health/ready`；开发 Swagger `/api/docs`。前端自动代理 `/api` 到 Nest，默认关闭 mock。若后端启用 `CAPTCHA_REQUIRED=true`，前端同时设置 `VITE_CAPTCHA_REQUIRED=true` 以获取一次性公开票据；它不提供人机验证。

仅开发后端可使用 `IGNORE_STUB=1 pnpm install --frozen-lockfile --filter @qingzhan/server...`。前端从根目录完整安装；内部配置包缺少 dist 时执行 `pnpm -r run --if-present stub`。

## 二开入口

- 前端页面：`apps/admin/src/views`；API：`apps/admin/src/api`；组件适配：`apps/admin/src/adapter`。
- 后端模块：`apps/server/src/modules`；数据库：`apps/server/prisma`。
- 菜单与权限来自后端。新增页面后，通过菜单管理配置组件路径和权限，不能只添加前端文件就认为权限生效。
- 用户/角色/菜单 PUT 需携带读取到的 `version`，冲突返回 409。成功写入与审计在同一事务内提交。
- 项目使用 workspace 共享包；业务代码放在应用中，通用能力再沉淀到 `packages`。

旧目录用户先阅读[单前端迁移指南](docs/qingzhan/single-admin-migration.md)。迁移不改生产数据库，也不会自动删除已有业务菜单。

## 构建与检查

```bash
pnpm check:starter          # 单前端结构、菜单组件与交付路径静态检查
pnpm check:delivery:types   # 管理前端、共享包和后端类型
pnpm check:delivery:lint
pnpm test:delivery          # 在允许执行测试的环境运行
pnpm build                 # 管理前端 + 后端，不构建文档站
pnpm check:delivery:artifacts
```

只构建一个应用用 `pnpm build:admin` / `pnpm build:server`。前端产物是 `apps/admin/dist`，生产 API 默认同源 `/api`，由 HTTPS 站点反向代理到 Nest。配置检查拒绝上游 mock、mock 开关和验证码旁路。

生产先备份与迁移。新空库使用 `bootstrap:admin` 创建强密码管理员；已有库缺入口时使用 `provision:admin-routes` 为指定管理员补齐导航。禁止生产 demo seed。命令与 Nginx 示例见[生产验收指南](docs/qingzhan/production-acceptance.md)。

CI 覆盖后端单元/真实 PG/Redis E2E/生产镜像烟测、前端回归/生产构建/配置产物检查，以及真实 API 的浏览器联调。应核对发布提交的 CI；源码浏览器回归不替代正式 HTTPS 产物、容量和备份恢复验收。

## 能力边界与文档

当前适合作为待业务验收的企业二开底座。完整 OpenAPI schema、租户/行级隔离、私有文件 ACL/签名下载/总配额、SSO/MFA 尚未完成；SMTP、审计归档 worker、OTel 导出含骨架实现。部门/字典及 DELETE 尚未全面采用编辑前置条件。现代浏览器需支持 ES2022，多标签页续期协调使用 Web Locks。

- [文档索引](docs/qingzhan/README.md)、[架构](docs/qingzhan/architecture.md)、[贡献指南](docs/qingzhan/contributing.md)
- [后端开发与回归](apps/server/README.md)、[生产验收](docs/qingzhan/production-acceptance.md)、[部署](docs/qingzhan/deploy.md)、[备份迁移](docs/qingzhan/backup-migrate.md)
- [API 合同](规则/api-contract-vben.md)、[变更记录](CHANGELOG.qingzhan.md)
- 产品文档站：`pnpm docs:dev` / `pnpm docs:build`，按需启动和构建。
