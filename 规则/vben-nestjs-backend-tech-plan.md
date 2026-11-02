# Vue Vben Admin × NestJS 后端技术方案

> **项目**：vben-nest-kit（青栈）


> 版本：v1.2  
> 变更：补齐评审缺口——ID/时间/分页约定、Cookie 跨域与反代、可观测性、环境分层、邮件抽象、定时任务、API 版本、开源发布与许可证合规  
> 日期：2026-11-02（Asia/Singapore）  
> 前端基座：[vbenjs/vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)  
> 目标：从零实现一套可开源、可持续维护的 Nest 后端，完整替换 Vben 自带 `backend-mock`，并扩展为企业级中后台底座。

---

## 0. 文档目的与成功标准

### 0.1 目的

给出一份「可直接开工」的后端技术方案：每一项选型都说明 **选什么 / 不选什么 / 为什么**，避免后续因口头约定漂移。

### 0.2 成功标准

| 标准 | 说明 | 原因 |
|---|---|---|
| 契约兼容 | 前端几乎只改 `baseURL` + `accessMode: 'backend'` 即可跑通登录与动态菜单 | 降低接入成本，避免同时改前后端接口导致联调爆炸 |
| 开箱可跑 | `docker compose up` + seed 后 5 分钟内看到后台 | 开源项目第一印象决定 star 与贡献意愿 |
| 可维护 | TypeScript strict、迁移可回放、CI 必过 | 长期开源靠工程纪律，不靠作者记忆 |
| 可扩展 | 模块边界清晰，业务模块可插拔 | 用户会往上堆业务；架构要抗得住 |
| 可信任 | MIT、无暗门、无强制商业云、密钥不上库 | 开源后台类项目最怕信任危机 |

---

## 1. 总体架构

### 1.1 部署形态

**选择：前后端分离；前端继续用官方 Vben，后端独立 Nest 服务。**

| 备选 | 结论 | 原因 |
|---|---|---|
| 深度 fork Vben 把后端塞进同一发布包 | 不采用 | 跟不上 Vben 上游；合并成本极高；开源用户难升级前端 |
| 独立后端仓库 | **推荐默认** | 许可证清晰、发布节奏独立、贡献者职责分明 |
| Monorepo（`apps/web` + `apps/server`） | 可选 | 若你希望「一仓搞定」且团队熟悉 pnpm workspace；需自行同步/引用 Vben 版本 |

**原因总结：** Vben 迭代快，官方维护前端即可；你开源的核心价值在「Nest 后端 + 契约适配 + RBAC 底座」，不必背负前端大仓。

### 1.2 权限模式

**选择：`accessMode = 'backend'`（后端动态路由）。**

| 模式 | 结论 | 原因 |
|---|---|---|
| frontend（前端写死角色路由） | 仅演示可用 | 权限一复杂就失控；企业后台几乎都要动态菜单 |
| backend | **采用** | 菜单/按钮由服务端下发，符合真实中后台；与本方案 RBAC 一致 |
| mixed | 二期可选 | 适合「部分固定路由 + 部分动态」；一期增加理解成本 |

**原因：** 开源后台要展示的是「可配置菜单与权限」，必须走 backend。

### 1.3 逻辑分层

**选择：Controller → Service → Prisma（轻量三层），不做过度 DDD。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 贫血三层 | **采用** | 中后台 CRUD 为主；贡献者上手快；文件少、好 review |
| 完整 Clean Architecture / DDD | 不作为默认 | 样板代码多，开源小团队维护负担大；业务变复杂再演进 |
| CQRS + Event Sourcing | 不做 | 对通用后台过重，排错与文档成本陡增 |

**原因：** 「可持续维护」优先于「架构炫技」。预留接口边界（Service 不直接依赖 HTTP），以后要拆模块不至于推倒重来。

---

## 2. Nest 底层运行时与平台选择

### 2.1 NestJS 大版本

**选择：NestJS 12（当前 npm latest，如 12.3.x）。**

| 版本 | 结论 | 原因 |
|---|---|---|
| Nest 10 | 不采用 | 已过主线热度；新生态示例少 |
| Nest 11 | 可作为兼容备选 | 仍有 legacy 标签维护，但新特性与文档重心在 12 |
| Nest 12 | **采用** | 官方最新稳定线；ESM 友好、Standard Schema、CLI/`@nestjs/observe` 等面向未来；开源项目应站在当前主线 |

**原因：** 你要求「最新 + 最好 + 可维护」。Nest 12 已是 stable（非 alpha），且社区讨论中已有「Nest 12 + Vben」实践；锁定 11 会让仓库半年后显得过时。

**约束：** Nest 12 需要 Node.js **≥ 20.19 或 ≥ 22.12**。

### 2.2 HTTP 平台适配器（Nest 底层）

Nest 本身不直接绑死 HTTP 实现，通过平台包接入。

**选择：`@nestjs/platform-express`（Express 5.x 线，随 Nest 12 官方默认）。**

| 平台 | 结论 | 原因 |
|---|---|---|
| **Express（`@nestjs/platform-express`）** | **采用（默认）** | ① Nest 官方默认与文档主路径，示例/中间件/教程最多；② 上传（multer）、session/cookie、代理相关生态最成熟；③ 中后台 QPS 通常不是瓶颈，稳定性与可维护性优先于微秒级性能；④ 开源贡献者复现问题更容易 |
| Fastify（`@nestjs/platform-fastify`） | 明确不作为默认 | ① 性能更好，但插件/类型/中间件迁移常踩坑；② 文件上传、部分第三方 Nest 模块对 Fastify 支持参差；③ 开源文档与 Issue 排障成本更高 |
| `@nestjs/platform-node`（原生 Node HTTP，Nest 12 新增） | 观察，不首发 | 太新，生态与最佳实践不足；不适合作为开源首发底座 |

