# 首批生产加固：2026-11-07

> 后续状态：本文保留首批完成时的验证与待办记录。第二批已补上授权事务、最后管理员保护、关键审计原子性和指标盲区，并完成真实 PostgreSQL 16 / Redis 7 的 50 项 E2E、旧库升级和生产镜像冒烟；最新范围与限制见[第二批加固记录](./production-hardening-phase2-2026-11-07.md)。

这是企业级评估之后的首批实现，优先处理上传解析、权限生效链路、会话竞争、生产打包和停机顺序。修改只落在本地工作区，没有提交、推送或部署，也没有连接并修改业务数据库。

## 已实施

| 问题 | 本批行为 |
| --- | --- |
| 上传的异常 ASF 数据可卡死旧解析器 | `file-type` 从 16.5.4 升到 21.3.1，按真实导出改用 `fileTypeFromBuffer`；截断/解析异常返回 400；保留内容类型与声明类型比对 |
| 角色管理写 RoleMenu，而接口鉴权读 RolePermission | 统一使用 `RoleMenu → Menu.authCode`；`/auth/codes` 与权限 Guard 读取同一个数据库查询；撤销后下一次鉴权生效 |
| 管理列表只有登录校验 | User/Role/Menu/Dept/Dict 的管理列表和存在性查询增加相应 `System:*:List`；普通字典拉取 API 保持登录后可用 |
| 管理员可越权授权 | 分配角色要求 `System:User:AssignRole`；目标角色、菜单权限不得超过操作者持有的权限；修改高权限用户（包括重置密码）、角色和菜单也受边界校验 |
| 禁用角色仍出现在菜单/用户角色中 | 有效权限、当前用户菜单、用户信息和登录结果过滤禁用角色 |
| 同一 refresh cookie 可并发消费 | 用户行锁、条件消费、旧令牌撤销与新令牌落库位于同一事务；事务提交后才设置 cookie |
| 密码/状态修改与刷新竞争 | 刷新记录保存 `tokenVersion`，登录/刷新锁住与用户安全更新相同的用户行；校验当前版本，防止更新后签发有效的新会话 |
| 退出与刷新竞争，存储失败却返回退出成功 | 令牌轮换保留 `familyId`，退出在用户行锁内撤销整个轮换链；数据库异常向上传递 |
| 生产部署包生成失败 | Docker 改用 `pnpm deploy --legacy --prod`；迁移配置需要的 `dotenv` 从开发依赖移动到运行依赖；builder 使用无密钥 DATABASE_URL 占位供 Prisma 生成代码，runner 不继承 |
| 无条件相信转发 IP | 默认关闭 `trust proxy`；拒绝 `true` 和跳数配置；仅显式配置可信代理地址/CIDR；生产 Compose 默认仅绑定宿主机 127.0.0.1 |
| HTTP 尚未结束就断开 Prisma/Redis | 自定义 Express adapter 在 Nest 销毁 provider 前停止接入并等待 HTTP；默认 25 秒超时后关闭连接 |
| 演示种子可重置账号/用于生产 | production 禁止演示 seed；开发/测试需 `ALLOW_DEMO_SEED=true`；不再重置已有用户密码、状态、删除标记，也不打印密码 |
| 空生产库没有安全初始化入口 | 新增编译后的 `bootstrap:admin`，要求显式用户名和 16–128 位密码；数据库级互斥锁下只允许空 users 表初始化，不覆盖已有账号 |

`Permission/RolePermission` 表暂留给历史兼容，运行时不会合并它们的授权，避免撤销 RoleMenu 后旧授权又重新生效。

## 升级步骤与兼容性

1. 先备份数据库，安排升级窗口。不要混跑新旧后端版本：旧版仍使用独立的 RolePermission 授权源，且不会维护新会话字段。
2. 用生产环境配置执行 `prisma migrate deploy`，应用 `20261107010000_authorization_and_sessions`，再启动新版本。
3. 迁移将旧 RolePermission 转换为按钮菜单并绑定 RoleMenu；为已有 `super/admin` 角色增加管理读取与分配角色权限；会话补齐安全版本和轮换链字段。
4. 自定义管理员角色需要明确补上相应 `System:*:List`、`System:User:AssignRole`。普通登录用户访问管理列表会从 200 变为 403，这是预期的权限收紧。
5. 确认前端角色权限编辑器保留并展示按钮菜单；角色的 `permissions` 字段仍是菜单 ID 数组。按钮节点允许共享空 path。
6. 反向代理部署应显式设置 `TRUST_PROXY` 为可信入口的地址/CIDR，并确认 API 的直接入口不会绕过代理。需要非本机访问时显式调整 `APP_BIND_HOST`；容器网络出口地址不一定是 127.0.0.1。
7. `SHUTDOWN_TIMEOUT_MS` 默认 25000，应小于容器的 `stop_grace_period`（示例为 30 秒）。超出时限的请求会被中断。

