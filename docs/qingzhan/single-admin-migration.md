# 单管理前端迁移与二开

迁移前完整版本保存在 Git 提交 `a5cfecdf5b5fd4502273664cf0efba89023108e1`，需要额外 UI 或演示时可从该提交或 Vben 上游参考。

默认仓库仅保留 `apps/admin` 与 `apps/server` 两个业务应用。产品文档站 `docs-site` 可按需使用；Vben 共享包、构建工具和安全回归保留。

## 路径与命令

| 旧入口 | 新入口 |
| --- | --- |
| `playground` / `@vben/playground` | `apps/admin` / `@qingzhan/admin` |
| `pnpm dev:play` / `pnpm dev:admin` | `pnpm dev` / `pnpm dev:admin` |
| 后端长 filter 命令 | `pnpm dev:server` |
| `playground/dist` | `apps/admin/dist` |
| `pnpm build` 构建全部应用与站点 | 只构建管理端与后端 |
| 其他五套 UI、mock 与上游文档站 | 移出默认分支；参考 Vben 上游或本仓库迁移前 Git 历史 |

1. 保存本地业务修改和环境配置，先在独立 checkout 验证升级。不要覆盖服务器环境文件。
2. 原 `playground/.env` 及 `.env.*.local` 迁到 `apps/admin/`，核对本地 API 目标；不要把旧 mock 地址或旁路带入新管理端。仓库内的本次目录迁移会同时移动原目录的本地文件，但其他 checkout 不会自动迁移被忽略文件。
3. 根目录重新 `pnpm install --frozen-lockfile`，修正 IDE、部署脚本、静态目录与外部 CI 使用的旧路径。旧 `dev:antd` 等命令已移除，`dev:admin` / `build:admin` 保留。
4. 登录页改为手动输入用户名与密码，不提供默认弱密码、假滑块验证或未实现的扫码/注册入口。启用后端票据要求时，同时设置前端 `VITE_CAPTCHA_REQUIRED=true`；公开票据仍不是人机验证。
5. 新开发 seed 仅创建工作台、管理路由和权限，不创建组件演示菜单；生产仍使用 bootstrap/provision CLI，禁止 seed。
6. 已有数据库不会被此次源码裁剪自动修改。备份后人工核对仍指向 `/demos/*`、`/examples/*` 或旧 UI 组件的菜单，移除明确不用的演示授权和菜单；若有自己的同名业务页面，应迁移组件并保留授权。不要批量删除自定义菜单或重置生产数据库。
7. 发布前完成 `check:starter`、交付类型/lint、后端 E2E、管理端浏览器回归、生产构建与 HTTPS 预发验收。

## Docker 管理端

`scripts/deploy/Dockerfile` 仅构建 `apps/admin` 并检查产物，运行时由 Nginx 提供前端与 `/api`、`/uploads` 代理。通过 `QINGZHAN_API_ORIGIN` 指定可达的后端源（默认 `http://server:5320`，不带 `/api` 后缀），容器端口为 8080；将它加入后端所在网络，入口 HTTPS 和代理信任按部署文档配置。

## 新项目从哪里写

前端页面放 `apps/admin/src/views/<业务模块>`，接口放 `apps/admin/src/api`，后端域放 `apps/server/src/modules`。通过后端菜单管理配置组件路径、权限码和授权角色。数据库变更创建新的 Prisma migration，保留既有 migration 历史。

保留 `packages` 与 `internal` 的 workspace 结构，避免把框架源码复制进业务应用。完整组件用法参考 https://doc.vben.pro；已有生产验收与能力边界见 [production-acceptance.md](./production-acceptance.md)。

本机只执行静态检查；运行回归和生产构建由对应提交的远程隔离 CI 提供证据，不能引用迁移前 PR 的成功状态。