**切换策略：** 业务代码禁止直接 `import express`；只依赖 Nest 抽象（`Req`/`Res`/`StreamableFile` 等）。这样未来若要试 Fastify，改动面可控。

**原因一句话：** 开源后台的「底层」要选 **默认路径上最稳的 Express**，把复杂度留给业务与权限，而不是 HTTP 适配器。

### 2.3 Node.js 版本

**选择：Node.js 22 LTS 作为开发与 CI 主版本；最低引擎声明 `>=22.12.0`（或同时兼容 20.19+，但文档主推 22）。**

| 版本 | 结论 | 原因 |
|---|---|---|
| Node 18 | 禁止 | 已 EOL，安全与依赖会逐步掉队 |
| Node 20 | 可兼容 | 满足 Nest 12 下限，但不如 22 作为「主推」清晰 |
| Node 22 LTS | **主推** | 与 Nest 12 要求对齐；LTS 窗口长；开源 README 一条命令说清 |

### 2.4 语言与编译

**选择：TypeScript 5.x，`strict: true`，ESM/CJS 跟随 Nest CLI 默认（Nest 12 允许渐进 ESM，首发保持官方 schematics 默认以降低摩擦）。**

| 项 | 选择 | 原因 |
|---|---|---|
| 语言 | TypeScript strict | 与 Vben、Prisma Client 同语族；重构安全 |
| `any` | ESLint 限制 | 开源 PR 质量闸门 |
| 构建 | `nest build`（swc 或 tsc，按官方推荐） | 少造轮子；贡献者熟悉 |

---

## 3. 包管理与仓库结构

### 3.1 包管理器

**选择：pnpm。**

| 工具 | 结论 | 原因 |
|---|---|---|
| npm | 可用但不优先 | 锁文件与 monorepo 体验弱于 pnpm |
| yarn | 不优先 | 与 Vben 主流不一致 |
| pnpm | **采用** | Vben 官方即 pnpm；磁盘与 CI 更快；workspace 成熟 |

### 3.2 推荐目录

```text
your-open-admin/
├── apps/
│   └── server/                 # NestJS 后端（本方案主体）
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── user/
│       │   │   ├── system/     # role / menu / dept / dict
│       │   │   ├── file/
│       │   │   └── audit/
│       │   ├── common/
│       │   │   ├── filters/
│       │   │   ├── interceptors/
│       │   │   ├── guards/
│       │   │   ├── decorators/
│       │   │   └── dto/
│       │   └── config/
│       ├── prisma/
│       ├── test/
│       ├── docker-compose.yml
│       └── package.json
├── docs/
│   ├── architecture.md
│   ├── api-contract-vben.md
│   └── contributing.md
├── LICENSE
└── README.md
```

**原因：** `modules/` 按领域拆分，开源用户能按目录找到「用户/角色/菜单」；`common/` 放横切，避免复制粘贴；`docs/` 与代码同仓，Issue 可直接引用。

---

## 4. 数据层

### 4.1 数据库

**选择：PostgreSQL 16。**

| 数据库 | 结论 | 原因 |
|---|---|---|
| PostgreSQL 16 | **采用** | 生态第一、JSON/索引/权限模型成熟、托管便宜（RDS/Neon/Supabase） |
| MySQL 8 | 可二期兼容 | 国内习惯强，但 JSON/约束与迁移体验略弱；首发只维护一种库更稳 |
| SQLite | 仅本地试玩可选 | 不适合作为开源生产默认；并发与权限演示受限 |
| MongoDB | 不采用作主库 | 关系型权限/菜单树用文档库反而别扭 |

**原因：** 中后台本质是关系数据（用户-角色-权限-菜单）；Postgres 是开源与云上的「最大公约数」。

### 4.2 ORM

**选择：Prisma 7。**

| ORM | 结论 | 原因 |
|---|---|---|
| Prisma 7 | **采用** | ① 类型推导极强，和 TS/Nest 搭配好；② Migrate 清晰，开源贡献者改表有标准流程；③ Schema 即文档；④ Nest 官方文档有 Prisma 专章 |
| TypeORM | 不作为默认 | 历史包袱、装饰器实体在大型项目易乱；`synchronize` 误用风险高 |
| Drizzle | 可关注 | 轻、SQL 感强，但 Nest 中后台范例与中文资料少于 Prisma |
| 手写 SQL（pg） | 局部可用 | 报表复杂查询可原生 SQL；主路径仍用 Prisma |

**原因：** 开源项目要「改表可审计、类型不撒谎」——Prisma 在这两点上最省心。

### 4.3 迁移与种子

| 项 | 选择 | 原因 |
|---|---|---|
| 结构变更 | 只允许 `prisma migrate` | 禁止生产 sync；保证可回放 |
| Seed | 内置超级管理员 + 演示角色菜单 | 克隆即用；文档可写死账号（强制首次改密） |
| 环境 | `DATABASE_URL` 唯一入口 | 12-factor；方便 Docker/云托管 |

---

## 5. 校验、配置与 API 风格

### 5.1 入参校验

**选择：优先 Zod（配合 Nest 12 Standard Schema 能力）；若团队更熟 class-validator，可统一用 class-validator，但全仓只能选一种。**

| 方案 | 结论 | 原因 |
|---|---|---|
| Zod 统一 | **推荐** | 与前端/脚本共用 schema 潜力大；Nest 12 对 Standard Schema 更友好；类型推断顺 |
| class-validator + class-transformer | 可接受 | Nest 传统默认，资料多；但与 Zod 双栈会分裂 |
| 手写 if | 禁止 | 不可维护 |

**全局管道：** `whitelist` + 拒绝未知字段（forbid non-whitelisted）。  
**原因：** 防止多余字段写入、降低批量赋值风险。

### 5.2 配置管理

**选择：`@nestjs/config` + Zod/自定义 schema 启动时校验环境变量。**

| 项 | 选择 | 原因 |
|---|---|---|
| 缺密钥能否启动 | 否 | 避免「跑起来了但半残」 |
| `.env` 是否入库 | 否，只提交 `.env.example` | 开源安全底线 |