刷新接口现在只允许一个并发请求消费同一 cookie，前端应合并同时触发的刷新请求。退出撤销的是 refresh 会话；既有 access token 仍按原设计有效到期，密码/状态安全更新会通过 tokenVersion 立即失效。

旧数据库不应再运行演示 seed。即使是在开发环境，seed 仍是演示配置初始化工具，会补齐演示角色和授权，不能用来维护生产权限。

## 空库初始化

先迁移、构建。通过安全的环境变量渠道注入以下变量，不将密码写入命令历史或提交到仓库：

```text
DATABASE_URL
BOOTSTRAP_ADMIN_USERNAME
BOOTSTRAP_ADMIN_PASSWORD
```

本机执行：

```sh
pnpm --filter @qingzhan/server bootstrap:admin
```

已有生产镜像中执行同一个编译入口：

```sh
docker compose -f compose.prod.yml --env-file .env.production run --rm \
  -e BOOTSTRAP_ADMIN_USERNAME -e BOOTSTRAP_ADMIN_PASSWORD \
  server node dist/cli/bootstrap-admin.js
```

此入口只创建管理员和系统接口权限，不创建演示业务菜单、部门、字典或默认弱密码账号。上线团队需要配置实际页面路由和业务角色；新增业务权限码应通过受审查的数据迁移/初始化流程引入。菜单管理者只能使用自己已有的权限码。

## 验证记录

- Nest 构建通过；运行代码、测试代码、seed 类型检查通过。
- 15 个单元/回归套件、62 项测试通过（基线为 11 套件、40 项）。新增覆盖真实 HTTP 请求的停机顺序、超时关闭、有效/伪造/截断上传、异常 ASF 解析的子进程超时保护、授权边界与刷新事务失败行为。
- 本批涉及的 TypeScript 文件通过只读 ESLint 检查；没有运行会修改全仓的 lint --fix。
- 全部 7 个迁移在 PGlite 0.5.15（嵌入式 PostgreSQL WASM）中分别验证空库建表和旧权限/旧会话升级。检查了原写权限、补充读权限、tokenVersion 和 familyId 的保留/回填。
- 本机 `pnpm deploy --legacy --prod` 验证生产部署目录生成；补查运行依赖解析与 Prisma CLI。
- CI 新增单元回归、测试/seed 类型检查、生产镜像构建、空生产库管理员初始化/重复拒绝，以及镜像内迁移、readiness 和 SIGTERM 停机冒烟。
- 新增 6 个 PostgreSQL/Redis E2E 场景：管理读权限/授予/撤销闭环、禁用角色、委派管理员越权拦截、相同 cookie 并发刷新、刷新与退出竞争、密码重置与刷新竞争。本机 Docker 引擎未运行，因此这些场景和完整生产镜像尚未本地执行；CI 配置变更也尚未有远端运行结果。PGlite 的 SQL 验证不能替代真实 PostgreSQL 16 的并发验证。

## 仍需继续处理

- 授权边界的静态校验已补，但校验与管理写入尚未统一到同一串行化事务；权限同时变化时仍有 TOCTOU 窗口。还需要最后管理员保护、组织数据范围和业务/租户隔离策略。
- 审计仍为尽力而为的异步写入；HTTP drain 不保证后台任务、外部副作用或异步审计全部提交。需要事务 outbox/可靠审计与相应故障测试。
- HTTP 指标仍有 Guard 拒绝计数盲区，服务端异常日志与 requestId 关联仍需完善。
- 原评估中的列表/输入校验一致性、前端生产裁剪、覆盖率、长时间压测、备份恢复演练仍待推进。
- Prisma CLI 依赖链及前端/工作区的剩余依赖公告尚未在本批全部清理；不能据此声称生产依赖零漏洞。
- 必须在隔离的真实 PostgreSQL 16/Redis 7 环境执行 E2E、旧库升级、镜像启动和并发故障验证，再决定上线。当前结果代表完成首批加固，不代表已经获得企业级稳定性保证。