### 5.3 响应体约定（对齐 Vben mock）

**选择：统一包装 `{ code: 0, data, message }`（字段名以 Vben `backend-mock` 实际为准，实现时对照源码锁定）。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 对齐 Vben mock | **采用** | 前端拦截器已按此解析；改契约等于改前端 |
| 纯 HTTP 语义无包装 | 不首发 | 与 Vben 默认不兼容 |
| 双模式开关 | 可选 | 用环境变量切换「Vben 兼容 / 标准 REST」，方便非 Vben 客户端 |

**实现：** `ResponseInterceptor` + `HttpExceptionFilter`。  
**原因：** 横切统一，业务 Service 只返回 data。

### 5.4 API 文档

**选择：Swagger（`@nestjs/swagger`），开发/预发默认开启，生产可关或加 Basic/JWT 保护。**

**原因：** 开源用户与对接方第一依赖是 OpenAPI；比纯 Markdown 接口表更不易漂移。

---

## 6. 认证与授权

### 6.1 认证方案

**选择：JWT Access Token（Authorization Bearer）+ Refresh Token（HttpOnly Secure Cookie，服务端只存哈希）。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 仅 Access JWT | 不采用 | 无法安全吊销；过期体验差 |
| Access + Refresh（Cookie） | **采用** | 对齐 Vben mock 的 refresh cookie 思路；XSS 难偷 refresh |
| Session（服务端 Session + Redis） | 备选 | 吊销简单，但多实例强依赖 Redis；首发可后置 |
| OAuth 仅 | 二期 | 先邮箱密码/用户名密码跑通；再加 GitHub/OIDC |

**细节与原因：**

| 细节 | 选择 | 原因 |
|---|---|---|
| Access 载荷 | `sub` + `tv`(tokenVersion) 等最小字段，**不含角色列表** | 角色变更立即生效需查库；JWT 塞角色会权限滞后 |
| Access TTL | 15–30 分钟 | 泄露窗口小 |
| Refresh TTL | 7–30 天可配 | 平衡体验与风险 |
| Refresh 存储 | DB 存哈希 + 可选设备信息 | 可单点登出、改密全吊销 |
| 密码算法 | Argon2id | 当前口令哈希最佳实践；避免 bcrypt 参数争论 |

### 6.2 授权模型（RBAC）

**选择：用户 ↔ 角色 ↔ 权限码（Permission Code）+ 菜单树；接口级 Guarding。**

| 模型 | 结论 | 原因 |
|---|---|---|
| 仅角色字符串 | 太粗 | 按钮级控制不够 |
| RBAC + permission code | **采用** | 与 Vben `getAccessCodes()` 天然对应 |
| 完整 ABAC | 不做默认 | 规则引擎过重 |

**菜单：** 后端返回 Vben 路由协议字段（`name/path/component/meta/children` 等）。  
**原因：** `generateAccessible` 依赖该结构；错一字段前端白屏。

**鉴权执行：** 全局 `AuthGuard` + `@Public()` + `@RequirePermissions('system:user:create')`。  
**原因：** 默认安全（secure by default）；公开接口显式标注，审计清晰。

---

## 7. 与 Vben 对接的接口契约（P0）

> 实现前以仓库 `apps/backend-mock` 源码为唯一真源；下表为能力清单。

| 能力 | Mock 侧意图 | 后端必须提供的原因 |
|---|---|---|
| 登录 | 校验用户，发 access，写 refresh cookie | 进入系统的唯一入口 |
| 刷新 | 用 cookie 换新 access | 短 access 下的持续会话 |
| 登出 | 清 cookie / 失效 refresh | 安全与合规 |
| 用户信息 | 头像、角色、首页等 | 顶栏与个人中心 |
| 权限码 | 字符串数组 | 按钮 `v-access` |
| 全量菜单 | 动态路由树 | `accessMode=backend` 的核心 |
| 上传（示例） | 文件 URL | 头像/附件类页面 |
| 基础表格示例 | 分页列表 | 验证分页约定 |

**分页约定建议：** `page/pageSize` + 返回 `items/total`（或对齐前端现有字段）。  
**原因：** 前后端字段不一致是联调第一杀手，必须在契约文档写死。

---

## 8. 业务模块路线图

### 8.1 P0（开源 v0.1 必含）

| 模块 | 内容 | 原因 |
|---|---|---|
| Auth | 登录/刷新/登出/codes | 替换 mock 的最短路径 |
| User | 用户 CRUD、重置密码、启用禁用 | 任何后台的核心实体 |
| Role | 角色与权限绑定 | RBAC 中枢 |
| Menu | 菜单树维护与下发 | 动态路由来源 |
| Dept | 组织树 | 国内中后台标配，演示完整 |
| Audit | 登录与敏感操作日志 | 开源项目专业感与排障依据 |
| Health | `/health` 含 DB | 容器编排与监控 |

### 8.2 P1

| 模块 | 原因 |
|---|---|
| Dict / Config | 少改代码调行为 |
| File（本地 + S3 兼容） | 真实项目刚需；本地模式方便贡献者 |
| Job 骨架（BullMQ） | 异步导出/清理；先骨架后丰满 |

### 8.3 P2

| 模块 | 原因 |
|---|---|
| 多租户 | SaaS 用户要；但会污染几乎所有查询，必须可选开关 |
| OIDC/OAuth | 企业对接 |
| 通知中心 | 体验完整 |

---

## 9. 横切能力与中间件栈

| 能力 | 选择 | 原因 |
|---|---|---|
| 安全头 | Helmet | 基础 Web 防护，成本极低 |
| CORS | 显式白名单 | 开源演示可配；生产禁止 `*` + 凭证 |
| 限流 | `@nestjs/throttler`（登录更严） | 防爆破；不首发也可，但开源 README 有加分 |
| 日志 | Pino（nestjs-pino） | JSON 日志、性能好、可脱敏 |
| 请求 ID | Middleware 注入 `x-request-id` | 联调与审计关联 |
| 压缩 | compression（Express） | 降低接口体积 |
| 健康检查 | `@nestjs/terminus` | K8s/Compose 就绪探针 |

**Redis（一等依赖，见第 19 章）：**

| 阶段 | 选择 | 原因 |
|---|---|---|
| v0.1 起 | **Compose 默认启动 Redis 7** | 会话、限流、权限码缓存、后续队列共用一套基础设施；开源演示与生产同构 |
| 降级 | 仅允许通过显式配置关闭（开发急救） | 避免「有的环境有缓存有的没有」导致难复现 Bug；文档仍要求标准路径带 Redis |

---

## 10. 文件存储

**选择：策略模式 —— 默认 Local，可切换 S3 兼容（MinIO/AWS/OSS）。**

| 后端 | 结论 | 原因 |
|---|---|---|
| Local disk | 默认 | Docker 一键演示零云账号 |
| S3 API | 生产推荐 | 对象存储事实标准 |
| 仅某一云 SDK | 避免写死 | 开源用户云厂商不同 |

---

## 11. 测试、CI 与质量门禁

| 项 | 选择 | 原因 |
|---|---|---|
| 单元测试 | Jest（Nest 默认） | 官方一致；守卫/管道/工具函数必测 |
| E2E | Jest + Supertest + Testcontainers/Compose Postgres | 认证与权限必须黑盒测 |
| Lint | ESLint + Prettier | PR 风格统一 |
| CI | GitHub Actions：install → lint → test → build | 开源信任基础 |
| 依赖审计 | `pnpm audit` / OSV | 安全基本面 |
| Commit | Conventional Commits + changeset/版本策略可选 | changelog 可生成 |

**原因：** 没有 CI 的开源后台很难被企业试用方接受。

---

## 12. 容器与本地开发

| 项 | 选择 | 原因 |
|---|---|---|
| Compose | Postgres + **Redis 7**（+ 可选 MinIO）+ API | 一条命令环境一致；与生产拓扑同构 |
| 镜像 | 多阶段构建、非 root 用户 | 安全基线 |
| 热更新 | `nest start --watch` | DX |

---

## 13. 开源治理

| 项 | 选择 | 原因 |
|---|---|---|
| 许可证 | **MIT** | 与 Vben、Nest 生态友好；企业采用阻力最小 |
| 中英文 README | 必须 | 国内用户 + 国际可见度 |
| `CONTRIBUTING` / `CODE_OF_CONDUCT` | 必须 | 降低无效 PR |
| Security Policy | 必须 | 漏洞私报渠道 |
| 默认账号 | seed 文档写明，强制提示修改 | 防止「默认密码上生产」背锅 |
| 商业双协议 | 首发不做 | 你已倾向纯开源；双协议劝退部分用户 |

**商标与命名：** 避免使用 `Vben` 作为商标性项目名（可用 “for Vben” 描述关系）。  
**原因：** 减少上游品牌与许可证误解。

---

## 14. 明确不做什么（防范围膨胀）

| 不做 | 原因 |
|---|---|
| 自研前端组件库 | 重复造 Vben 的轮子 |
| 一期上微服务/Dapr | 运维与心智爆炸 |
| 一期 GraphQL 并行 | 契约双倍；REST 先稳 |
| 绑定单一云厂商 | 伤害开源可移植性 |
| 在 JWT 里固化权限列表 | 权限变更不即时 |

---

## 15. 里程碑建议

| 阶段 | 交付 | 原因 |
|---|---|---|
| M1 | 契约对齐：登录/刷新/用户/codes/菜单 + seed + Compose（Postgres+Redis） | 证明「能替 mock」 |
| M2 | 用户/角色/菜单/部门 CRUD + Swagger + 审计 | 证明「能管权限」 |
| M3 | 上传、限流、E2E、中英文档、v0.1 Release | 证明「能开源给人用」 |
| M4 | Redis/队列/S3/OAuth 可选特性 | 证明「能进生产」 |

---

## 16. 决策一览表（速查）

| 决策点 | 结论 |
|---|---|
| 前端 | 官方 vue-vben-admin，不深度 fork |
| 权限模式 | backend 动态菜单 |
| Nest 版本 | NestJS 12 |
| Nest HTTP 底层 | `@nestjs/platform-express`（Express） |
| Node | 22 LTS |
| 语言 | TypeScript strict |
| 包管理 | pnpm |
| DB | PostgreSQL 16 |
| ORM | Prisma 7 |
| 校验 | Zod（或全仓统一 class-validator） |
| 认证 | JWT Access + Refresh Cookie（哈希入库） |
| 密码 | Argon2id |
| 授权 | RBAC + permission codes |
| 文档 | Swagger/OpenAPI |
| 日志 | Pino |
| 默认文件存储 | Local，可切 S3 |
| 许可证 | MIT |
| 缓存/会话/限流 | **Redis 7（必选默认）** |
| 队列 | BullMQ（基于 Redis，P1 启用） |
| 模块化 | Nest Feature Module + 目录约定（见第 20 章） |
| 开发规范 | ESLint/Prettier/Conventional Commits/ADR（见第 21 章） |
| 主键 | UUID v7（见第 23 章） |
| 时间 | 一律 UTC 存储，ISO-8601 输出 |
| 分页排序 | 统一 Query DTO（见第 23 章） |
| 可观测性 | Pino + OpenTelemetry 可选（见第 24 章） |
| 环境 | local/test/staging/prod 四套（见第 25 章） |
| 邮件 | 接口抽象 + dev 控制台落盘（见第 26 章） |
| 定时任务 | `@nestjs/schedule` 轻量 + BullMQ 重任务（见第 27 章） |
| API 版本 | URL `/api/v1` + Vben 兼容别名（见第 28 章） |

---

## 17. 下一步可立刻产出的工件

1. Prisma `schema.prisma` 初稿（User/Role/Permission/Menu/Dept/RefreshToken/AuditLog）  
2. 与 `backend-mock` 路径级对照表（方法、路径、请求/响应 JSON 示例）  
3. `docker-compose.yml` + `.env.example`  
4. 仓库骨架 PR（空模块 + 全局过滤器/守卫）

---

## 18. 附录：为什么 Express 而不是 Fastify（展开）

1. **官方默认即信任锚：** Nest 文档、schematics、绝大多数第三方 Nest 模块默认测的是 Express。开源项目选默认，Issue「在我机器上挂了」概率更低。  
2. **中后台性能画像：** 瓶颈通常在 DB、权限查询、ORM，不在 HTTP 框架。Fastify 的吞吐优势难以转化为用户可感知价值。  
3. **上传与 Cookie 场景：** 头像上传、refresh cookie、反向代理头处理，Express 中间件路径最成熟。  
4. **贡献者友好：** 国内/国际 Nest 教程 90%+ 基于 Express；Fastify 版示例少，PR 质量难保障。  
5. **可迁移性：** 只要业务不直接依赖 `req.res` 的 Express 私有 API，未来仍可评估 Fastify；但 **首发不赌**。

---



---

## 19. Redis 方案（一等公民）

### 19.1 总决策

**选择：Redis 7（Docker Compose 默认启动；生产同版本主线）作为缓存、会话辅助、限流与队列的统一基础设施。**

| 备选 | 结论 | 原因 |
|---|---|---|
| 不用 Redis，全靠 Postgres | 不采用为默认 | 权限码热路径、登录限流、分布式锁用 DB 会放大延迟与锁竞争；后期加 Redis 等于二次改造 |
| Redis 仅生产启用 | 不采用 | 本地/CI 与生产行为不一致，缓存相关 Bug 难复现 |
| KeyDB / Dragonfly 默认 | 不首发 | 协议兼容好，但开源文档与贡献者熟悉度不如 Redis；可在 FAQ 写「兼容 Redis 协议」 |
| **Redis 7** | **采用** | 生态最大、Nest/BullMQ/ioredis 资料全、运维心智统一 |

**原因一句话：** 中后台开源项目一开始就把 Redis 放进 Compose，比「以后再说」更省总维护成本。

### 19.2 Redis 客户端与 Nest 集成

**选择：`@nestjs/cache-manager` + `cache-manager-redis-yet`（或官方推荐的 Redis store）做缓存抽象；底层驱动用 **ioredis**；队列用 **BullMQ**（P1）。**

| 组件 | 选择 | 原因 |
|---|---|---|
| 驱动 | ioredis | Node 生态事实标准；集群/哨兵文档全 |
| 缓存封装 | Nest CacheModule 统一接口 | 业务只依赖 `CACHE_MANAGER`，便于单测 mock |
| 直接 ioredis 注入 | 允许但收口到 `RedisModule` | 避免各处 `new Redis()`；连接生命周期统一 |
| BullMQ | P1 启用 | 导出、邮件、审计归档等异步任务；与 Redis 复用 |
| 自建 UDP 缓存 | 禁止 | 无必要 |

### 19.3 Redis 用途清单（必须写进实现）

| 用途 | Key 设计示意 | TTL | 原因 |
|---|---|---|---|
| Access 旁路：用户权限码缓存 | `perm:codes:{userId}` | 30–120s | 降 DB 压力；改角色时主动 `DEL` |
| 登录失败计数 | `auth:fail:{username|ip}` | 15m | 防爆破；比纯内存限流可跨实例 |
| Refresh 会话索引（可选加速） | `sess:refresh:{jti}` | 同 refresh | DB 仍是真相源；Redis 做快速存在性检查 |
| 分布式锁（导入/种子） | `lock:job:{name}` | 短 TTL + 持有校验 | 防重复跑迁移脚本/定时任务 |
| 验证码/临时票据（若有） | `otp:{id}` | 分钟级 | 无需落库 |
| BullMQ | Bull 前缀键 | 由框架管理 | 异步解耦 |

**原则：**

1. **Postgres 仍是业务真相源**；Redis 可丢，重启后应能自愈（缓存击穿靠回源）。  
2. **禁止把不可重建的业务唯一数据只放 Redis**（订单、权限配置本体等）。  
3. **改角色/改菜单必须失效相关缓存**（在 Service 写路径显式删除）。  

**原因：** 开源用户常误用 Redis 当主库；文档必须把边界写死。

### 19.4 配置与安全

| 项 | 选择 | 原因 |
|---|---|---|
| 连接 | `REDIS_URL` 或 host/port/password/db | 12-factor |
| 密码 | Compose 默认设密码，示例写在 `.env.example` | 防止裸奔误上公网 |
| DB index | 逻辑分离：`0` 缓存、`1` 队列（或 key 前缀分离） | 避免 `FLUSHDB` 误伤；前缀方案也可 |
| Key 前缀 | 全局 `APP_PREFIX:` | 多项目共用一个 Redis 时不撞车 |
| TLS | 生产托管 Redis 开启 | 合规与中间人防护 |

### 19.5 本地与 CI

| 环境 | 选择 | 原因 |
|---|---|---|
| 本地 | Compose 起 `redis:7-alpine` | 与生产一致 |
| CI | Service container 或 Compose | E2E 覆盖缓存失效路径 |
| 单测 | mock CacheManager / ioredis-mock（谨慎） | 单元测试不依赖真 Redis；契约测仍用真实例 |

---

## 20. 模块化设计规范

### 20.1 模块划分原则

**选择：按业务能力拆 Nest Feature Module（垂直切片），禁止按技术层建巨型 `controllers/` 大锅饭目录。**

| 方式 | 结论 | 原因 |
|---|---|---|
| 按层分大目录（全部 controller 一堆） | 不采用 | 文件爆炸后找不到归属；循环依赖难控 |
| 按领域 Feature Module | **采用** | Nest 官方推荐；开源贡献者可按模块认领 Issue |
| 插件式动态 Module 远程加载 | 不做默认 | 复杂度高，中后台收益小 |

### 20.2 标准模块内部结构

每个业务模块目录固定为：

```text
modules/user/
  user.module.ts          # 只负责组装 providers / exports
  user.controller.ts      # HTTP 入站，无业务分支
  user.service.ts         # 用例编排
  user.repository.ts      # 可选：封装 Prisma 查询（复杂模块建议有）
  dto/
    create-user.dto.ts
    update-user.dto.ts
    query-user.dto.ts
  entities/ 或 domain/    # 仅当有非 Prisma 领域对象时
  user.constants.ts       # 权限码、事件名等常量
  user.errors.ts          # 业务错误码（可选）
  __tests__/
```

| 约定 | 原因 |
|---|---|
| Controller 不直连 Prisma | 保持可测；换存储时不改 HTTP 层 |
| Service 不依赖 `Request` 对象 | 便于 CLI/队列复用同一用例 |
| 只通过 `exports` 暴露其他模块需要的 Service | 防止随意 cross-import 内部文件 |
| DTO 与实体分离 | 入参/出参演进不影响表结构 |

### 20.3 模块依赖规则

```text
common/config/prisma/redis  ← 基础设施（被依赖）
        ↑
   auth / user / system/*   ← 领域模块
        ↑
   app.module.ts            ← 组装根
```

| 规则 | 原因 |
|---|---|
| 禁止领域模块互相循环依赖 | Nest 启动失败或隐性时序 Bug |
| 共享内核放 `common`，不要塞进某个业务模块 | 避免 User 依赖 System 再依赖 User |
| 权限码字符串常量定义在所属模块，并在文档汇总 | 防止魔法字符串散落 |
| 跨模块协作优先「导出 Service」或「领域事件（二期）」 | 降低耦合 |

### 20.4 建议的模块地图（与目录一致）

| 模块 | 职责 | 对外导出 | 原因 |
|---|---|---|---|
| `PrismaModule` | DB 客户端生命周期 | `PrismaService` | 全局唯一连接 |
| `RedisModule` | 缓存/客户端 | `RedisService` / Cache | 全局唯一连接 |
| `AuthModule` | 登录会话 | 少量 token 工具（慎用） | 认证闭环 |
| `UserModule` | 用户 | `UserService` | 被 Auth 等依赖 |
| `SystemModule` 或拆 `Role/Menu/Dept` | 权限组织 | 各 Service | 可按体量拆分子模块 |
| `FileModule` | 存储策略 | `FileService` | 上传复用 |
| `AuditModule` | 审计 | 可监听事件 | 横切但不进业务 if |
| `HealthModule` | 探针 | 无 | 运维 |

**体量规则：** 单模块超过 ~15 个文件或 2 个以上聚合根时，拆子模块（例如 `system/role`、`system/menu`）。  
**原因：** 保持 PR 可审阅，避免「system.service.ts 三千行」。

### 20.5 API 路径与模块对齐

**选择：路径前缀按资源：`/api/auth/*`、`/api/users/*`、`/api/roles/*`、`/api/menus/*`。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 与目录同名的清晰 REST | **采用** | 贡献者看 URL 就知改哪个模块 |
| 完全照搬 mock 怪异路径 | 仅在「兼容层」保留别名 | 可用 Controller 双路径或版本前缀迁移 |

**兼容策略：** 提供 `VbenCompatController` 或路径别名，把 mock 旧路径映射到新资源路径。  
**原因：** 既要兼容 Vben 开箱，又不污染长期 API 设计。

---

## 21. 开发规范（Coding Standards）

### 21.1 语言与类型

| 规范 | 要求 | 原因 |
|---|---|---|
| TypeScript | `strict: true` | 少运行时雷 |
| 禁止无必要 `any` | ESLint `@typescript-eslint/no-explicit-any` warn/error | PR 质量 |
| 公共 API 显式返回类型 | Service 对外方法 | 重构不 silently 变型 |
| 枚举 | 优先 union + `as const` 或 Prisma enum | 避免 TS enum 双份 |

### 21.2 命名

| 对象 | 约定 | 原因 |
|---|---|---|
| 文件 | `user.service.ts` kebab/点分 Nest 风格 | 与 Nest schematics 一致 |
| 类 | `UserService` PascalCase | 常规 |
| 方法 | `create`/`findById` 动词短语 | CRUD 可读 |
| 权限码 | `资源:动作` 如 `system:user:create` | 与 Vben access 习惯一致 |
| DB 表 | Prisma `@@map` 用 `snake_case` 复数 | SQL 可读 |
| Redis key | `前缀:域:标识` | 可扫可删 |

### 21.3 错误与返回

| 规范 | 要求 | 原因 |
|---|---|---|
| 业务错误 | 抛 `HttpException` 或自定义 `BizException(code, message)` | 过滤器统一包装 |
| 禁止吞异常 | catch 必须记录并转换 | 开源排障靠日志 |
| 成功 `code` | 与 Vben 约定锁定（如 0） | 前端拦截器 |
| 国际化消息 | 错误码稳定，文案可 i18n | 多语言开源友好 |

### 21.4 安全编码

| 规范 | 要求 | 原因 |
|---|---|---|
| 密码 | 仅存 Argon2 哈希 | 泄露可补救性 |
| 日志脱敏 | token/password/authorization 红acted | 防二次泄露 |
| DTO whitelist | 开启 | 防批量赋值 |
| 管理接口 | 必须权限码 | 默认拒绝 |
| SQL | 只用 Prisma/参数化 | 防注入 |

### 21.5 Git 与评审

| 规范 | 要求 | 原因 |
|---|---|---|
| Commit | Conventional Commits（`feat`/`fix`/`docs`/`chore`/`refactor`/`test`） | 自动 changelog |
| 分支 | `main` 保护 + `feat/*` | 发布稳定 |
| PR | 模板：动机/改动/测试/截图或 curl | 降低维护者负担 |
| 规模 | 单 PR 聚焦一个模块或一个契约 | 可 review |
| ADR | `docs/adr/XXXX-title.md` 记录重大选型变更 | 防止口口相传丢失 |

### 21.6 代码风格工具链

| 工具 | 选择 | 原因 |
|---|---|---|
| ESLint | flat config + typescript-eslint | Nest 12 主流 |
| Prettier | 统一格式 | 消灭风格争论 |
| Husky + lint-staged | 提交前检查 | 脏代码不进主线 |
| EditorConfig | 基础缩进 | 跨 IDE |

### 21.7 测试规范

| 层级 | 要求 | 原因 |
|---|---|---|
| 单元 | Guard、纯函数、缓存失效逻辑必测 | 回归便宜 |
| 集成 | Service + Prisma + Redis（Compose） | 真集成问题 |
| E2E | 登录→拉菜单→无权限 403 | 保住 Vben 契约 |
| 覆盖率 | 核心模块设置底线（如 60%+ 起步） | 不追求虚高 |

### 21.8 文档规范

| 文档 | 何时更新 | 原因 |
|---|---|---|
| `api-contract-vben.md` | 任何兼容路径变更 | 前端联调唯一真源 |
| README 快速开始 | Compose 变量变更 | 贡献者第一入口 |
| CHANGELOG | Release 时 | 用户升级预期 |
| 模块 README（可选） | 复杂模块 | 降低主 README 膨胀 |

### 21.9 AI / 协作开发约定（可选但建议）

| 约定 | 原因 |
|---|---|
| 生成代码必须过 ESLint/测试 | 防 AI 幻觉接口 |
| 禁止提交真实密钥 | 安全 |
| 大段脚手架用 Nest CLI schematics | 目录结构不漂 |

---

## 22. 修订说明

### v1.2
1. 补齐评审缺口：主键/时间/软删/分页、可观测性、环境分层、邮件抽象、定时任务、API 版本、开源发布与合规。  
2. 决策一览表同步。  

### v1.1

相对 v1.0：

1. **Redis 从「可后置」提升为默认必选基础设施**，并规定用途边界与键设计。  
2. **新增模块化规范**：垂直 Feature Module、目录模板、依赖方向、API 路径对齐。  
3. **新增开发规范**：命名、错误、安全、Git、测试、文档与工具链。  
4. Compose / 决策一览 / 里程碑已同步为 Postgres + Redis 同构。




---

## 23. 数据与接口约定（评审补缺）

> 本章补的是「不写就会在联调期吵架」的硬约定。

### 23.1 主键策略

**选择：业务表主键使用 UUID v7（时间有序）；禁止自增 Int 暴露给前端。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 自增 Int/BigInt | 不对外暴露 | 易枚举、合并库困难、泄漏业务量 |
| UUID v4 | 可用但不优先 | 随机，B-Tree 局部性差 |
| **UUID v7** | **采用** | 有序、分布式友好、Prisma/Postgres 支持清晰 |
| 雪花 ID | 备选 | 需发号器；多实例要协调；开源演示更重 |

**原因：** 开源项目常被拿去拼多租户/多库，UUID 迁移成本最低。

### 23.2 时间与时区

**选择：数据库一律存 `timestamptz`（UTC）；API 输出 ISO-8601（带 `Z`）；前端用自己的时区展示。**

| 项 | 选择 | 原因 |
|---|---|---|
| 存储 | UTC | 避免夏令时/服务器时区坑 |
| 禁止 | 用「本地时间无时区」落库 | 一部署到别的地区就错乱 |
| 创建/更新 | `@default(now())` + 中间件或 Prisma `@updatedAt` | 审计可读 |

### 23.3 软删除

**选择：用户/角色/菜单等可恢复资源用 `deletedAt` 软删；日志类可硬删或归档。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 全硬删 | 不默认 | 误操作不可逆；审计断裂 |
| 软删 + 唯一约束注意 | **采用** | 邮箱/用户名唯一需部分唯一索引（`deletedAt IS NULL`） |
| 回收站模块 | P1 | 产品完整度 |

### 23.4 分页 / 过滤 / 排序

**选择：统一 `page`（从 1 起）、`pageSize`（默认 20，最大 100）、`sortBy`、`sortOrder`（`asc|desc`）；列表响应 `{ items, total, page, pageSize }`。**

| 项 | 选择 | 原因 |
|---|---|---|
| 最大 pageSize | 100（可配置） | 防拖库 |
| 模糊搜 | `q` 或显式字段 | 避免任意字段注入排序 |
| sortBy 白名单 | 必须 | 防排序字段注入 |
| 与 Vben 表格字段不一致时 | 在 BFF/拦截转换层对齐 | 契约文档写清映射 |

### 23.5 幂等与并发

| 场景 | 选择 | 原因 |
|---|---|---|
| 创建类 POST | 可选 `Idempotency-Key`（P1） | 网关重试不双写 |
| 更新 | Prisma 事务 + 必要时 `version` 乐观锁 | 防覆盖他人编辑 |
| 权限变更 | 事务内写库并删 Redis 缓存 | 一致性 |

---

## 24. 可观测性与运维就绪

### 24.1 日志

**已选 Pino。补充：**

| 项 | 选择 | 原因 |
|---|---|---|
| 级别 | local=`debug`，prod=`info` | 噪音可控 |
| 结构化字段 | `requestId,userId,module,action` | 好检索 |
| 禁止 | 打明文 token/密码/身份证 | 合规 |

### 24.2 Tracing / Metrics

**选择：预留 OpenTelemetry 插桩；v0.1 可只做日志 + `/health`，v0.2 打开 OTLP 导出。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 只靠 console.log | 禁止 | 无法关联一次请求 |
| Pino only | v0.1 可接受 | 先跑通 |
| **OpenTelemetry（Nest 12 `@nestjs/observe` / OTel SDK）** | **路线图必选** | 与云厂商/Grafana 通用；开源项目专业度 |
| 自建 metrics 协议 | 不做 | 重复造轮子 |

### 24.3 健康检查

| 探针 | 检查 | 原因 |
|---|---|---|
| `/health/live` | 进程活着 | K8s liveness |
| `/health/ready` | Postgres + Redis ping | 就绪才接流量 |

### 24.4 反向代理与信任网段

**选择：生产在 Nginx/Caddy/Traefik 后；Nest 开启 `trust proxy`（限定跳数）；Cookie `Secure + HttpOnly + SameSite=None|Lax` 按是否跨站选择。**

| 项 | 选择 | 原因 |
|---|---|---|
| 前端异域 + Cookie refresh | `SameSite=None; Secure` + CORS `credentials` | 否则浏览器不带 cookie |
| 同站部署 | `SameSite=Lax` 即可 | 更安全默认 |
| 限流看 IP | 必须信任代理头，防伪造 | 安全与准确性 |

**原因：** Vben 前端与 API 域名常分离，Cookie 会话若不写清，联调会「登录成功却刷新失败」。

---

## 25. 环境分层与配置矩阵

| 环境 | 用途 | 数据 | 原因 |
|---|---|---|---|
| `local` | 开发者本机 | Compose 可销毁 | DX |
| `test` | CI | 一次性库 | 隔离 |
| `staging` | 预发/在线 Demo | 可重置 | 开源展示 |
| `prod` | 正式 | 备份 | 真实用户 |

| 配置项 | 要求 | 原因 |
|---|---|---|
| `NODE_ENV` / `APP_ENV` 分离 | 推荐 | Nest 的 NODE_ENV 与业务环境别绑死 |
| 每环境独立密钥 | 必须 | 防串环境 |
| Swagger | local/staging 开，prod 默认关或鉴权 | 减少攻击面 |

---

## 26. 邮件与通知抽象

**选择：定义 `MailSender` 接口；local 用 Ethereal/控制台落盘；生产接 SMTP 或厂商 HTTP API。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 一期不做重置密码 | 可，但建议接口先留 | 补功能时不改架构 |
| 写死某云邮件 SDK | 禁止 | 伤害开源可移植 |
| 接口 + 适配器 | **采用** | 测试可 mock；用户自选供应商 |

密码重置、邀请用户会用到；站内信可作为 P2。

---

## 27. 定时与后台任务

| 类型 | 选择 | 原因 |
|---|---|---|
| 轻量 cron（清理临时文件、刷缓存统计） | `@nestjs/schedule` | 简单、少依赖 |
| 重任务（导出 Excel、批量通知） | **BullMQ + Redis** | 可重试、可观测、不堵 HTTP |
| 系统 crontab 调 curl | 不推荐默认 | 环境不可移植 |

**规则：** HTTP 请求内不做超过 2s 的同步重活；改投队列。  
**原因：** 开源用户一导出全表就会把 API 拖死。

---

## 28. API 版本与兼容策略

**选择：正式资源走 `/api/v1/...`；为 Vben mock 保留兼容别名（或网关重写），并在文档标 `deprecated`。**

| 方案 | 结论 | 原因 |
|---|---|---|
| 永不版本化 | 不采用 | 破坏性变更无法演进 |
| Header 版本 | 不首发 | 调试不直观 |
| URL `/v1` | **采用** | 简单、CDN/网关友好 |
| 兼容层 | v0.x 保留 | 降低替换 mock 的摩擦 |

破坏性变更：升 `/v2` 或发迁移指南；遵循 SemVer 发 Release。

---

## 29. 开源发布、演示与合规（评审补缺）

| 项 | 选择 | 原因 |
|---|---|---|
| 在线 Demo | staging 一键（Railway/Fly/自有 VPS）+ 定期重置 DB | star 转化率关键 |
| 截图/录屏 | README 必备 | 后台类项目靠观感 |
| `NOTICE` / 第三方许可证 | 发布脚本生成 | MIT 项目仍需尊重依赖许可证 |
| 安全披露 | `SECURITY.md` | 漏洞不走公开 Issue |
| CodeQL / dependabot | 开启 | 自动补丁信号 |
| 默认管理员 | 首次登录强制改密或随机初始密码打印到日志 | 防裸奔 |
| 贡献者 CLA | 可选 | 个人开源通常 MIT 足够；公司主体再议 |
| 中文社区 | Issue/讨论区模板中英 | 你的主要用户可能在国内 |

### 29.1 仍可不进 v0.1 的范围（有意推迟）

| 项 | 原因 |
|---|---|
| 多租户行级隔离 | 查询全污染；做可选开关需单独 ADR |
| GraphQL | 双协议维护成本 |
| 微服务拆分 | 单体内聚更适合开源起步 |
| 工作流引擎 | 可后期接 Flowable/Temporal；别绑死 |
| 国产 DB 优先适配 | 先 Postgres；再扩驱动 |

---

## 30. 评审结论：还需要补充吗？

**核心栈与规范已够开工。** v1.2 已把最容易遗漏且会返工的部分补上：

1. UUID/时间/软删/分页——数据契约  
2. Cookie 跨域与 trust proxy——登录刷新真能用  
3. OTel 路线 + 双健康探针——能上容器  
4. 环境矩阵——CI/演示/生产不打架  
5. 邮件抽象与任务队列边界——功能可长  
6. API 版本与开源合规——能长期发版  

**若只再加一件「文档外工件」：** 单独维护 `docs/api-contract-vben.md`（路径级请求/响应示例），比继续加长本方案更有用。


*本文档作为实现与 Code Review 的基线；若某条选型变更，请同步改本节决策表并留下 ADR（Architecture Decision Record）。*
